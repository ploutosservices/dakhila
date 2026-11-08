// WHAT IS PENDING FOR THE PRINCIPAL — the counts, as data. A principal can ask "what is my
// pending work"; every reader of it, a screen or the chatbot seam, reads this one answer.
//
// EVERY ITEM IS A SENTENCE SOMEONE CAN ACT ON. `label` says what is outstanding, `count` how
// many, `href` where it is done. An item with count 0 is still returned, with `done: true` —
// "no classes are missing a teacher" is an answer to "what is pending", and dropping the row
// would make a healthy school and an unmeasured one look identical.
//
// NOT A PERMISSION CHECK. This computes; the caller decides who may see it — roster.write,
// never a second rule invented here.

import { db } from './db'
import {
  rosterFamilyTracker, rosterAvailableClasses, rosterEnrollments, rosterCourseCatalog,
  rosterEvaluations, rosterTeachers, persons,
} from '../tables'
import { eq, and, isNull, isNotNull } from 'drizzle-orm'
import { schoolYearLabel } from './enrollment'
import { currentAcademicYear, enrollmentYear } from './years'
import { yearRules } from './year-context'
import { ports } from '../ports'
import { courseRules, tenantRules } from './rules-context'
import { teacherClassroomAddress } from './teacher-classroom-address'
import { workspaceDomain } from './role-mailbox'
import { hostPage } from './host'

export type PendingItem = {
  id: string
  label: string
  count: number
  done: boolean
  href: string
}

export type PrincipalWork = {
  enrollmentYear: number
  academicYear: number
  schoolYear: string
  // The school's shape, so a reader can tell "0 pending" from "nothing set up yet".
  totals: { families: number; classes: number; evaluations: number }
  pending: PendingItem[]
  allClear: boolean
}

const item = (id: string, label: string, count: number, href: string): PendingItem =>
  ({ id, label, count, done: count === 0, href })

export async function getPrincipalWork(tenantId: string): Promise<PrincipalWork> {
  const domain = await workspaceDomain(tenantId)
  const y = await yearRules(tenantId)
  const standby = (await courseRules(tenantId)).standbyDepartment2
  const at = ports().clock.now()
  const eYear = enrollmentYear(y, at)
  const aYear = currentAcademicYear(y, at)

  const [
    trackerRows, classesThisYear, standbyEnrollments, langUpdatesPending,
    classTeacherRows, evalRows, teacherPersons,
  ] = await Promise.all([
    db.select({ status: rosterFamilyTracker.enrollmentStatus })
      .from(rosterFamilyTracker)
      .where(and(eq(rosterFamilyTracker.tenantId, tenantId), eq(rosterFamilyTracker.year, eYear))),

    db.select({ id: rosterAvailableClasses.id, classroomCourseId: rosterAvailableClasses.classroomCourseId })
      .from(rosterAvailableClasses)
      .where(and(eq(rosterAvailableClasses.tenantId, tenantId), eq(rosterAvailableClasses.year, aYear))),

    db.select({ id: rosterEnrollments.id })
      .from(rosterEnrollments)
      .innerJoin(rosterAvailableClasses, eq(rosterAvailableClasses.id, rosterEnrollments.classId))
      .innerJoin(rosterCourseCatalog, eq(rosterCourseCatalog.id, rosterAvailableClasses.courseId))
      .where(and(
        eq(rosterEnrollments.tenantId, tenantId),
        eq(rosterAvailableClasses.year, eYear),
        eq(rosterCourseCatalog.department2, standby),
      )),

    db.select({ id: rosterEvaluations.id })
      .from(rosterEvaluations)
      .where(and(
        eq(rosterEvaluations.tenantId, tenantId),
        isNotNull(rosterEvaluations.submittedAt),
        isNotNull(rosterEvaluations.recommendedCourseId),
        isNull(rosterEvaluations.languageApprovedAt),
      )),

    db.selectDistinct({ classId: rosterTeachers.classId })
      .from(rosterTeachers)
      .innerJoin(rosterAvailableClasses, eq(rosterAvailableClasses.id, rosterTeachers.classId))
      .where(and(eq(rosterTeachers.tenantId, tenantId), eq(rosterAvailableClasses.year, aYear))),

    db.select({ submittedAt: rosterEvaluations.submittedAt })
      .from(rosterEvaluations)
      .innerJoin(rosterAvailableClasses, eq(rosterAvailableClasses.id, rosterEvaluations.classId))
      .where(and(eq(rosterEvaluations.tenantId, tenantId), eq(rosterAvailableClasses.year, aYear))),

    // Teachers of this year's classes who hold no school address. Google refuses
    // out-of-domain invites, so such a teacher cannot be added to their
    // Classroom at all — it is the one item here that stops a class from happening.
    db.selectDistinct({ id: persons.id, email: persons.email, classroomEmail: persons.classroomEmail })
      .from(persons)
      .innerJoin(rosterTeachers, eq(rosterTeachers.personId, persons.id))
      .innerJoin(rosterAvailableClasses, eq(rosterAvailableClasses.id, rosterTeachers.classId))
      .where(and(
        eq(persons.tenantId, tenantId),
        eq(rosterAvailableClasses.year, aYear),
        isNull(persons.deletedAt),
      )),
  ])

  // The school's pending group is the "not settled yet" states the board already sums.
  const pendingCodes = (await tenantRules(tenantId)).codes.enrollmentStatus.pending
  const byStatus: Record<string, number> = {}
  for (const r of trackerRows) {
    const s = r.status == null ? 'unknown' : String(r.status)
    byStatus[s] = (byStatus[s] ?? 0) + 1
  }

  const classIdsWithTeacher = new Set(classTeacherRows.map(r => r.classId))

  const pending: PendingItem[] = [
    item('families-not-enrolled', 'families whose enrollment is still pending',
      pendingCodes.reduce((n, code) => n + (byStatus[String(code)] ?? 0), 0), hostPage('enrollment')),
    item('classes-without-classroom', 'classes not yet linked to a Google Classroom',
      classesThisYear.filter(c => !c.classroomCourseId).length, hostPage('google-courses')),
    item('classes-without-teacher', 'classes with no teacher assigned',
      classesThisYear.filter(c => !classIdsWithTeacher.has(c.id)).length, hostPage('teachers')),
    item('teachers-without-classroom-address', `teachers with no ${domain} address, who cannot be added to their Classroom`,
      teacherPersons.filter(t => !teacherClassroomAddress(t, domain)).length, hostPage('teachers')),
    item('students-in-standby', 'students still in the standby class, waiting to be placed',
      standbyEnrollments.length, hostPage('classes')),
    item('language-recommendations-unapproved', 'language recommendations waiting for your approval',
      langUpdatesPending.length, hostPage('evaluations')),
    item('evaluations-not-submitted', 'evaluations teachers have not submitted yet',
      evalRows.filter(r => !r.submittedAt).length, hostPage('evaluations')),
  ]

  return {
    enrollmentYear: eYear,
    academicYear: aYear,
    schoolYear: schoolYearLabel(aYear),
    totals: {
      families: trackerRows.length,
      classes: classesThisYear.length,
      evaluations: evalRows.length,
    },
    pending,
    allClear: pending.every(p => p.done),
  }
}

