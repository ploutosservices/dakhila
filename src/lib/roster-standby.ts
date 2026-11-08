// STANDBY AND PLACEMENT: who waits in a standby class, where the
// evaluations say a student belongs but is not placed, and the moves between them.
import { and, eq, gt, inArray, isNotNull, isNull, ne } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { db } from './db'
import {
  persons, rosterAvailableClasses, rosterCourseCatalog, rosterEnrollments, rosterEvaluations, rosterFamilies, rosterTeachers,
} from '../tables'
import { courseRules } from './rules-context'

/** A student's live language enrollments (not the standby level) in the year, with each one's catalog course. */
export async function languageEnrollmentsOf(tenantId: string, studentId: string, year: number) {
  const courses = await courseRules(tenantId)
  return db
    .select({ enrollmentId: rosterEnrollments.id, courseId: rosterCourseCatalog.id })
    .from(rosterEnrollments)
    .innerJoin(rosterAvailableClasses, eq(rosterAvailableClasses.id, rosterEnrollments.classId))
    .innerJoin(rosterCourseCatalog, eq(rosterCourseCatalog.id, rosterAvailableClasses.courseId))
    .where(and(
      eq(rosterEnrollments.tenantId, tenantId),
      eq(rosterEnrollments.studentId, studentId),
      eq(rosterAvailableClasses.year, year),
      inArray(rosterCourseCatalog.department, courses.languages),
      ne(rosterCourseCatalog.level, courses.standbyLevel),
      isNull(rosterEnrollments.deletedAt),
      isNull(rosterEnrollments.droppedOutAt),
    ))
}

/** The year's class of a catalog course, by id; null when the year has none. */
export async function classOfCourseInYear(tenantId: string, courseId: string, year: number): Promise<string | null> {
  const [targetClass] = await db
    .select({ id: rosterAvailableClasses.id })
    .from(rosterAvailableClasses)
    .where(and(
      eq(rosterAvailableClasses.tenantId, tenantId),
      eq(rosterAvailableClasses.courseId, courseId),
      eq(rosterAvailableClasses.year, year),
    ))
    .limit(1)
  return targetClass?.id ?? null
}

/** A student's live standby enrollment in the year, by id; null when there is none. */
export async function standbyEnrollmentOf(tenantId: string, studentId: string, year: number): Promise<string | null> {
  const courses = await courseRules(tenantId)
  const [standbyEnrollment] = await db
    .select({ enrollmentId: rosterEnrollments.id })
    .from(rosterEnrollments)
    .innerJoin(rosterAvailableClasses, eq(rosterAvailableClasses.id, rosterEnrollments.classId))
    .innerJoin(rosterCourseCatalog, eq(rosterCourseCatalog.id, rosterAvailableClasses.courseId))
    .where(and(
      eq(rosterEnrollments.tenantId, tenantId),
      eq(rosterEnrollments.studentId, studentId),
      eq(rosterAvailableClasses.year, year),
      eq(rosterCourseCatalog.department2, courses.standbyDepartment2),
      isNull(rosterEnrollments.deletedAt),
      isNull(rosterEnrollments.droppedOutAt),
    ))
    .limit(1)
  return standbyEnrollment?.enrollmentId ?? null
}

/** The departments whose classes an address teaches in the year. */
export async function departmentsTaughtBy(tenantId: string, email: string, year: number): Promise<string[]> {
  const rows = await db
    .select({ department: rosterCourseCatalog.department })
    .from(rosterTeachers)
    .innerJoin(rosterAvailableClasses, eq(rosterAvailableClasses.id, rosterTeachers.classId))
    .innerJoin(rosterCourseCatalog, eq(rosterCourseCatalog.id, rosterAvailableClasses.courseId))
    .innerJoin(persons, eq(persons.id, rosterTeachers.personId))
    .where(and(
      eq(rosterAvailableClasses.tenantId, tenantId),
      eq(rosterAvailableClasses.year, year),
      eq(persons.email, email),
      isNull(persons.deletedAt),
    ))
  return [...new Set(rows.map(r => r.department).filter(Boolean) as string[])]
}

/** The year's language courses that have a class (not the standby level), by level — what a student can be placed in. */
export async function languageCoursesOfYear(tenantId: string, year: number) {
  const courses = await courseRules(tenantId)
  return db
    .select({
      courseId: rosterCourseCatalog.id,
      shortCode: rosterCourseCatalog.shortCode,
      department: rosterCourseCatalog.department,
      level: rosterCourseCatalog.level,
    })
    .from(rosterAvailableClasses)
    .innerJoin(rosterCourseCatalog, eq(rosterCourseCatalog.id, rosterAvailableClasses.courseId))
    .where(and(
      eq(rosterAvailableClasses.tenantId, tenantId),
      eq(rosterAvailableClasses.year, year),
      inArray(rosterCourseCatalog.department, courses.languages),
      ne(rosterCourseCatalog.level, courses.standbyLevel),
    ))
    .orderBy(rosterCourseCatalog.level)
}

