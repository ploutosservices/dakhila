// THE DASHBOARD READS — a family's own view, the principal's counts, and the texts. A caller receives plain
// rows and never holds the store's handle.
import { and, asc, eq, gte, inArray, isNotNull, isNull, lte } from 'drizzle-orm'
import { db } from './db'
import {
  persons, rosterAvailableClasses, rosterCourseCatalog, rosterEnrollments, rosterEvaluations,
  rosterEvents, rosterFamilies, rosterFamilyTracker, rosterTeachers,
} from '../tables'
import { courseOf } from './classroom-mirror'
import { calendarRules, courseRules } from './rules-context'

/** The principal's counts: tracker states, this year's classes and who teaches them, standby, evaluations. */
export async function principalCounts(tenantId: string, eYear: number, aYear: number) {
  const standby = (await courseRules(tenantId)).standbyDepartment2
  const [trackerRows, classesThisYear, standbyEnrollments, langUpdatesPending, classTeacherRows, evalRows] = await Promise.all([
    db.select({ status: rosterFamilyTracker.enrollmentStatus }).from(rosterFamilyTracker).where(and(eq(rosterFamilyTracker.tenantId, tenantId), eq(rosterFamilyTracker.year, eYear))),
    db.select({ id: rosterAvailableClasses.id, classroomCourseId: rosterAvailableClasses.classroomCourseId }).from(rosterAvailableClasses).where(and(eq(rosterAvailableClasses.tenantId, tenantId), eq(rosterAvailableClasses.year, aYear))),
    // deletedAt/droppedOutAt filters: assignFromStandby soft-deletes the standby row; without them the standby count keeps assigned students forever
    db.select({ id: rosterEnrollments.id }).from(rosterEnrollments).innerJoin(rosterAvailableClasses, eq(rosterAvailableClasses.id, rosterEnrollments.classId)).innerJoin(rosterCourseCatalog, eq(rosterCourseCatalog.id, rosterAvailableClasses.courseId)).where(and(eq(rosterEnrollments.tenantId, tenantId), eq(rosterAvailableClasses.year, eYear), eq(rosterCourseCatalog.department2, standby), isNull(rosterEnrollments.deletedAt), isNull(rosterEnrollments.droppedOutAt))),
    db.select({ id: rosterEvaluations.id }).from(rosterEvaluations).where(and(eq(rosterEvaluations.tenantId, tenantId), isNotNull(rosterEvaluations.submittedAt), isNotNull(rosterEvaluations.recommendedCourseId), isNull(rosterEvaluations.languageApprovedAt))),
    db.selectDistinct({ classId: rosterTeachers.classId }).from(rosterTeachers).innerJoin(rosterAvailableClasses, eq(rosterAvailableClasses.id, rosterTeachers.classId)).where(and(eq(rosterTeachers.tenantId, tenantId), eq(rosterAvailableClasses.year, aYear))),
    db.select({ submittedAt: rosterEvaluations.submittedAt, notifiedAt: rosterEvaluations.submittedAt }).from(rosterEvaluations).innerJoin(rosterAvailableClasses, eq(rosterAvailableClasses.id, rosterEvaluations.classId)).where(and(eq(rosterEvaluations.tenantId, tenantId), eq(rosterAvailableClasses.year, aYear))),
  ])
  return { trackerRows, classesThisYear, standbyEnrollments, langUpdatesPending, classTeacherRows, evalRows }
}

/** The roster person whose address is the sign-in's, exactly as written. */
// The signed-in person's own row lives in dashboard-person.ts (persons alone); re-exported for this file's importers.
export { dashboardPersonId } from './dashboard-person'

