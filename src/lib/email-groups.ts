// Resolve named recipient groups to email lists. The groups' names and types, store-free, are email-groups-types.ts.
//
// EVERY QUERY HERE FILTERS deletedAt, and that is a rule rather than a habit: a
// deleted family takes its people with it, and this file is a MAIL path — the one place where a
// row nobody can see any more still reaches a human. A group that resolves a deleted person's
// address sends real mail to someone the roster says is gone.

import { db } from './db'
import {
  persons, rosterFamilies, rosterEnrollments, rosterAvailableClasses, rosterCourseCatalog,
  rosterTeachers, rosterTrustees,
} from '../tables'
import { eq, and, isNotNull, isNull, inArray } from 'drizzle-orm'
import { academicYearOf } from './year-context'
export type { RecipientGroup } from './email-groups-types'
import { groupLanguage, isGoverningBody, type RecipientGroup } from './email-groups-types'
import { tenantRules } from './rules-context'

export async function resolveGroups(
  tenantId: string,
  groups: RecipientGroup[],
): Promise<{ group: RecipientGroup; emails: string[]; count: number }[]> {
  const results: { group: RecipientGroup; emails: string[]; count: number }[] = []

  for (const group of groups) {
    const emails = await resolveGroup(tenantId, group)
    results.push({ group, emails, count: emails.length })
  }
  return results
}

async function resolveGroup(tenantId: string, group: RecipientGroup): Promise<string[]> {
  const [year, r] = await Promise.all([academicYearOf(tenantId), tenantRules(tenantId)])
  const rules = { languages: r.courses.languages, governingBody: r.codes.governingBody }
  // A language group narrows its classes to that catalog department; a whole group takes every class.
  const language = groupLanguage(rules, group)
  if (language === undefined) throw new Error(`not a recipient group of this school: ${group}`)
  const inLanguage = language ? [eq(rosterCourseCatalog.department, language)] : []

  // The governing body: the roster's governing-body rows (roster_trustees).
  if (isGoverningBody(rules, group)) {
    const rows = await db
      .select({ email: rosterTrustees.email })
      .from(rosterTrustees)
      .where(eq(rosterTrustees.tenantId, tenantId))
    return rows.map(r => r.email)
  }

  if (group === 'teachers' || group.startsWith('teachers-')) {
    const classes = await db
      .select({ id: rosterAvailableClasses.id })
      .from(rosterAvailableClasses)
      .leftJoin(rosterCourseCatalog, eq(rosterCourseCatalog.id, rosterAvailableClasses.courseId))
      .where(and(
        eq(rosterAvailableClasses.tenantId, tenantId),
        eq(rosterAvailableClasses.year, year),
        ...inLanguage,
      ))
    if (classes.length === 0) return []
    const classIds = classes.map(c => c.id)
    const teachers = await db
      .select({ email: persons.email })
      .from(rosterTeachers)
      .leftJoin(persons, eq(persons.id, rosterTeachers.personId))
      .where(and(
        eq(rosterTeachers.tenantId, tenantId),
        inArray(rosterTeachers.classId, classIds),
        isNotNull(persons.email),
        isNull(persons.deletedAt),
      ))
    return [...new Set(teachers.map(t => t.email!).filter(Boolean))]
  }

  // enrolled-students or enrolled-parents: need enrolled student IDs
  // No other reader answers "every enrolled student of a year" (getEnrolledStudentIds takes one enrollment,
  // getStudentEnrollments one student), so the group joins enrollments to the year's classes here.
  const enrollments = await db
    .select({ studentId: rosterEnrollments.studentId })
    .from(rosterEnrollments)
    .leftJoin(rosterAvailableClasses, eq(rosterAvailableClasses.id, rosterEnrollments.classId))
    .leftJoin(rosterCourseCatalog, eq(rosterCourseCatalog.id, rosterAvailableClasses.courseId))
    .where(and(
      eq(rosterEnrollments.tenantId, tenantId),
      eq(rosterAvailableClasses.year, year),
      isNull(rosterEnrollments.droppedOutAt),
      isNull(rosterEnrollments.deletedAt),
      ...inLanguage,
    ))
  const studentIds = [...new Set(enrollments.map(e => e.studentId))]
  if (studentIds.length === 0) return []

  if (group === 'enrolled-students') {
    const rows = await db
      .select({ email: persons.email })
      .from(persons)
      .where(and(inArray(persons.id, studentIds), isNotNull(persons.email), isNull(persons.deletedAt)))
    return rows.map(r => r.email!).filter(Boolean)
  }

  // enrolled-parents: get family IDs → parents → emails
  const students = await db
    .select({ familyId: persons.familyId })
    .from(persons)
    .where(and(inArray(persons.id, studentIds), isNull(persons.deletedAt)))
  const familyIds = [...new Set(students.map(s => s.familyId).filter(Boolean))] as string[]
  if (familyIds.length === 0) return []

  const families = await db
    .select({ motherId: rosterFamilies.motherId, fatherId: rosterFamilies.fatherId })
    .from(rosterFamilies)
    .where(inArray(rosterFamilies.id, familyIds))
  const parentIds = [...new Set(
    families.flatMap(f => [f.motherId, f.fatherId]).filter(Boolean) as string[]
  )]
  if (parentIds.length === 0) return []

  const parents = await db
    .select({ email: persons.email })
    .from(persons)
    .where(and(inArray(persons.id, parentIds), isNotNull(persons.email), isNull(persons.deletedAt)))
  return [...new Set(parents.map(p => p.email!).filter(Boolean))]
}

// Returns all unique emails across selected groups
export async function resolveAllEmails(tenantId: string, groups: RecipientGroup[]): Promise<string[]> {
  const resolved = await resolveGroups(tenantId, groups)
  return [...new Set(resolved.flatMap(r => r.emails))]
}
