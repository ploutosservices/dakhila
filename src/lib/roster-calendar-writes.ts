// THE SCHOOL CALENDAR, WRITTEN: school days and holidays, activities, the event-type vocabulary, and the mirror in
// Google Calendar. The caller decides who may (calendar.write, or tenant.write for the vocabulary); these write.
import type { Actor } from './outward-act'
import { db } from './db'
import { rosterEvents, rosterEventTypes, rosterAvailableClasses } from '../tables'
import { eq, and, gte, lte } from 'drizzle-orm'
import { getCalendarEvents } from './calendar'
import { schoolYearBounds, schoolYearForDate } from './years'
import { yearRules } from './year-context'
import { systemEventTypes } from './calendar-types'
import { calendarRules } from './rules-context'
import {
  createSchoolCalendar,
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
} from './google-calendar'
import { catalogValueOrNull, setCatalogValue } from './message-catalog'
import { isNotMade } from './not-made'
import { schoolWord } from './school-words'

// Off production a Google write is not made: its statement is collected and handed back for the screen
// that pressed, and no id is stored — an id is kept only when Google made the thing it names.
function noted(said: string[], r: unknown): void {
  if (isNotMade(r)) said.push(r.statement)
}

/** Push one row to Google; store its event id only when made. */
async function pushEvent(tenantId: string, calendarId: string, row: typeof rosterEvents.$inferSelect, actor: Actor, said: string[]): Promise<boolean> {
  const googleId = await createCalendarEvent(tenantId, calendarId, { ...row, googleCalendarEventId: null }, actor)
  if (isNotMade(googleId)) { said.push(googleId.statement); return false }
  if (!googleId) return false
  await db.update(rosterEvents).set({ googleCalendarEventId: googleId }).where(eq(rosterEvents.id, row.id))
  return true
}

/** Turn a date from school day to holiday or back, mirroring the change to the linked Google calendar, and renumber the year's weeks. */
export async function toggleSchoolDay(tenantId: string, date: string, currentType: 'school' | 'holiday', description: string, actor: Actor): Promise<{ notMade: string[] }> {
  const said: string[] = []
  const y = await yearRules(tenantId)
  const schoolYear = schoolYearForDate(y, date)
  const { startDate, endDate } = schoolYearBounds(y, schoolYear)
  const types = y.calendar.eventTypes
  const calendarId = await catalogValueOrNull(tenantId, 'school-calendar-google-id')

  if (currentType === 'school') {
    const [old] = await db
      .select({ googleCalendarEventId: rosterEvents.googleCalendarEventId })
      .from(rosterEvents)
      .where(and(
        eq(rosterEvents.tenantId, tenantId),
        eq(rosterEvents.date, date),
        eq(rosterEvents.eventType, types.schoolDay),
      ))
      .limit(1)

    await db.delete(rosterEvents).where(and(
      eq(rosterEvents.tenantId, tenantId),
      eq(rosterEvents.date, date),
      eq(rosterEvents.eventType, types.schoolDay),
    ))

    const [inserted] = await db.insert(rosterEvents).values({
      tenantId:    tenantId,
      eventType:   types.holiday,
      date,
      description: description || await schoolWord(tenantId, 'holiday-name'),
    }).returning()

    if (calendarId) {
      if (old?.googleCalendarEventId) noted(said, await deleteCalendarEvent(tenantId, calendarId, old.googleCalendarEventId, actor))
      await pushEvent(tenantId, calendarId, inserted, actor, said)
    }
  } else {
    const [old] = await db
      .select({ googleCalendarEventId: rosterEvents.googleCalendarEventId })
      .from(rosterEvents)
      .where(and(
        eq(rosterEvents.tenantId, tenantId),
        eq(rosterEvents.date, date),
        eq(rosterEvents.eventType, types.holiday),
      ))
      .limit(1)

    await db.delete(rosterEvents).where(and(
      eq(rosterEvents.tenantId, tenantId),
      eq(rosterEvents.date, date),
      eq(rosterEvents.eventType, types.holiday),
    ))

    const [inserted] = await db.insert(rosterEvents).values({
      tenantId:  tenantId,
      eventType: types.schoolDay,
      date,
    }).returning()

    if (calendarId) {
      if (old?.googleCalendarEventId) noted(said, await deleteCalendarEvent(tenantId, calendarId, old.googleCalendarEventId, actor))
      await pushEvent(tenantId, calendarId, inserted, actor, said)
    }
  }

  await renumberWeeks(tenantId, startDate, endDate)
  return { notMade: said }
}

