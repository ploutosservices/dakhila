// Google Calendar sync for the school calendar.
// Impersonates the tenant's lead teacher (leadTeacherEmail) via the tenant's service account.
// All functions take calendarId from the tenant record — no env var needed.
// Server-side only.

import { google, googleAuth } from './google'
import { isProduction } from './host'
import { leadTeacherFor } from './google-school'
import type { CalendarEvent, CalendarRules } from './calendar-types'
import { calendarRules } from './rules-context'
import { outwardAct, ViewAsRefused, type Actor } from './outward-act'
import { notMade, type NotMade } from './not-made'
import { ports } from '../ports'
import { schoolWord } from './school-words'

/** The calendar API acting as one school account (domain-wide delegation). */
async function calendarAs(subject: string) {
  const key = JSON.parse(await ports().google.serviceAccountKey())
  const auth = googleAuth({
    credentials: key,
    scopes: ['https://www.googleapis.com/auth/calendar'],
    clientOptions: { subject },
  })
  return google.calendar({ version: 'v3', auth })
}

/** An event's title in the school calendar: the school's name for a school day; a holiday or an activity by its
 *  description, else the school's name for its type. */
async function eventSummary(tenantId: string, calendar: CalendarRules, event: CalendarEvent): Promise<string> {
  if (event.eventType === calendar.eventTypes.schoolDay) return schoolWord(tenantId, 'school-day-name')
  if (event.description) return event.description
  return schoolWord(tenantId, event.eventType === calendar.eventTypes.holiday ? 'holiday-name' : 'activity-name')
}

// Create calendar under the tenant's lead teacher. Returns the calendar ID, which the caller keeps as the tenant's
// school calendar id (the tenant text 'school-calendar-google-id').
// Gate: Google writes are production-only (same rule as google-classroom.ts). Off production each write returns
// NotMade — the statement of what it did not make — and no id, so nothing fake is stored.

// Every write below is an outward act: recorded under `actor`, refused under view-as, and made as the
// lead teacher, the calendar's owner in Google; the record names the owner the act was made for.
const asLeadTeacher = (owner: string) => ({ by: 'owner-of-resource' as const, whose: owner })

export async function createSchoolCalendar(tenantId: string, actor: Actor): Promise<string | NotMade> {
  const real = isProduction()
  const owner = await leadTeacherFor(tenantId, real)
  const calendarName = await schoolWord(tenantId, 'calendar-name')
  return outwardAct<string | NotMade>(
    { tenantId, kind: 'calendar', actor, role: owner, destination: `a new calendar '${calendarName}'`, delivery: real ? 'real' : 'stand-in', consent: asLeadTeacher(owner) },
    async () => {
      if (!real) return { value: notMade(`Google Calendar: a new calendar '${calendarName}' as ${owner}`) }
      const cal = await calendarAs(owner)
      const res = await cal.calendars.insert({
        requestBody: { summary: calendarName },
      })
      const id = res.data.id
      if (!id) throw new Error('Calendar creation returned no ID')
      return { value: id, vendorRef: id }
    },
  )
}

// Create an all-day event. Returns the Google event ID, NotMade off production, or null on failure.
export async function createCalendarEvent(tenantId: string, calendarId: string, event: CalendarEvent, actor: Actor): Promise<string | NotMade | null> {
  const real = isProduction()
  try {
    const summary = await eventSummary(tenantId, await calendarRules(tenantId), event)
    const owner = await leadTeacherFor(tenantId, real)
    return await outwardAct<string | NotMade | null>(
      { tenantId, kind: 'calendar', actor, role: owner, destination: `calendar ${calendarId}: ${event.date} ${summary}`, delivery: real ? 'real' : 'stand-in', consent: asLeadTeacher(owner) },
      async () => {
        if (!real) return { value: notMade(`Google Calendar: ${event.date} ${summary} on calendar ${calendarId}`) }
        const cal = await calendarAs(owner)
        const res = await cal.events.insert({
          calendarId,
          requestBody: {
            summary,
            start: { date: event.date },
            end:   { date: event.date },
          },
        })
        return { value: res.data.id ?? null, vendorRef: res.data.id ?? null }
      },
    )
  } catch (e) {
    if (e instanceof ViewAsRefused) throw e
    return null
  }
}

