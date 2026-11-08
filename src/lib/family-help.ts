// A FAMILY'S HELP READS: the family, who may enroll, the children's classes this year, the next school days and the
// family's enrollment history.
import { and, asc, eq, gte } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { db } from './db'
import {
  persons, rosterAvailableClasses, rosterCourseCatalog, rosterEnrollments, rosterEvents, rosterFamilies,
  familyEnrollments,
} from '../tables'
import { gradeLevel } from './enrollment'
import { enrollableGrade } from './eligible-kids'
import { calendarRules, courseRules } from './rules-context'
import { courseOf } from './classroom-mirror'

/** The family with its parents' ids and first names (at most one row). */
export function familyWithParentNames(familyId: string) {
  const motherP = alias(persons, 'mother')
  const fatherP = alias(persons, 'father')
  return db.select({
    id:        rosterFamilies.id,
    motherId:  rosterFamilies.motherId,
    fatherId:  rosterFamilies.fatherId,
    motherFirst: motherP.firstName,
    fatherFirst: fatherP.firstName,
  })
    .from(rosterFamilies)
    .leftJoin(motherP, eq(motherP.id, rosterFamilies.motherId))
    .leftJoin(fatherP, eq(fatherP.id, rosterFamilies.fatherId))
    .where(eq(rosterFamilies.id, familyId))
    .limit(1)
}

/** The family's members in a grade the school enrols (its first enrolled grade through its last) for the
 *  enrollment year. */
export async function familyEligibleForYear(tenantId: string, familyId: string, eYear: number) {
  const { grades } = await courseRules(tenantId)
  const rows = await db.select({ id: persons.id, firstGradeYear: persons.firstGradeYear })
    .from(persons)
    .where(and(
      eq(persons.familyId, familyId),
      eq(persons.tenantId, tenantId),
    ))
  return rows.filter(p => !!p.firstGradeYear && enrollableGrade(gradeLevel(eYear, p.firstGradeYear), grades))
}

/** Each of the family's children's classes in the academic year, with the classroom's Meet. */
export async function familyClassesOfYear(tenantId: string, familyId: string, aYear: number) {
  const rows = await db.select({
    studentId:   persons.id,
    firstName:   persons.firstName,
    lastName:    persons.lastName,
    classId:     rosterAvailableClasses.id,
    shortCode:   rosterCourseCatalog.shortCode,
    section:     rosterAvailableClasses.section,
    fullName:    rosterCourseCatalog.fullName,
    department:  rosterCourseCatalog.department,
    classroomCourseId: rosterAvailableClasses.classroomCourseId,
    startTime:   rosterAvailableClasses.startTime,
    endTime:     rosterAvailableClasses.endTime,
  })
    .from(persons)
    .innerJoin(rosterEnrollments, eq(rosterEnrollments.studentId, persons.id))
    .innerJoin(rosterAvailableClasses, eq(rosterAvailableClasses.id, rosterEnrollments.classId))
    .innerJoin(rosterCourseCatalog, eq(rosterCourseCatalog.id, rosterAvailableClasses.courseId))
    .where(and(
      eq(persons.familyId, familyId),
      eq(rosterEnrollments.tenantId, tenantId),
      eq(rosterAvailableClasses.year, aYear),
    ))
    .orderBy(persons.firstName, rosterCourseCatalog.department)
  const course = await courseOf(rows)
  return rows.map(r => ({
    studentId: r.studentId, firstName: r.firstName, lastName: r.lastName, classId: r.classId, shortCode: r.shortCode,
    section: r.section, fullName: r.fullName, department: r.department,
    meet: course(r)?.meet ?? null,   // the Google Classroom's — the one Meet store
    classroomCourseId: r.classroomCourseId, startTime: r.startTime, endTime: r.endTime,
  }))
}

/** The next school days from `from` (YYYY-MM-DD), as many as the school's rules give a family's dashboard read
 *  (SchoolRules.calendar.dashboardSchoolDays). */
export async function nextSchoolDays(tenantId: string, from: string) {
  const { eventTypes: { schoolDay }, dashboardSchoolDays } = await calendarRules(tenantId)
  return db.select({ date: rosterEvents.date, description: rosterEvents.description, eventType: rosterEvents.eventType })
    .from(rosterEvents)
    .where(and(
      eq(rosterEvents.tenantId, tenantId),
      gte(rosterEvents.date, from),
      eq(rosterEvents.eventType, schoolDay),
    ))
    .orderBy(asc(rosterEvents.date))
    .limit(dashboardSchoolDays)
}

/** The family's enrollment for every year, oldest first. */
export function familyEnrollmentHistory(tenantId: string, familyId: string) {
  return db.select({ year: familyEnrollments.year, status: familyEnrollments.status })
    .from(familyEnrollments)
    .where(and(
      eq(familyEnrollments.tenantId, tenantId),
      eq(familyEnrollments.familyId, familyId),
    ))
    .orderBy(familyEnrollments.year)
}
