// Auto-assign culture and language classes when a student's enrollment is confirmed.
// Called from maybeMarkEnrollmentPaid after status transitions to 'enrolled'.

import { db } from './db'
import type { SchoolRules } from '../ports'
import { courseRules } from './rules-context'
import {
  familyEnrollmentStudents,
  rosterCourseCatalog,
  rosterAvailableClasses,
  rosterEnrollments,
  rosterEvaluations,
  persons,
} from '../tables'
import { eq, and, isNull, isNotNull, sql } from 'drizzle-orm'
import { gradeLevel } from './enrollment'
import { enrollmentWindowOpenOf } from './year-context'
import { createClass } from './roster-class-writes'

// Find an available class for a given course+year, creating it if needed.
// Creation goes through createClass — the one door — which derives the class
// times from the course's department and throws if no time rule exists.
async function findOrCreateAvailableClass(tenantId: string, courseId: string, year: number): Promise<string> {
  const [existing] = await db
    .select({ id: rosterAvailableClasses.id })
    .from(rosterAvailableClasses)
    .where(and(
      eq(rosterAvailableClasses.tenantId, tenantId),
      eq(rosterAvailableClasses.courseId, courseId),
      eq(rosterAvailableClasses.year, year),
    ))
    .limit(1)

  if (existing) return existing.id

  return createClass(tenantId, { courseId, year })
}

// Insert a roster_enrollments row unless the student is already in that class.
async function maybeEnrollInClass(tenantId: string, studentId: string, classId: string): Promise<void> {
  const [existing] = await db
    .select({ id: rosterEnrollments.id })
    .from(rosterEnrollments)
    .where(and(
      eq(rosterEnrollments.tenantId, tenantId),
      eq(rosterEnrollments.studentId, studentId),
      eq(rosterEnrollments.classId, classId),
    ))
    .limit(1)

  if (!existing) {
    await db.insert(rosterEnrollments).values({ tenantId, studentId, classId })
  }
}

// Returns the highest-level course for a given department as the level ceiling fallback.
async function highestLevelCourse(courses: SchoolRules['courses'], tenantId: string, department: string): Promise<string | null> {
  const rows = await db
    .select({ id: rosterCourseCatalog.id, level: rosterCourseCatalog.level })
    .from(rosterCourseCatalog)
    .where(and(
      eq(rosterCourseCatalog.tenantId, tenantId),
      eq(rosterCourseCatalog.department, department),
      sql`coalesce(${rosterCourseCatalog.department2}, 0) <> ${courses.standbyDepartment2}`,
      sql`${rosterCourseCatalog.shortCode} NOT LIKE ${courses.kindergartenCodePrefix + '%'}`,
    ))
    .orderBy(sql`${rosterCourseCatalog.level} DESC`)
    .limit(1)

  return rows[0]?.id ?? null
}

/** A grade's culture class code: the school's prefix and the grade, one class per grade; a school names its last class
 *  (`lastCultureGrade`) and a higher grade is placed there; kindergarten takes the school's own code. */
export function cultureCodeFor(courses: SchoolRules['courses'], grade: number): string {
  return grade === 0 ? courses.kindergartenCultureCode : `${courses.cultureCodePrefix}${Math.min(grade, courses.lastCultureGrade)}`
}

export type AutoAssignResult = { errors: string[] }

