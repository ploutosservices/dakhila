// Scope helpers for the school's roster: WHICH records belong to a
// person, resolved from data. Permission questions (may this person act) are
// the access rule's (access.ts may), one door.
//
// Role names are not decided here: the host grants its roles, and teacher and family are derived from the roster's
// data per the CURRENT session.

import { db } from './db'
import { persons, rosterTeachers, rosterAvailableClasses, rosterEnrollments, rosterRoles } from '../tables'
import { eq, and, isNull, inArray, sql } from 'drizzle-orm'
import { academicYearOf } from './year-context'
import { familyIdOfIn } from './access-rows'

// Family ID for the logged-in user (matched by email to a person record).
export async function getUserFamilyId(email: string, tenantId: string): Promise<string | null> {
  return familyIdOfIn(db, email, tenantId)
}

// Does this address teach a class in the current school year? A yes/no, matched the same
// way getUserFamilyId matches — by the address the person signed in with.
//
// It answers a question about WHICH HELP TEXT to hand a signed-in person, which is
// why it is a boolean and not a permission: the access rule decides what a teacher may DO, and
// nothing here is an act. A person who teaches AND has children is both, and both sets of
// help reach them.
export async function teachesThisYear(email: string, tenantId: string): Promise<boolean> {
  const [row] = await db
    .select({ classId: rosterTeachers.classId })
    .from(rosterTeachers)
    .innerJoin(persons, eq(persons.id, rosterTeachers.personId))
    .innerJoin(rosterAvailableClasses, eq(rosterAvailableClasses.id, rosterTeachers.classId))
    .where(and(
      eq(persons.tenantId, tenantId),
      sql`lower(${persons.email}) = lower(${email})`,
      eq(rosterAvailableClasses.year, await academicYearOf(tenantId)),
      isNull(persons.deletedAt),
    ))
    .limit(1)
  return Boolean(row)
}

// Student IDs enrolled in the teacher's classes for the current school year.
export async function getTeacherStudentIds(email: string, tenantId: string): Promise<string[]> {
  const schoolYear = await academicYearOf(tenantId)

  const classRows = await db
    .select({ classId: rosterTeachers.classId })
    .from(rosterTeachers)
    .innerJoin(persons, eq(persons.id, rosterTeachers.personId))
    .innerJoin(rosterAvailableClasses, eq(rosterAvailableClasses.id, rosterTeachers.classId))
    .where(and(
      eq(persons.tenantId, tenantId),
      sql`lower(${persons.email}) = lower(${email})`,
      eq(rosterAvailableClasses.year, schoolYear),
      isNull(persons.deletedAt),
    ))

  if (classRows.length === 0) return []

  const classIds = classRows.map(r => r.classId)
  const enrollments = await db
    .select({ studentId: rosterEnrollments.studentId })
    .from(rosterEnrollments)
    .where(and(
      inArray(rosterEnrollments.classId, classIds),
      isNull(rosterEnrollments.droppedOutAt),
      isNull(rosterEnrollments.deletedAt),
    ))

  return [...new Set(enrollments.map(e => e.studentId))]
}

/** The family of the person whose address is exactly `email` (callers lower-case it); null when none or no family. */
export async function familyOfAddress(tenantId: string, email: string): Promise<string | null> {
  const [person] = await db
    .select({ id: persons.id, familyId: persons.familyId })
    .from(persons)
    .where(and(
      eq(persons.tenantId, tenantId),
      eq(persons.email, email),
      isNull(persons.deletedAt),
    ))
    .limit(1)
  return person?.familyId ?? null
}

/** The tenant's role mailboxes, whole. */
export function tenantRoles(tenantId: string) {
  return db.select().from(rosterRoles).where(eq(rosterRoles.tenantId, tenantId))
}

/** The live person whose address is exactly `email`, with their family; null when none. */
export async function personOfAddress(tenantId: string, email: string): Promise<{ id: string; familyId: string | null } | null> {
  const [person] = await db
    .select({ id: persons.id, familyId: persons.familyId })
    .from(persons)
    .where(and(eq(persons.email, email), eq(persons.tenantId, tenantId), isNull(persons.deletedAt)))
    .limit(1)
  return person ?? null
}