// Update an existing event's summary.
export async function updateCalendarEvent(tenantId: string, calendarId: string, googleEventId: string, event: CalendarEvent, actor: Actor): Promise<void | NotMade> {
  const real = isProduction()
  try {
    const summary = await eventSummary(tenantId, await calendarRules(tenantId), event)
    const owner = await leadTeacherFor(tenantId, real)
    return await outwardAct<void | NotMade>(
      { tenantId, kind: 'calendar', actor, role: owner, destination: `calendar ${calendarId} event ${googleEventId}: ${summary}`, delivery: real ? 'real' : 'stand-in', consent: asLeadTeacher(owner) },
      async () => {
        if (!real) return { value: notMade(`Google Calendar: event ${googleEventId} renamed '${summary}'`) }
        const cal = await calendarAs(owner)
        await cal.events.patch({
          calendarId,
          eventId: googleEventId,
          requestBody: { summary },
        })
        return { value: undefined, vendorRef: googleEventId }
      },
    )
  } catch (e) {
    if (e instanceof ViewAsRefused) throw e
    // non-fatal
  }
}

// Delete a Google Calendar event.
export async function deleteCalendarEvent(tenantId: string, calendarId: string, googleEventId: string, actor: Actor): Promise<void | NotMade> {
  const real = isProduction()
  try {
    const owner = await leadTeacherFor(tenantId, real)
    return await outwardAct<void | NotMade>(
      { tenantId, kind: 'calendar', actor, role: owner, destination: `calendar ${calendarId} event ${googleEventId} (deleted)`, delivery: real ? 'real' : 'stand-in', consent: asLeadTeacher(owner) },
      async () => {
        if (!real) return { value: notMade(`Google Calendar: event ${googleEventId} deleted from calendar ${calendarId}`) }
        const cal = await calendarAs(owner)
        await cal.events.delete({ calendarId, eventId: googleEventId })
        return { value: undefined, vendorRef: googleEventId }
      },
    )
  } catch (e) {
    if (e instanceof ViewAsRefused) throw e
    // non-fatal
  }
}

// ── A rehearsal's invitation ─────────────────────────────

export type RehearsalInvite = {
  summary: string; description: string; location: string | null
  date: string; startTime: string; endTime: string; timeZone: string
  guests: string[]
}

/** The rehearsal on a classroom's own calendar, made as the classroom's owner; Google sends the invitations to the
 *  guests (and a cancellation to a guest taken off). Made once, then its guest list replaced. Guests do not see each
 *  other: they are families' personal addresses. Production only — Google's invitations do not pass
 *  host's mail gate, so every other environment returns NotMade naming the guests. Returns the event's id. */
export async function putRehearsalOnCalendar(tenantId: string, owner: string, calendarId: string, googleEventId: string | null, ev: RehearsalInvite, actor: Actor): Promise<string | NotMade> {
  const real = isProduction()
  return outwardAct<string | NotMade>(
    { tenantId, kind: 'calendar', actor, role: owner, destination: `${ev.summary} ${ev.date}: ${ev.guests.join(', ')}`, delivery: real ? 'real' : 'stand-in', consent: asLeadTeacher(owner) },
    async () => {
      if (!real) return { value: notMade(`Google Calendar: the invitation '${ev.summary}' on ${ev.date}, on ${owner}'s calendar, to ${ev.guests.join(', ') || 'no guest'}`, ev.guests) }
      const id = await putOnCalendar(owner, calendarId, googleEventId, ev)
      return { value: id, vendorRef: id }
    },
  )
}

async function putOnCalendar(owner: string, calendarId: string, googleEventId: string | null, ev: RehearsalInvite): Promise<string> {
  const cal = await calendarAs(owner)
  const attendees = ev.guests.map(email => ({ email }))
  if (googleEventId) {
    await cal.events.patch({ calendarId, eventId: googleEventId, sendUpdates: 'all', requestBody: { attendees } })
    return googleEventId
  }
  const res = await cal.events.insert({
    calendarId, sendUpdates: 'all',
    requestBody: {
      summary: ev.summary, description: ev.description, location: ev.location ?? undefined,
      start: { dateTime: `${ev.date}T${ev.startTime}:00`, timeZone: ev.timeZone },
      end:   { dateTime: `${ev.date}T${ev.endTime}:00`, timeZone: ev.timeZone },
      attendees, guestsCanSeeOtherGuests: false,
    },
  })
  if (!res.data.id) throw new Error('Google made the calendar event but returned no id')
  return res.data.id
}