export async function autoAssignClasses(
  tenantId: string,
  enrollmentId: string,
  year: number,
): Promise<AutoAssignResult> {
  if (!(await enrollmentWindowOpenOf(tenantId))) return { errors: [] }

  // The school's course rules: its culture department and classes, its language catalog's novice track and standby
  // marker (SchoolRules.courses).
  const courses = await courseRules(tenantId)
  const errors: string[] = []

  const enrolledStudents = await db
    .select({ studentId: familyEnrollmentStudents.studentId })
    .from(familyEnrollmentStudents)
    .where(eq(familyEnrollmentStudents.enrollmentId, enrollmentId))

  for (const { studentId } of enrolledStudents) {
    const [student] = await db
      .select({
        firstGradeYear: persons.firstGradeYear,
        preferredLanguage: persons.preferredLanguage,
      })
      .from(persons)
      .where(eq(persons.id, studentId))
      .limit(1)

    if (!student?.firstGradeYear) {
      errors.push(`Student ${studentId}: missing firstGradeYear — skipping.`)
      continue
    }
    if (!student.preferredLanguage) {
      errors.push(`Student ${studentId}: missing preferredLanguage — skipping.`)
      continue
    }

    const grade = gradeLevel(year, student.firstGradeYear)

    // ── Culture class ────────────────────────────────────────────────────────
    // A grade past the school's last culture class is placed in it.
    const cultureShortCode = cultureCodeFor(courses, grade)

    const [cultureCourse] = await db
      .select({ id: rosterCourseCatalog.id })
      .from(rosterCourseCatalog)
      .where(and(
        eq(rosterCourseCatalog.tenantId, tenantId),
        eq(rosterCourseCatalog.department, courses.cultureDepartment),
        eq(rosterCourseCatalog.shortCode, cultureShortCode),
      ))
      .limit(1)

    if (!cultureCourse) {
      errors.push(`Student ${studentId}: culture course ${cultureShortCode} not found in catalog — skipping culture.`)
    } else {
      try {
        const cultureClassId = await findOrCreateAvailableClass(tenantId, cultureCourse.id, year)
        await maybeEnrollInClass(tenantId, studentId, cultureClassId)
      } catch (e) {
        errors.push(`Student ${studentId}: culture — ${e instanceof Error ? e.message : String(e)}`)
      }
    }

    // ── Language class ───────────────────────────────────────────────────────
    const lang = student.preferredLanguage

    // Idempotent: skip if already assigned a language class this year
    const existingLang = await db
      .select({ id: rosterEnrollments.id })
      .from(rosterEnrollments)
      .innerJoin(rosterAvailableClasses, eq(rosterAvailableClasses.id, rosterEnrollments.classId))
      .innerJoin(rosterCourseCatalog, eq(rosterCourseCatalog.id, rosterAvailableClasses.courseId))
      .where(and(
        eq(rosterEnrollments.tenantId, tenantId),
        eq(rosterEnrollments.studentId, studentId),
        eq(rosterAvailableClasses.year, year),
        eq(rosterCourseCatalog.department, lang),
        isNull(rosterEnrollments.droppedOutAt),
        isNull(rosterEnrollments.deletedAt),
      ))

    if (existingLang.length > 0) continue

    // Prior-year language enrollment
    const priorLang = await db
      .select({
        classId: rosterEnrollments.classId,
        courseId: rosterAvailableClasses.courseId,
        department2: rosterCourseCatalog.department2,
      })
      .from(rosterEnrollments)
      .innerJoin(rosterAvailableClasses, eq(rosterAvailableClasses.id, rosterEnrollments.classId))
      .innerJoin(rosterCourseCatalog, eq(rosterCourseCatalog.id, rosterAvailableClasses.courseId))
      .where(and(
        eq(rosterEnrollments.tenantId, tenantId),
        eq(rosterEnrollments.studentId, studentId),
        eq(rosterAvailableClasses.year, year - 1),
        eq(rosterCourseCatalog.department, lang),
        isNull(rosterEnrollments.droppedOutAt),
        isNull(rosterEnrollments.deletedAt),
      ))

    // INVARIANT: multiple prior-year language classes = data corruption
    if (priorLang.length > 1) {
      errors.push(`Student ${studentId}: ${priorLang.length} prior-year ${lang} enrollments — data corruption, halting language assignment.`)
      continue
    }

    // INVARIANT: prior-year standby = disaster
    if (priorLang.length === 1 && priorLang[0].department2 === courses.standbyDepartment2) {
      errors.push(`Student ${studentId}: found in standby from prior year — data integrity error, halting language assignment.`)
      continue
    }

    let targetCourseId: string | null = null

    // A NEW STUDENT (no language class last year): a child at or below the school's novice grade starts in the
    // language's novice starting level (courses.noviceStartLevel) on the school's novice track, and everyone else waits in the language's standby class
    // to be evaluated.
    //
    // The course is named EXACTLY: the starting level on the novice track (department2). A rule asking only for "the
    // starting level of their language" matches several courses, so the answer would be whatever row the database
    // returned first, and a child could be placed in the wrong one, with a teacherless class created for them.
    if (priorLang.length === 0 && grade <= courses.noviceUpToGrade) {
      const novice = await db
        .select({ id: rosterCourseCatalog.id })
        .from(rosterCourseCatalog)
        .where(and(
          eq(rosterCourseCatalog.tenantId, tenantId),
          eq(rosterCourseCatalog.department, lang),
          eq(rosterCourseCatalog.level, courses.noviceStartLevel),
          eq(rosterCourseCatalog.department2, courses.noviceTrack),
        ))
      if (novice.length !== 1) {
        errors.push(`Student ${studentId}: expected exactly one ${lang} level-${courses.noviceStartLevel} course on track ${courses.noviceTrack}, found ${novice.length} — skipping language.`)
        continue
      }
      targetCourseId = novice[0].id
    } else if (priorLang.length === 1 && priorLang[0].courseId) {
      // A RETURNING STUDENT: the evaluation's recommendation, else the same course as the prior year
      const [submittedEval] = await db
        .select({ recommendedCourseId: rosterEvaluations.recommendedCourseId })
        .from(rosterEvaluations)
        .where(and(
          eq(rosterEvaluations.tenantId, tenantId),
          eq(rosterEvaluations.studentId, studentId),
          eq(rosterEvaluations.classId, priorLang[0].classId),
          eq(rosterEvaluations.year, year - 1),
          isNotNull(rosterEvaluations.submittedAt),
          isNotNull(rosterEvaluations.recommendedCourseId),
        ))
        .limit(1)

      targetCourseId = submittedEval?.recommendedCourseId ?? priorLang[0].courseId

      // Level ceiling: if the resolved catalog course somehow doesn't exist, fall back to highest level
      const [courseExists] = await db
        .select({ id: rosterCourseCatalog.id })
        .from(rosterCourseCatalog)
        .where(eq(rosterCourseCatalog.id, targetCourseId))
        .limit(1)

      if (!courseExists) {
        targetCourseId = await highestLevelCourse(courses, tenantId, lang)
      }
    }
    // Otherwise targetCourseId stays null and the student goes to standby.

    if (targetCourseId === null) {
      // STANDBY: the standby course for this language
      const [standbyCourse] = await db
        .select({ id: rosterCourseCatalog.id })
        .from(rosterCourseCatalog)
        .where(and(
          eq(rosterCourseCatalog.tenantId, tenantId),
          eq(rosterCourseCatalog.department, lang),
          eq(rosterCourseCatalog.department2, courses.standbyDepartment2),
        ))
        .limit(1)

      if (!standbyCourse) {
        errors.push(`Student ${studentId}: standby course for ${lang} not found in catalog.`)
        continue
      }
      targetCourseId = standbyCourse.id
    }

    try {
      const languageClassId = await findOrCreateAvailableClass(tenantId, targetCourseId, year)
      await maybeEnrollInClass(tenantId, studentId, languageClassId)
    } catch (e) {
      errors.push(`Student ${studentId}: language — ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return { errors }
}
