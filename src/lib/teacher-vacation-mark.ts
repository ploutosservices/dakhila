// A TEACHER'S VACATION MARK, WRITTEN, apart from the reads (roster-teacher-vacation.ts); the roster API is its caller.
import { db } from './db'
import { rosterTeacherUnavailability, rosterEvents } from '../tables'
import { and, eq, sql } from 'drizzle-orm'
import { calendarRules } from './rules-context'

// THE one write door. Marks or unmarks one school day for one teacher.
// Refuses a date that is not a school day — the calendar is the authority,
// so a typo or a day without class can never become a mark.
export async function setTeacherVacation(
  tenantId: string, personId: string, dateStr: string, away: boolean
): Promise<{ error: string } | undefined> {
  const schoolDayType = (await calendarRules(tenantId)).eventTypes.schoolDay
  const [schoolDay] = await db
    .select({ date: rosterEvents.date })
    .from(rosterEvents)
    .where(and(
      eq(rosterEvents.tenantId, tenantId),
      eq(rosterEvents.date, dateStr),
      sql`${rosterEvents.eventType} & ${schoolDayType} > 0`,
    ))
    .limit(1)
  if (!schoolDay) return { error: `${dateStr} is not a school day` }

  if (away) {
    await db.insert(rosterTeacherUnavailability)
      .values({ tenantId, personId, date: dateStr })
      .onConflictDoNothing()
  } else {
    await db.delete(rosterTeacherUnavailability)
      .where(and(
        eq(rosterTeacherUnavailability.tenantId, tenantId),
        eq(rosterTeacherUnavailability.personId, personId),
        eq(rosterTeacherUnavailability.date, dateStr),
      ))
  }
  return undefined
}