/** Add an activity to a date, which becomes a school day (a holiday there is replaced); pushed to Google when linked. */
export async function addCalendarEvent(tenantId: string, date: string, eventType: number, classId: string | null, description: string, actor: Actor): Promise<{ error?: string; notMade?: string[] }> {
  const text = description.trim()
  const said: string[] = []


  // The type must exist for this tenant and must not be a system type —
  // an event never redefines the day's own character.
  const calendar = await calendarRules(tenantId)
  const types = calendar.eventTypes
  if (systemEventTypes(calendar).includes(eventType)) {
    return { error: 'School day and holiday are set on the date itself, not added as events.' }
  }
  const [type] = await db
    .select({ id: rosterEventTypes.id })
    .from(rosterEventTypes)
    .where(and(eq(rosterEventTypes.id, eventType), eq(rosterEventTypes.tenantId, tenantId)))
    .limit(1)
  if (!type) return { error: 'Unknown event type.' }

  // A class, if given, must belong to this tenant.
  if (classId) {
    const [cls] = await db
      .select({ id: rosterAvailableClasses.id })
      .from(rosterAvailableClasses)
      .where(and(eq(rosterAvailableClasses.id, classId), eq(rosterAvailableClasses.tenantId, tenantId)))
      .limit(1)
    if (!cls) return { error: 'Unknown class.' }
  }
  const y = await yearRules(tenantId)
  const schoolYear = schoolYearForDate(y, date)
  const { startDate, endDate } = schoolYearBounds(y, schoolYear)
  const calendarId = await catalogValueOrNull(tenantId, 'school-calendar-google-id')

  // The date must be a school day. Replace a holiday row if one is present,
  // and create the school-day row if it is missing.
  const dayRows = await db
    .select({
      id: rosterEvents.id,
      eventType: rosterEvents.eventType,
      googleCalendarEventId: rosterEvents.googleCalendarEventId,
    })
    .from(rosterEvents)
    .where(and(eq(rosterEvents.tenantId, tenantId), eq(rosterEvents.date, date)))

  const holiday   = dayRows.find(r => r.eventType === types.holiday)
  const schoolDay = dayRows.find(r => r.eventType === types.schoolDay)

  if (holiday) {
    if (calendarId && holiday.googleCalendarEventId) {
      noted(said, await deleteCalendarEvent(tenantId, calendarId, holiday.googleCalendarEventId, actor))
    }
    await db.delete(rosterEvents).where(eq(rosterEvents.id, holiday.id))
  }

  if (!schoolDay) {
    const [newSchoolDay] = await db.insert(rosterEvents).values({
      tenantId:  tenantId,
      eventType: types.schoolDay,
      date,
    }).returning()
    if (calendarId) await pushEvent(tenantId, calendarId, newSchoolDay, actor, said)
  }

  const [inserted] = await db.insert(rosterEvents).values({
    tenantId:    tenantId,
    eventType,
    date,
    classId:     classId || null,
    description: text || null,
  }).returning()

  if (calendarId) await pushEvent(tenantId, calendarId, inserted, actor, said)

  if (holiday || !schoolDay) await renumberWeeks(tenantId, startDate, endDate)
  return { notMade: said }
}

/** Delete an activity row (never a school day or holiday), from Google too when linked. */
export async function deleteCalendarActivity(tenantId: string, eventId: string, actor: Actor): Promise<{ error?: string; notMade?: string[] }> {
  const said: string[] = []

  const [row] = await db
    .select()
    .from(rosterEvents)
    .where(and(eq(rosterEvents.id, eventId), eq(rosterEvents.tenantId, tenantId)))
    .limit(1)

  if (!row) return { error: 'Event not found.' }
  if (systemEventTypes(await calendarRules(tenantId)).includes(row.eventType)) {
    return { error: 'Only events can be deleted here. Use the day itself to change school day or holiday.' }
  }

  const calendarId = await catalogValueOrNull(tenantId, 'school-calendar-google-id')
  if (calendarId && row.googleCalendarEventId) {
    noted(said, await deleteCalendarEvent(tenantId, calendarId, row.googleCalendarEventId, actor))
  }

  await db.delete(rosterEvents).where(eq(rosterEvents.id, row.id))
  return { notMade: said }
}

