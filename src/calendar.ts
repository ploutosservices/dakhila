// THE SCHOOL CALENDAR: its reads and acts (lib/calendar.ts, roster-calendar-writes.ts). The family calendar asks only
// that the caller be signed in; the managing read calendar.read; the acts on days and events calendar.write; the
// event-type vocabulary tenant.write. A Google write not made off production comes back as its statement.
import { eq } from 'drizzle-orm'
import { may } from './access'
import type { Call, PersonCall, Route } from './routes'
import { badRequest, field, notFound, ok, result, S } from './op'
import { ports } from './ports'
import { academicYearOf } from './lib/year-context'
import { getAvailableSchoolYears, getCalendarEvents, getClassOptions, getEventTypes } from './lib/calendar'
import { getEventsFeed } from './lib/upcoming-events'
import {
  toggleSchoolDay, addCalendarEvent, deleteCalendarActivity, setEventDescription, addEventTypeNamed, renameEventTypeTo,
  deleteUnusedEventType, syncCalendarEvents,
} from './lib/roster-calendar-writes'

const T = '/v1/tenants/{slug}/roster/calendar'
const ANYONE = 'any signed-in caller: the school calendar is open to every member'
const NOT_MADE = S.obj({ 'notMade?': S.list(S.str) })

/** MARKED public-door: the calendar PDF and the public events feed, which ask no caller. */
const publicDoor = { permission: null, publicDoor: true as const, allowed: async () => false }
const P = '/v1/tenants/{slug}/public'

/** The tenant's timezone, from the tenant row the configuration port answered for the path. */
async function timezoneOf(c: Call): Promise<string | null | undefined> {
  return c.tenant.timezone
}

/** A whole-number path parameter (a year, an event type's id), or null. */
function intOf(s: string): number | null {
  const y = parseInt(s)
  return Number.isFinite(y) ? y : null
}