/** The classes a person teaches this academic year, with each class's Meet, by start time. */
export async function teachingClassesOf(tenantId: string, personId: string, aYear: number) {
  const rows = await db.select({
    classId: rosterAvailableClasses.id,
    shortCode: rosterCourseCatalog.shortCode,
    section: rosterAvailableClasses.section,
    fullName: rosterCourseCatalog.fullName,
    department: rosterCourseCatalog.department,
    classroomCourseId: rosterAvailableClasses.classroomCourseId,
    startTime: rosterAvailableClasses.startTime,
    endTime: rosterAvailableClasses.endTime,
  })
    .from(rosterTeachers)
    .innerJoin(rosterAvailableClasses, eq(rosterAvailableClasses.id, rosterTeachers.classId))
    .innerJoin(rosterCourseCatalog, eq(rosterCourseCatalog.id, rosterAvailableClasses.courseId))
    .where(and(
      eq(rosterTeachers.tenantId, tenantId),
      eq(rosterTeachers.personId, personId),
      eq(rosterAvailableClasses.year, aYear),
    ))
    .orderBy(rosterAvailableClasses.startTime)
  const course = await courseOf(rows)
  return rows.map(r => ({
    classId: r.classId, shortCode: r.shortCode, section: r.section, fullName: r.fullName, department: r.department,
    meet: course(r)?.meet ?? null,   // the Google Classroom's — the one Meet store
    classroomCourseId: r.classroomCourseId, startTime: r.startTime, endTime: r.endTime,
  }))
}

/** The family's children, all of them — boys and girls, live rows. */
export async function familyChildren(tenantId: string, familyId: string) {
  const rows = await db.select({ id: persons.id, firstName: persons.firstName, role: persons.role, firstGradeYear: persons.firstGradeYear })
    .from(persons)
    .where(and(eq(persons.familyId, familyId), eq(persons.tenantId, tenantId), isNull(persons.deletedAt)))
  return rows.filter(p => p.role === 'boy' || p.role === 'girl')
}

/** The next school days (the calendar's school-day event type) from `from` through `to`, as many as the school's
 *  calendar.dashboardSchoolDays. */
export async function upcomingSchoolDays(tenantId: string, from: string, to: string) {
  const { eventTypes: { schoolDay }, dashboardSchoolDays } = await calendarRules(tenantId)
  return db.select({ date: rosterEvents.date, description: rosterEvents.description })
    .from(rosterEvents)
    .where(and(
      eq(rosterEvents.tenantId, tenantId),
      gte(rosterEvents.date, from),
      lte(rosterEvents.date, to),
      eq(rosterEvents.eventType, schoolDay),
    ))
    .orderBy(asc(rosterEvents.date)).limit(dashboardSchoolDays)
}

/** One submitted evaluation of the family's children this academic year, if there is any. */
export function familySubmittedEvaluation(tenantId: string, familyId: string, aYear: number) {
  return db.select({ id: rosterEvaluations.id })
    .from(rosterEvaluations)
    .innerJoin(persons, eq(persons.id, rosterEvaluations.studentId))
    .where(and(
      eq(rosterEvaluations.tenantId, tenantId),
      eq(rosterEvaluations.year, aYear),
      eq(persons.familyId, familyId),
      isNotNull(rosterEvaluations.submittedAt),
    ))
    .limit(1)
}

/** A person's name and both addresses — what deciding a teacher's classroom account needs. */
export async function personNameAndAddresses(personId: string) {
  const [row] = await db.select({ firstName: persons.firstName, lastName: persons.lastName, email: persons.email, classroomEmail: persons.classroomEmail })
    .from(persons).where(eq(persons.id, personId)).limit(1)
  return row ?? null
}

/** The family's two parents, live rows, with the phone the roster holds for each; null when the family names none. */
export async function familyParentsWithPhone(tenantId: string, familyId: string) {
  const [fam] = await db.select({ motherId: rosterFamilies.motherId, fatherId: rosterFamilies.fatherId })
    .from(rosterFamilies).where(and(eq(rosterFamilies.id, familyId), eq(rosterFamilies.tenantId, tenantId))).limit(1)
  const ids = [fam?.motherId, fam?.fatherId].filter((x): x is string => !!x)
  if (ids.length === 0) return null
  return db.select({ id: persons.id, firstName: persons.firstName, lastName: persons.lastName, phone: persons.phone })
    .from(persons).where(and(inArray(persons.id, ids), isNull(persons.deletedAt)))
}
