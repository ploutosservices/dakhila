// Enrollment ↔ class-placement sync check.
//
// The rule: when a family enrolls and pays, every kid on the enrollment is
// assigned two classes — culture + language. Auto-assign fires on payment completion
// (maybeMarkEnrollmentPaid → autoAssignClasses); a path that bypasses it leaves an
// enrolled family with unplaced kids. This check recomputes the rule against the live
// tables on demand and surfaces every enrolled-year-Y family whose kids do not hold live
// placements for year Y.

import { db } from './db'
import {
  familyEnrollments,
  familyEnrollmentStudents,
  rosterEnrollments,
  rosterAvailableClasses,
  rosterCourseCatalog,
  rosterFamilies,
  persons,
} from '../tables'
import { eq, and, isNull, inArray } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { SchoolRules } from '../ports'
import { courseRules } from './rules-context'

export interface PlacementClassification {
  hasCulture: boolean
  hasLanguage: boolean
}

// Pure: classify a kid's live placement departments against the two-class rule.
// A kid with ZERO placements must classify as missing both; an
// aggregate that goes NULL-ish on an empty set silently hides exactly that kid.
export function classifyPlacements(courses: Pick<SchoolRules['courses'], 'cultureDepartment' | 'languages'>, departments: string[]): PlacementClassification {
  return {
    hasCulture: departments.includes(courses.cultureDepartment),
    hasLanguage: departments.some(d => courses.languages.includes(d)),
  }
}

export interface OutOfSyncKid extends PlacementClassification {
  studentId: string
  name: string
}

export interface OutOfSyncFamily {
  enrollmentId: string
  familyId: string
  familyName: string
  // Kids on the enrollment that fail the two-class rule. Empty array = the
  // enrollment has no live kids attached at all.
  kids: OutOfSyncKid[]
  noKids: boolean
}

export interface PlacementSyncResult {
  year: number
  enrolledCount: number
  outOfSync: OutOfSyncFamily[]
}

export async function enrollmentPlacementSync(tenantId: string, year: number): Promise<PlacementSyncResult> {
  const father = alias(persons, 'father')
  const mother = alias(persons, 'mother')

  const enrollments = await db
    .select({
      enrollmentId: familyEnrollments.id,
      familyId: familyEnrollments.familyId,
      fatherLast: father.lastName,
      motherLast: mother.lastName,
    })
    .from(familyEnrollments)
    .innerJoin(rosterFamilies, eq(rosterFamilies.id, familyEnrollments.familyId))
    .leftJoin(father, eq(father.id, rosterFamilies.fatherId))
    .leftJoin(mother, eq(mother.id, rosterFamilies.motherId))
    .where(and(
      eq(familyEnrollments.tenantId, tenantId),
      eq(familyEnrollments.year, year),
      eq(familyEnrollments.status, 'enrolled'),
    ))

  if (enrollments.length === 0) return { year, enrolledCount: 0, outOfSync: [] }

  const kidRows = await db
    .select({
      enrollmentId: familyEnrollmentStudents.enrollmentId,
      studentId: familyEnrollmentStudents.studentId,
      firstName: persons.firstName,
      lastName: persons.lastName,
    })
    .from(familyEnrollmentStudents)
    .innerJoin(persons, eq(persons.id, familyEnrollmentStudents.studentId))
    .where(and(
      eq(familyEnrollmentStudents.tenantId, tenantId),
      inArray(familyEnrollmentStudents.enrollmentId, enrollments.map(e => e.enrollmentId)),
      isNull(familyEnrollmentStudents.droppedOutAt),
    ))

  const studentIds = [...new Set(kidRows.map(k => k.studentId))]
  const placementRows = studentIds.length === 0 ? [] : await db
    .select({
      studentId: rosterEnrollments.studentId,
      department: rosterCourseCatalog.department,
    })
    .from(rosterEnrollments)
    .innerJoin(rosterAvailableClasses, eq(rosterAvailableClasses.id, rosterEnrollments.classId))
    .innerJoin(rosterCourseCatalog, eq(rosterCourseCatalog.id, rosterAvailableClasses.courseId))
    .where(and(
      eq(rosterEnrollments.tenantId, tenantId),
      eq(rosterAvailableClasses.year, year),
      inArray(rosterEnrollments.studentId, studentIds),
      isNull(rosterEnrollments.deletedAt),
      isNull(rosterEnrollments.droppedOutAt),
    ))

  const departmentsByStudent = new Map<string, string[]>()
  for (const p of placementRows) {
    const list = departmentsByStudent.get(p.studentId) ?? []
    list.push(p.department)
    departmentsByStudent.set(p.studentId, list)
  }

  const kidsByEnrollment = new Map<string, typeof kidRows>()
  for (const k of kidRows) {
    const list = kidsByEnrollment.get(k.enrollmentId) ?? []
    list.push(k)
    kidsByEnrollment.set(k.enrollmentId, list)
  }

  const courses = await courseRules(tenantId)
  const outOfSync: OutOfSyncFamily[] = []
  for (const e of enrollments) {
    const kids = kidsByEnrollment.get(e.enrollmentId) ?? []
    const failing: OutOfSyncKid[] = []
    for (const kid of kids) {
      const c = classifyPlacements(courses, departmentsByStudent.get(kid.studentId) ?? [])
      if (!c.hasCulture || !c.hasLanguage) {
        failing.push({
          studentId: kid.studentId,
          name: [kid.firstName, kid.lastName].filter(Boolean).join(' '),
          ...c,
        })
      }
    }
    if (kids.length === 0 || failing.length > 0) {
      outOfSync.push({
        enrollmentId: e.enrollmentId,
        familyId: e.familyId,
        familyName: e.fatherLast ?? e.motherLast ?? '(unnamed family)',
        kids: failing,
        noKids: kids.length === 0,
      })
    }
  }

  return { year, enrolledCount: enrollments.length, outOfSync }
}
