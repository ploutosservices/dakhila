// THE ENROLLMENT TRACKER'S READS — the tracker and the principal's summary of it. Each tracker row comes
// with the family's fee-enrollment status for the same year, which is what decides "enrolled".
import { and, eq, inArray, isNull, max } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { db } from './db'
import { persons, rosterFamilies, rosterFamilyTracker, familyEnrollments, familyEnrollmentStudents } from '../tables'

/** Tracker rows for the given years, each with the fee enrollment's status for that year (null when none). */
export function trackerStatusesForYears(tenantId: string, years: number[]) {
  return db
    .select({
      year: rosterFamilyTracker.year,
      enrollmentStatus: rosterFamilyTracker.enrollmentStatus,
      feeEnrollmentStatus: familyEnrollments.status,
    })
    .from(rosterFamilyTracker)
    .leftJoin(familyEnrollments, and(
      eq(familyEnrollments.familyId, rosterFamilyTracker.familyId),
      eq(familyEnrollments.tenantId, rosterFamilyTracker.tenantId),
      eq(familyEnrollments.year, rosterFamilyTracker.year),
    ))
    .where(and(
      eq(rosterFamilyTracker.tenantId, tenantId),
      inArray(rosterFamilyTracker.year, years),
    ))
}

/** One year's tracker: each family with its parents' names and contacts and its fee enrollment's status. */
export function trackerFamiliesForYear(tenantId: string, year: number) {
  const motherPersons = alias(persons, 'mother_person')
  const fatherPersons = alias(persons, 'father_person')
  return db
    .select({
      familyId: rosterFamilies.id,
      legacyFamilyId: rosterFamilies.legacyFamilyId,
      enrollmentStatus: rosterFamilyTracker.enrollmentStatus,
      feeEnrollmentStatus: familyEnrollments.status,
      registrationDate: rosterFamilyTracker.registrationDate,
      motherFirstName: motherPersons.firstName,
      motherEmail: motherPersons.email,
      motherPhone: motherPersons.phone,
      fatherFirstName: fatherPersons.firstName,
      fatherEmail: fatherPersons.email,
      fatherPhone: fatherPersons.phone,
    })
    .from(rosterFamilyTracker)
    .innerJoin(rosterFamilies, eq(rosterFamilies.id, rosterFamilyTracker.familyId))
    .leftJoin(motherPersons, eq(motherPersons.id, rosterFamilies.motherId))
    .leftJoin(fatherPersons, eq(fatherPersons.id, rosterFamilies.fatherId))
    .leftJoin(familyEnrollments, and(
      eq(familyEnrollments.familyId, rosterFamilyTracker.familyId),
      eq(familyEnrollments.tenantId, rosterFamilyTracker.tenantId),
      eq(familyEnrollments.year, rosterFamilyTracker.year),
    ))
    .where(and(
      eq(rosterFamilyTracker.tenantId, tenantId),
      eq(rosterFamilyTracker.year, year),
    ))
}

/** Every live member of the given families — what the eligible-kids rule reads. */
export async function membersOfFamilies(familyIds: string[]) {
  if (familyIds.length === 0) return []
  return db.select({ familyId: persons.familyId, firstName: persons.firstName, role: persons.role, firstGradeYear: persons.firstGradeYear })
    .from(persons)
    .where(and(inArray(persons.familyId, familyIds), isNull(persons.deletedAt)))
}

/** The live students each of the given families enrolled for the year. */
export async function enrolledStudentsOfFamilies(tenantId: string, year: number, familyIds: string[]) {
  if (familyIds.length === 0) return []
  return db.select({ familyId: familyEnrollments.familyId, firstName: persons.firstName, firstGradeYear: persons.firstGradeYear })
    .from(familyEnrollmentStudents)
    .innerJoin(familyEnrollments, eq(familyEnrollments.id, familyEnrollmentStudents.enrollmentId))
    .innerJoin(persons, eq(persons.id, familyEnrollmentStudents.studentId))
    .where(and(
      eq(familyEnrollments.tenantId, tenantId),
      eq(familyEnrollments.year, year),
      inArray(familyEnrollments.familyId, familyIds),
      isNull(familyEnrollmentStudents.droppedOutAt),
      isNull(persons.deletedAt),
    ))
}

/** The last year each family of the tenant holds an enrollment for. */
export function lastEnrolledYears(tenantId: string) {
  return db
    .select({ familyId: familyEnrollments.familyId, lastYear: max(familyEnrollments.year) })
    .from(familyEnrollments)
    .where(eq(familyEnrollments.tenantId, tenantId))
    .groupBy(familyEnrollments.familyId)
}

/**
 * The year's follow-up rows — each tracked family with its parents' first names and its fee enrollment's status, by
 * legacy family id; `familyId` narrows to one family (the family's own view).
 */
export function followUpRows(tenantId: string, year: number, familyId?: string) {
  const motherP = alias(persons, 'mother_person')
  const fatherP = alias(persons, 'father_person')
  return db
    .select({
      trackerId: rosterFamilyTracker.id,
      familyId: rosterFamilies.id,
      legacyFamilyId: rosterFamilies.legacyFamilyId,
      trackerStatus: rosterFamilyTracker.enrollmentStatus,
      feeEnrollmentStatus: familyEnrollments.status,
      motherName: motherP.firstName,
      fatherName: fatherP.firstName,
    })
    .from(rosterFamilyTracker)
    .innerJoin(rosterFamilies, eq(rosterFamilies.id, rosterFamilyTracker.familyId))
    .leftJoin(motherP, eq(motherP.id, rosterFamilies.motherId))
    .leftJoin(fatherP, eq(fatherP.id, rosterFamilies.fatherId))
    .leftJoin(familyEnrollments, and(
      eq(familyEnrollments.familyId, rosterFamilyTracker.familyId),
      eq(familyEnrollments.tenantId, rosterFamilyTracker.tenantId),
      eq(familyEnrollments.year, rosterFamilyTracker.year),
    ))
    .where(and(
      eq(rosterFamilyTracker.tenantId, tenantId),
      familyId ? eq(rosterFamilyTracker.familyId, familyId) : undefined,
      eq(rosterFamilyTracker.year, year),
    ))
    .orderBy(rosterFamilies.legacyFamilyId)
}

/** Every family id of the tenant. */
export function tenantFamilyIds(tenantId: string) {
  return db
    .select({ id: rosterFamilies.id })
    .from(rosterFamilies)
    .where(eq(rosterFamilies.tenantId, tenantId))
}