/** The year's live standby students with their department and both parents' contacts; `departments` narrows. */
export async function standbyStudents(tenantId: string, year: number, departments: string[] | null) {
  const courses = await courseRules(tenantId)
  const mother = alias(persons, 'mother')
  const father = alias(persons, 'father')

  const standbyConditions = [
    eq(rosterEnrollments.tenantId, tenantId),
    eq(rosterAvailableClasses.year, year),
    eq(rosterCourseCatalog.department2, courses.standbyDepartment2),
    // assignFromStandby retires the standby enrollment by soft delete; without
    // these two filters the dead row keeps matching and the student never
    // leaves this list.
    isNull(rosterEnrollments.deletedAt),
    isNull(rosterEnrollments.droppedOutAt),
    isNull(persons.deletedAt),
    ...(departments ? [inArray(rosterCourseCatalog.department, departments)] : []),
  ]

  return db
    .select({
      studentId: persons.id,
      studentFirst: persons.firstName,
      studentLast: persons.lastName,
      birthDate: persons.birthDate,
      birthYear: persons.birthYear,
      firstGradeYear: persons.firstGradeYear,
      department: rosterCourseCatalog.department,
      motherId: mother.id,
      motherFirst: mother.firstName,
      motherLast: mother.lastName,
      motherEmail: mother.email,
      motherPhone: mother.phone,
      fatherId: father.id,
      fatherFirst: father.firstName,
      fatherLast: father.lastName,
      fatherEmail: father.email,
      fatherPhone: father.phone,
    })
    .from(rosterEnrollments)
    .innerJoin(rosterAvailableClasses, eq(rosterAvailableClasses.id, rosterEnrollments.classId))
    .innerJoin(rosterCourseCatalog, eq(rosterCourseCatalog.id, rosterAvailableClasses.courseId))
    .innerJoin(persons, eq(persons.id, rosterEnrollments.studentId))
    .leftJoin(rosterFamilies, eq(rosterFamilies.id, persons.familyId))
    .leftJoin(mother, eq(mother.id, rosterFamilies.motherId))
    .leftJoin(father, eq(father.id, rosterFamilies.fatherId))
    .where(and(...standbyConditions))
    .orderBy(rosterCourseCatalog.department, persons.lastName, persons.firstName)
}

/**
 * Students whose submitted evaluation (written in `evalYear`) recommends a HIGHER language course than the one they
 * are placed in for `placementYear`.
 */
export async function placementMismatches(tenantId: string, evalYear: number, placementYear: number) {
  const courses = await courseRules(tenantId)
  const rccNext = alias(rosterCourseCatalog, 'rcc_next')
  const racNext = alias(rosterAvailableClasses, 'rac_next')
  const reNext = alias(rosterEnrollments, 're_next')
  const rccRec = alias(rosterCourseCatalog, 'rcc_rec')
  const student = alias(persons, 'student')

  return db
    .select({
      studentId: rosterEvaluations.studentId,
      studentFirst: student.firstName,
      studentLast: student.lastName,
      currentClassName: rccNext.shortCode,
      recCourseId: rccRec.id,
      recClassName: rccRec.shortCode,
      recLevel: rccRec.level,
      department: rccRec.department,
    })
    .from(rosterEvaluations)
    .innerJoin(student, eq(student.id, rosterEvaluations.studentId))
    .innerJoin(rosterAvailableClasses, eq(rosterAvailableClasses.id, rosterEvaluations.classId))
    .innerJoin(reNext, eq(reNext.studentId, rosterEvaluations.studentId))
    .innerJoin(racNext, eq(racNext.id, reNext.classId))
    .innerJoin(rccNext, eq(rccNext.id, racNext.courseId))
    .innerJoin(rccRec, eq(rccRec.id, rosterEvaluations.recommendedCourseId))
    .where(and(
      eq(rosterEvaluations.tenantId, tenantId),
      eq(rosterAvailableClasses.year, evalYear),
      isNotNull(rosterEvaluations.submittedAt),
      isNotNull(rosterEvaluations.recommendedCourseId),
      eq(racNext.year, placementYear),
      eq(racNext.tenantId, tenantId),
      inArray(rccNext.department, courses.languages),
      ne(rccNext.level, courses.standbyLevel),
      gt(rccRec.level, rccNext.level),
      isNull(student.deletedAt),
      isNull(reNext.deletedAt),
      isNull(reNext.droppedOutAt),
    ))
    .orderBy(rccRec.department, student.lastName, student.firstName)
}
