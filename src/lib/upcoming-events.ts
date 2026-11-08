// The public events feed: today's events, and the next few after today (as many as the school's rules say). Two
// blocks, ONE call — so the two can never disagree about what "today" means across midnight.
//
// Posture: public, no auth, same as the calendar PDF. An event carries a date, a
// type and at most a class code — no person, no family, no PII of any kind.
//
// WHAT COUNTS AS AN EVENT:
// roster_events holds two kinds of row — things that HAPPEN on a day (each of the
// school's own event types) and markers for the day's own CHARACTER
// (the school day and the holiday — see systemEventTypes). The character rows carry no
// description, so a feed of every row would fill the next few events with school
// days. So, per date:
//   - a date with named events emits those events, and nothing for the marker;
//   - a date with only markers emits ONE item for the day itself, under the school's
//     name for it, so a plain school day is still announced rather than invisible.
// Either way every item carries isSchoolDay / isHoliday for that date, so the
// renderer always knows whether there is class.

import { db } from './db'
import { rosterEvents, rosterEventTypes, rosterAvailableClasses, rosterCourseCatalog } from '../tables'
import { eq, and, gte } from 'drizzle-orm'
import type { CalendarRules } from './calendar-types'
import { todayOf } from './year-context'
import { calendarRules } from './rules-context'
import { schoolWord } from './school-words'

/** The school's special event types, by id (SchoolRules.calendar.eventTypes). */
type EventTypes = CalendarRules['eventTypes']
/** The special event types, the school's name for the school day, and how many upcoming events the feed carries
 *  (SchoolRules.calendar.feedUpcoming). */
export type FeedTypes = EventTypes & { schoolDayName: string; upcomingCount: number }

/**
 * One item on the wire. `date` is the stored calendar date printed verbatim
 * (YYYY-MM-DD) — a date has no timezone and is never converted.
 */
export type FeedEvent = {
  date: string
  /** The event type's name, e.g. "Activity", "Holiday", "School Day". */
  type: string
  /** What to show: type, class code and description already composed. */
  label: string
  /** Present only for a class-scoped event, e.g. "X2". */
  classShortCode: string | null
  /** Wall-clock strings as entered, e.g. "10:00". Null on an all-day event. */
  startTime: string | null
  endTime: string | null
  /** True when the event has no start time — decides whether a time is shown. */
  allDay: boolean
  /** The character of the DATE, not of this row: is there class, is it a holiday. */
  isSchoolDay: boolean
  isHoliday: boolean
}

export type EventsFeed = {
  /** Events dated today. Empty when there is nothing today. */
  today: FeedEvent[]
  /** The next upcomingCount events strictly AFTER today — today is never repeated. */
  upcoming: FeedEvent[]
  /** Today's date in the school's timezone, so the renderer can label the block. */
  today_date: string
}

/** A row as read from roster_events, before grouping. */
export type EventRow = {
  eventType: number
  date: string
  description: string | null
  startTime: string | null
  endTime: string | null
  typeName: string | null
  classShortCode: string | null
}

/** The school-day type reads as the school's name for it (schoolWord 'school-day-name'); every other type as its row
 *  names it. */
function typeLabel(types: FeedTypes, eventType: number, typeName: string | null): string {
  if (eventType === types.schoolDay) return types.schoolDayName
  return typeName ?? ''
}

function toFeedEvent(types: FeedTypes, r: EventRow, isSchoolDay: boolean, isHoliday: boolean): FeedEvent {
  const type = typeLabel(types, r.eventType, r.typeName)
  const base = [type, r.classShortCode].filter(Boolean).join(' — ')
  const label = r.description
    ? (base ? `${base}: ${r.description}` : r.description)
    : base

  return {
    date: r.date,
    type,
    label,
    classShortCode: r.classShortCode ?? null,
    startTime: r.startTime || null,
    endTime: r.endTime || null,
    allDay: !r.startTime,
    isSchoolDay,
    isHoliday,
  }
}

/** A row that says only what KIND of day this is, carrying no event of its own. */
function isDayCharacterRow(types: EventTypes, r: EventRow): boolean {
  return r.eventType === types.schoolDay && !r.description
}

/**
 * Group rows by date and apply the named-events-win rule. Pure — the whole
 * selection rule is testable without a database.
 *
 * `rows` must be ordered by date ascending; `today` is YYYY-MM-DD in the
 * school's timezone. Rows dated before today are ignored.
 */
export function buildFeed(types: FeedTypes, rows: EventRow[], today: string): EventsFeed {
  const limit = types.upcomingCount
  const byDate = new Map<string, EventRow[]>()
  for (const r of rows) {
    if (r.date < today) continue
    const list = byDate.get(r.date)
    if (list) list.push(r)
    else byDate.set(r.date, [r])
  }

  const dates = [...byDate.keys()].sort()
  const eventsOn = (date: string): FeedEvent[] => {
    const rowsOnDate = byDate.get(date) ?? []
    const isSchoolDay = rowsOnDate.some(r => r.eventType === types.schoolDay)
    const isHoliday   = rowsOnDate.some(r => r.eventType === types.holiday)
    const named = rowsOnDate.filter(r => !isDayCharacterRow(types, r))
    // A date with only character markers still announces itself once.
    const chosen = named.length > 0 ? named : rowsOnDate.slice(0, 1)
    return chosen.map(r => toFeedEvent(types, r, isSchoolDay, isHoliday))
  }

  const upcoming: FeedEvent[] = []
  for (const d of dates) {
    if (d === today) continue
    for (const e of eventsOn(d)) {
      if (upcoming.length >= limit) break
      upcoming.push(e)
    }
    if (upcoming.length >= limit) break
  }

  return {
    today: byDate.has(today) ? eventsOn(today) : [],
    upcoming,
    today_date: today,
  }
}

/**
 * Read from today forward. The query is bounded by date only — how many events
 * are kept is buildFeed's rule, because a count of events can span any number of
 * rows per date. The roster API's calendar.upcoming runs it.
 */
export async function getEventsFeed(tenantId: string): Promise<EventsFeed> {
  // Today in the school's own zone (its tenant row), never a converted instant.
  const today = await todayOf(tenantId)

  const rows = await db
    .select({
      eventType:      rosterEvents.eventType,
      date:           rosterEvents.date,
      description:    rosterEvents.description,
      startTime:      rosterEvents.startTime,
      endTime:        rosterEvents.endTime,
      typeName:       rosterEventTypes.name,
      classShortCode: rosterCourseCatalog.shortCode,
    })
    .from(rosterEvents)
    .leftJoin(rosterEventTypes, and(
      eq(rosterEventTypes.id, rosterEvents.eventType),
      eq(rosterEventTypes.tenantId, rosterEvents.tenantId),
    ))
    .leftJoin(rosterAvailableClasses, eq(rosterAvailableClasses.id, rosterEvents.classId))
    .leftJoin(rosterCourseCatalog, eq(rosterCourseCatalog.id, rosterAvailableClasses.courseId))
    .where(and(
      eq(rosterEvents.tenantId, tenantId),
      gte(rosterEvents.date, today),
    ))
    .orderBy(rosterEvents.date)

  const cal = await calendarRules(tenantId)
  const types = { ...cal.eventTypes, schoolDayName: await schoolWord(tenantId, 'school-day-name'), upcomingCount: cal.feedUpcoming }
  return buildFeed(types, rows, today)
}