/** Set an event's description, in Google too when linked. */
export async function setEventDescription(tenantId: string, eventId: string, description: string, actor: Actor): Promise<{ notMade: string[] }> {
  const said: string[] = []
  const [updated] = await db
    .update(rosterEvents)
    .set({ description })
    .where(and(eq(rosterEvents.id, eventId), eq(rosterEvents.tenantId, tenantId)))
    .returning()

  const calendarId = await catalogValueOrNull(tenantId, 'school-calendar-google-id')
  if (calendarId && updated?.googleCalendarEventId) {
    noted(said, await updateCalendarEvent(tenantId, calendarId, updated.googleCalendarEventId, {
      ...updated,
      googleCalendarEventId: updated.googleCalendarEventId,
    }, actor))
  }
  return { notMade: said }
}

/** Add an event type by name, at the next free power of two (ids are powers of two: a bitmask). */
export async function addEventTypeNamed(tenantId: string, text: string): Promise<{ error?: string }> {

  const existing = await db
    .select({ id: rosterEventTypes.id, name: rosterEventTypes.name })
    .from(rosterEventTypes)
    .where(eq(rosterEventTypes.tenantId, tenantId))

  if (existing.some(t => t.name.toLowerCase() === text.toLowerCase())) {
    return { error: `"${text}" already exists.` }
  }

  // Ids are powers of two (a bitmask). Take the next
  // free power above the highest in use so existing values keep their meaning.
  const highest = existing.reduce((n, t) => Math.max(n, t.id), 0)
  const nextId = highest === 0 ? 1 : highest * 2
  if (!Number.isSafeInteger(nextId)) return { error: 'No id space left for a new type.' }

  await db.insert(rosterEventTypes).values({ id: nextId, tenantId: tenantId, name: text })
  return {}
}

/** Rename an event type. */
export async function renameEventTypeTo(tenantId: string, id: number, text: string): Promise<void> {
  await db
    .update(rosterEventTypes)
    .set({ name: text })
    .where(and(eq(rosterEventTypes.id, id), eq(rosterEventTypes.tenantId, tenantId)))
}

/** Delete an event type no event uses, in any year. */
export async function deleteUnusedEventType(tenantId: string, id: number): Promise<{ error?: string }> {

  const inUse = await db
    .select({ id: rosterEvents.id })
    .from(rosterEvents)
    .where(and(eq(rosterEvents.tenantId, tenantId), eq(rosterEvents.eventType, id)))
    .limit(1)

  if (inUse.length) {
    return { error: 'That type is used by existing events, including past years. Rename it instead of deleting it.' }
  }

  await db
    .delete(rosterEventTypes)
    .where(and(eq(rosterEventTypes.id, id), eq(rosterEventTypes.tenantId, tenantId)))
  return {}
}

/** Create the Google calendar once, then push every unlinked event of the school year. */
export async function syncCalendarEvents(tenantId: string, schoolYear: number, actor: Actor): Promise<{ synced: number; skipped: number; notMade: string[] }> {
  const said: string[] = []

  // Create calendar if not yet done (once in a lifetime — the id then lives
  // in the tenant's texts, never as a property of the tenant row). A calendar not made is not stored, and no event can be
  // pushed to it.
  let calendarId = await catalogValueOrNull(tenantId, 'school-calendar-google-id')
  if (!calendarId) {
    const made = await createSchoolCalendar(tenantId, actor)
    if (isNotMade(made)) return { synced: 0, skipped: 0, notMade: [made.statement] }
    calendarId = made
    await setCatalogValue(tenantId,'school-calendar-google-id', calendarId)
  }

  const events = await getCalendarEvents(tenantId, schoolYear)
  let synced = 0
  let skipped = 0

  for (const event of events) {
    if (event.googleCalendarEventId) { skipped++; continue }
    const googleId = await createCalendarEvent(tenantId, calendarId, event, actor)
    if (isNotMade(googleId)) { said.push(googleId.statement); continue }
    if (googleId) {
      await db.update(rosterEvents)
        .set({ googleCalendarEventId: googleId })
        .where(eq(rosterEvents.id, event.id))
      synced++
    }
  }
  return { synced, skipped, notMade: said }
}

async function renumberWeeks(tenantId: string, startDate: string, endDate: string) {
  const types = (await calendarRules(tenantId)).eventTypes
  const schoolDays = await db
    .select({ id: rosterEvents.id })
    .from(rosterEvents)
    .where(and(
      eq(rosterEvents.tenantId, tenantId),
      eq(rosterEvents.eventType, types.schoolDay),
      gte(rosterEvents.date, startDate),
      lte(rosterEvents.date, endDate),
    ))
    .orderBy(rosterEvents.date)

  let week = 0
  for (const row of schoolDays) {
    await db.update(rosterEvents).set({ weekNumber: ++week }).where(eq(rosterEvents.id, row.id))
  }
}
