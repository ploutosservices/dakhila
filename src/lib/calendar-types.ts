// Calendar types — pure, no store. The event types the calendar treats
// specially (school day, holiday, activity) are the school's rows, named by id in its rules
// (SchoolRules.calendar.eventTypes).
import type { SchoolRules } from '../ports'
import { monthWords, weekdayWords } from './zoned'

/** The school's calendar rules, as the calendar's code reads them. */
export type CalendarRules = SchoolRules['calendar']

/** The school's class weekday, short in its language, for a grid's column heads. */
export function classWeekdayShort(calendar: CalendarRules, language: string): string {
  return weekdayWords(calendar.classWeekday, language)
}

/**
 * Types that describe the DAY itself rather than something happening on it: the school day and the holiday.
 * They carry structural meaning — week numbering, school-day counts, and the
 * "is today a school day" check — so they are set through
 * toggleSchoolDay, are never offered as event vocabulary, and cannot be renamed
 * or deleted by anyone.
 */
export function systemEventTypes(calendar: CalendarRules): number[] {
  return [calendar.eventTypes.schoolDay, calendar.eventTypes.holiday]
}

export type CalendarEvent = {
  id: string
  eventType: number
  date: string
  weekNumber: number | null
  description: string | null
  googleCalendarEventId: string | null
  classId?: string | null
  /** Joined from roster_event_types — the label, never reconstructed by a reader. */
  typeName?: string | null
  /** Joined via the class's course — e.g. "X2". */
  classShortCode?: string | null
}

export type EventTypeOption = { id: number; name: string }

export type ClassOption = { id: string; shortCode: string; section: string | null; fullName: string }

/** An event's display label is (type, class), with a description only if one was added. */
export function eventLabel(e: Pick<CalendarEvent, 'typeName' | 'classShortCode' | 'description'>): string {
  const base = [e.typeName, e.classShortCode].filter(Boolean).join(' — ')
  if (base && e.description) return `${base}: ${e.description}`
  return base || e.description || ''
}

export type CalendarMonth = {
  month: number
  year: number
  label: string
  /** The class weekday's short name, for the column heads. */
  classDay: string
  days: Array<{ date: string; events: CalendarEvent[] }>
  schoolDayCount: number
}

// The grid, pure (calendar.ts re-exports it), so a reader builds the grid from the roster API's rows. The year's
// arithmetic is years.ts.

/** The school year's grid: each month classes meet (the school's `classMonths`, in order), each day of it on the
 *  school's class weekday, with that day's events; month names and the class day's name in the school's language.
 *  `month` in the answer counts from 0. */
export function buildCalendarGrid(calendar: SchoolRules['calendar'], events: CalendarEvent[], startYear: number, language: string): CalendarMonth[] {
  const months = calendar.classMonths.map(m => ({ year: startYear + m.yearOffset, month: m.month - 1 }))

  const byDate = new Map<string, CalendarEvent[]>()
  for (const e of events) {
    if (!byDate.has(e.date)) byDate.set(e.date, [])
    byDate.get(e.date)!.push(e)
  }

  return months.map(({ year, month }) => {
    // Calendar days, worked in UTC so no zone moves a day.
    const classDays: string[] = []
    const offset = (7 + calendar.classWeekday - new Date(Date.UTC(year, month, 1)).getUTCDay()) % 7
    const d = new Date(Date.UTC(year, month, 1 + offset))
    while (d.getUTCMonth() === month) {
      classDays.push(d.toISOString().slice(0, 10))
      d.setUTCDate(d.getUTCDate() + 7)
    }

    const days = classDays.map(date => ({
      date,
      events: byDate.get(date) ?? [],
    }))

    const schoolDayCount = days.reduce(
      (n, day) => n + (day.events.some(e => e.eventType === calendar.eventTypes.schoolDay) ? 1 : 0),
      0,
    )

    return { month, year, label: monthWords(month + 1, language), classDay: classWeekdayShort(calendar, language), days, schoolDayCount }
  })
}
