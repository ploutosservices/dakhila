// A FAMILY'S EVALUATION REPORTS: the family of the signed-in address, its members, and the submitted evaluations of
// any of them.
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import { db } from './db'
import { persons, rosterAvailableClasses, rosterCourseCatalog, rosterEvaluations } from '../tables'

/** The family of the person whose address is exactly `email` (deleted rows included). */
export async function familyIdOfAddress(tenantId: string, email: string): Promise<string | null> {
  const userPerson = await db
    .select({ familyId: persons.familyId })
    .from(persons)
    .where(and(eq(persons.email, email), eq(persons.tenantId, tenantId)))
    .limit(1)
  return userPerson[0]?.familyId ?? null
}

/** EVERY live member of the family — no role filter. */
export function familyMembers(tenantId: string, familyId: string) {
  return db
    .select({ id: persons.id, firstName: persons.firstName, lastName: persons.lastName })
    .from(persons)
    .where(and(eq(persons.familyId, familyId), eq(persons.tenantId, tenantId), isNull(persons.deletedAt)))
}

/** The submitted evaluations of the given persons, with each one's class, by year. */
export function submittedEvaluationsOf(tenantId: string, personIds: string[]) {
  return db
    .select({
      id: rosterEvaluations.id,
      studentId: rosterEvaluations.studentId,
      year: rosterEvaluations.year,
      shortCode: rosterCourseCatalog.shortCode,
      section: rosterAvailableClasses.section,
      fullName: rosterCourseCatalog.fullName,
      submittedAt: rosterEvaluations.submittedAt,
    })
    .from(rosterEvaluations)
    .leftJoin(rosterAvailableClasses, eq(rosterAvailableClasses.id, rosterEvaluations.classId))
    .leftJoin(rosterCourseCatalog, eq(rosterCourseCatalog.id, rosterAvailableClasses.courseId))
    .where(and(
      eq(rosterEvaluations.tenantId, tenantId),
      inArray(rosterEvaluations.studentId, personIds),
      isNotNull(rosterEvaluations.submittedAt),
    ))
    .orderBy(rosterEvaluations.year)
}