export const CALENDAR_ROUTES: Route[] = [
  {
    method: 'GET', path: `${P}/calendar`, operationId: 'calendar.publicYear',
    summary: "The whole-school calendar's year and its events, for the public PDF: `year` when the calendar holds it, else the current academic year in the school's timezone, else the newest held.",
    ...publicDoor,
    query: { year: S.str },
    response: S.obj({ startYear: S.num, events: S.list(S.row('a calendar event (src/lib/calendar-types.ts CalendarEvent)')) }),
    handle: async c => {
      const timezone = await timezoneOf(c)
      if (timezone === undefined) return notFound('Tenant not found')
      const available = await getAvailableSchoolYears(c.tenant.id)
      const current = await academicYearOf(c.tenant.id)
      const parsed = c.query.year ? parseInt(c.query.year, 10) : NaN
      const startYear = Number.isInteger(parsed) && available.includes(parsed)
        ? parsed
        : (available.includes(current) ? current : (available[0] ?? current))
      return ok({ startYear, events: await getCalendarEvents(c.tenant.id, startYear) })
    },
  },
  {
    method: 'GET', path: `${P}/upcoming-events`, operationId: 'calendar.upcoming',
    summary: "The public events feed: today's events and the next ones, by the school's timezone.",
    ...publicDoor,
    response: S.row('the events feed (src/lib/upcoming-events.ts EventsFeed)'),
    handle: async c => {
      const timezone = await timezoneOf(c)
      if (timezone === undefined) return notFound('Tenant not found')
      return ok(await getEventsFeed(c.tenant.id))
    },
  },
  {
    method: 'GET', path: T, operationId: 'calendar.years',
    summary: 'The school years the calendar holds days for, newest first.',
    permission: null, alsoAllowed: ANYONE,
    allowed: async () => true,
    response: S.obj({ years: S.list(S.num) }),
    handle: async c => ok({ years: await getAvailableSchoolYears(c.tenant.id) }),
  },
  {
    method: 'GET', path: `${T}/{year}`, operationId: 'calendar.year',
    summary: "A school year's days and events, each with its type's name and its class's short code.",
    permission: null, alsoAllowed: ANYONE,
    textParams: ['year'],
    allowed: async () => true,
    response: S.obj({ events: S.list(S.row('a calendar event (src/lib/calendar-types.ts CalendarEvent)')) }),
    handle: async c => {
      const year = intOf(c.params.year)
      if (year === null) return badRequest('year must be a number')
      return ok({ events: await getCalendarEvents(c.tenant.id, year) })
    },
  },
  {
    method: 'GET', path: `${T}/{year}/choices`, operationId: 'calendar.choices',
    summary: "What an event may be: the tenant's event types (school day and holiday aside) and the year's classes.",
    permission: 'calendar.read',
    textParams: ['year'],
    allowed: async c => may(c.caller, 'calendar.read'),
    response: S.obj({ eventTypes: S.list(S.obj({ id: S.num, name: S.str })), classes: S.list(S.row('a class option: id, shortCode, section, fullName')) }),
    handle: async c => {
      const year = intOf(c.params.year)
      if (year === null) return badRequest('year must be a number')
      return ok({ eventTypes: await getEventTypes(c.tenant.id), classes: await getClassOptions(c.tenant.id, year) })
    },
  },
  {
    method: 'POST', path: `${T}/days/{date}`, operationId: 'calendar.toggleDay',
    summary: 'A date turned from school day to holiday (currentType school) or back, mirrored to the linked Google calendar; the year\'s weeks renumbered.',
    permission: 'calendar.write',
    textParams: ['date'],
    allowed: async c => may(c.caller, 'calendar.write'),
    request: S.obj({ currentType: S.str, description: S.str }),
    response: NOT_MADE,
    handle: async c => {
      const current = field.str(c.body, 'currentType')
      if (current !== 'school' && current !== 'holiday') return badRequest('currentType must be school or holiday')
      return ok(await toggleSchoolDay(c.tenant.id, c.params.date, current, field.str(c.body, 'description'), (c as PersonCall).actor))
    },
  },
  {
    method: 'POST', path: `${T}/events`, operationId: 'calendar.addEvent',
    summary: 'An activity added to a date, which becomes a school day (a holiday there is replaced); pushed to Google when linked.',
    permission: 'calendar.write',
    allowed: async c => may(c.caller, 'calendar.write'),
    request: S.obj({ date: S.date, eventType: S.num, classId: S.nullable(S.uuid), description: S.str }),
    response: NOT_MADE,
    handle: async c => {
      // The type as handed: a number, or a numeric string from a form.
      const eventType = field.obj(c.body).eventType
      if (typeof eventType !== 'number' && !(typeof eventType === 'string' && /^\d+$/.test(eventType))) return badRequest('eventType must be a number')
      return result(await addCalendarEvent(c.tenant.id, field.str(c.body, 'date'), eventType as number,
        field.strOrNull(c.body, 'classId'), field.str(c.body, 'description'), (c as PersonCall).actor))
    },
  },
  {
    method: 'DELETE', path: `${T}/events/{id}`, operationId: 'calendar.deleteEvent',
    summary: 'An activity removed (never a school day or holiday), from Google too when linked.',
    permission: 'calendar.write',
    allowed: async c => may(c.caller, 'calendar.write'),
    response: NOT_MADE,
    handle: async c => result(await deleteCalendarActivity(c.tenant.id, c.params.id, (c as PersonCall).actor)),
  },
  {
    method: 'PUT', path: `${T}/events/{id}`, operationId: 'calendar.describeEvent',
    summary: "An event's description, in Google too when linked.",
    permission: 'calendar.write',
    allowed: async c => may(c.caller, 'calendar.write'),
    request: S.obj({ description: S.nullable(S.str) }),
    response: NOT_MADE,
    // A null description clears it.
    handle: async c => ok(await setEventDescription(c.tenant.id, c.params.id, field.strOrNull(c.body, 'description') as string, (c as PersonCall).actor)),
  },
  {
    method: 'POST', path: `${T}/{year}/google`, operationId: 'calendar.sync',
    summary: "The Google calendar made once, then every unlinked event of the school year pushed to it.",
    permission: 'calendar.write',
    textParams: ['year'],
    allowed: async c => may(c.caller, 'calendar.write'),
    response: S.obj({ synced: S.num, skipped: S.num, notMade: S.list(S.str) }),
    handle: async c => {
      const year = intOf(c.params.year)
      if (year === null) return badRequest('year must be a number')
      return ok(await syncCalendarEvents(c.tenant.id, year, (c as PersonCall).actor))
    },
  },
  {
    method: 'POST', path: `${T}/event-types`, operationId: 'calendar.addEventType',
    summary: 'An event type added by name, at the next free power of two.',
    permission: 'tenant.write',
    allowed: async c => may(c.caller, 'tenant.write'),
    request: S.obj({ name: S.str }),
    response: S.obj({}),
    handle: async c => result(await addEventTypeNamed(c.tenant.id, field.str(c.body, 'name'))),
  },
  {
    method: 'PUT', path: `${T}/event-types/{id}`, operationId: 'calendar.renameEventType',
    summary: 'An event type renamed.',
    permission: 'tenant.write',
    textParams: ['id'],
    allowed: async c => may(c.caller, 'tenant.write'),
    request: S.obj({ name: S.str }),
    response: S.obj({}),
    handle: async c => {
      const id = intOf(c.params.id)
      if (id === null) return badRequest('id must be a number')
      await renameEventTypeTo(c.tenant.id, id, field.str(c.body, 'name'))
      return ok({})
    },
  },
  {
    method: 'DELETE', path: `${T}/event-types/{id}`, operationId: 'calendar.deleteEventType',
    summary: 'An event type removed, refused while any event in any year uses it.',
    permission: 'tenant.write',
    textParams: ['id'],
    allowed: async c => may(c.caller, 'tenant.write'),
    response: S.obj({}),
    handle: async c => {
      const id = intOf(c.params.id)
      if (id === null) return badRequest('id must be a number')
      return result(await deleteUnusedEventType(c.tenant.id, id))
    },
  },
]
