// Calendar data access — roster_events for the school calendar. The types and the grid, store-free, are
// calendar-types.ts.

import { db } from './db'
import { rosterEvents, rosterEventTypes, rosterAvailableClasses, rosterCourseCatalog } from '../tables'
import { eq, and, gte, lte, notInArray, asc } from 'drizzle-orm'
import { systemEventTypes } from './calendar-types'
import type { CalendarEvent, EventTypeOption, ClassOption } from './calendar-types'
import { schoolYearBounds, schoolYearForDate } from './years'
import { yearRules } from './year-context'
import { calendarRules } from './rules-context'

export { systemEventTypes, buildCalendarGrid } from './calendar-types'
export type { CalendarEvent, CalendarMonth } from './calendar-types'

// One definition, in lib/enrollment.ts: two copies agree until one is edited.
export { schoolYearLabel } from './enrollment'

export async function getCalendarEvents(tenantId: string, startYear: number): Promise<CalendarEvent[]> {
  const { startDate, endDate } = schoolYearBounds(await yearRules(tenantId), startYear)
  // Type name and class short code are joined in, never reconstructed by a reader:
  // an event's label is (type, class), not a typed-in sentence.
  const rows = await db
    .select({
      id:                    rosterEvents.id,
      eventType:             rosterEvents.eventType,
      date:                  rosterEvents.date,
      weekNumber:            rosterEvents.weekNumber,
      description:           rosterEvents.description,
      googleCalendarEventId: rosterEvents.googleCalendarEventId,
      classId:               rosterEvents.classId,
      typeName:              rosterEventTypes.name,
      classShortCode:        rosterCourseCatalog.shortCode,
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
      gte(rosterEvents.date, startDate),
      lte(rosterEvents.date, endDate),
    ))
    .orderBy(rosterEvents.date)

  return rows.map(r => ({
    id:                    r.id,
    eventType:             r.eventType,
    date:                  r.date,
    weekNumber:            r.weekNumber,
    description:           r.description,
    googleCalendarEventId: r.googleCalendarEventId,
    classId:               r.classId,
    typeName:              r.typeName,
    classShortCode:        r.classShortCode,
  }))
}

/**
 * The event types the principal may choose from — read from the table, never
 * from code, so adding one is a row rather than a deploy.
 *
 * SchoolDay and Holiday are excluded: they are not ordinary types but the day's
 * own character. Week numbering, the school-day counts and the "is today a
 * school day" check all key off them, so they are set through
 * toggleSchoolDay and are never editable as vocabulary.
 */
export async function getEventTypes(tenantId: string): Promise<EventTypeOption[]> {
  return db
    .select({ id: rosterEventTypes.id, name: rosterEventTypes.name })
    .from(rosterEventTypes)
    .where(and(
      eq(rosterEventTypes.tenantId, tenantId),
      notInArray(rosterEventTypes.id, systemEventTypes(await calendarRules(tenantId))),
    ))
    .orderBy(asc(rosterEventTypes.name))
}

/** Classes offered in a school year, for scoping an event to one class. */
export async function getClassOptions(tenantId: string, year: number): Promise<ClassOption[]> {
  const rows = await db
    .select({
      id:        rosterAvailableClasses.id,
      shortCode: rosterCourseCatalog.shortCode,
      section:   rosterAvailableClasses.section,
      fullName:  rosterCourseCatalog.fullName,
    })
    .from(rosterAvailableClasses)
    .innerJoin(rosterCourseCatalog, eq(rosterCourseCatalog.id, rosterAvailableClasses.courseId))
    .where(and(
      eq(rosterAvailableClasses.tenantId, tenantId),
      eq(rosterAvailableClasses.year, year),
    ))
    .orderBy(asc(rosterCourseCatalog.shortCode))

  return rows.map(r => ({ id: r.id, shortCode: r.shortCode, section: r.section, fullName: r.fullName }))
}

export async function getAvailableSchoolYears(tenantId: string): Promise<number[]> {
  const rows = await db
    .selectDistinct({ date: rosterEvents.date })
    .from(rosterEvents)
    .where(eq(rosterEvents.tenantId, tenantId))
    .orderBy(rosterEvents.date)

  const y = await yearRules(tenantId)
  const years = new Set<number>()
  for (const r of rows) years.add(schoolYearForDate(y, r.date))
  return [...years].sort((a, b) => b - a)
}

/** Whether the date (YYYY-MM-DD) is a school day on the tenant's calendar. */
export async function isSchoolDate(tenantId: string, date: string): Promise<boolean> {
  const { schoolDay } = (await calendarRules(tenantId)).eventTypes
  const rows = await db
    .select({ id: rosterEvents.id })
    .from(rosterEvents)
    .where(and(eq(rosterEvents.tenantId, tenantId), eq(rosterEvents.date, date), eq(rosterEvents.eventType, schoolDay)))
    .limit(1)
  return rows.length > 0
}