/**
 * The principal's counts — tracker states for the enrollment year, the academic year's classes and
 * who teaches them, standby seats, recommendations awaiting approval, and the year's evaluations. Its other numbers
 * are getPrincipalWork's.
 */
export async function principalHelpCounts(tenantId: string, eYear: number, aYear: number) {
  const standby = (await courseRules(tenantId)).standbyDepartment2
  const [
    trackerRows,
    classesThisYear,
    standbyEnrollments,
    langUpdatesPending,
    classTeacherRows,
    evalRows,
  ] = await Promise.all([
    // Tracker status counts for enrollment year
    db.select({ status: rosterFamilyTracker.enrollmentStatus })
      .from(rosterFamilyTracker)
      .where(and(eq(rosterFamilyTracker.tenantId, tenantId), eq(rosterFamilyTracker.year, eYear))),

    // All classes for academic year (to find unlinked and teacherless)
    db.select({
      id: rosterAvailableClasses.id,
      classroomCourseId: rosterAvailableClasses.classroomCourseId,
    })
      .from(rosterAvailableClasses)
      .where(and(eq(rosterAvailableClasses.tenantId, tenantId), eq(rosterAvailableClasses.year, aYear))),

    // Students in standby (the school's standby marker) for enrollment year
    db.select({ id: rosterEnrollments.id })
      .from(rosterEnrollments)
      .innerJoin(rosterAvailableClasses, eq(rosterAvailableClasses.id, rosterEnrollments.classId))
      .innerJoin(rosterCourseCatalog, eq(rosterCourseCatalog.id, rosterAvailableClasses.courseId))
      .where(and(
        eq(rosterEnrollments.tenantId, tenantId),
        eq(rosterAvailableClasses.year, eYear),
        eq(rosterCourseCatalog.department2, standby),
      )),

    // Eval recommendations awaiting principal approval
    db.select({ id: rosterEvaluations.id })
      .from(rosterEvaluations)
      .where(and(
        eq(rosterEvaluations.tenantId, tenantId),
        isNotNull(rosterEvaluations.submittedAt),
        isNotNull(rosterEvaluations.recommendedCourseId),
        isNull(rosterEvaluations.languageApprovedAt),
      )),

    // Classes with at least one teacher
    db.selectDistinct({ classId: rosterTeachers.classId })
      .from(rosterTeachers)
      .innerJoin(rosterAvailableClasses, eq(rosterAvailableClasses.id, rosterTeachers.classId))
      .where(and(eq(rosterTeachers.tenantId, tenantId), eq(rosterAvailableClasses.year, aYear))),

    // Evaluation counts for current academic year
    db.select({ submittedAt: rosterEvaluations.submittedAt })
      .from(rosterEvaluations)
      .innerJoin(rosterAvailableClasses, eq(rosterAvailableClasses.id, rosterEvaluations.classId))
      .where(and(
        eq(rosterEvaluations.tenantId, tenantId),
        eq(rosterAvailableClasses.year, aYear),
      )),
  ])
  return { trackerRows, classesThisYear, standbyEnrollments, langUpdatesPending, classTeacherRows, evalRows }
}
