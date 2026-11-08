// THE TEACHERS, AS A LIST READS THEM: a year's classes with their Meet, who teaches each, how many
// students each holds, and everyone who could be added as a teacher.
import { and, asc, count, eq, inArray, isNull } from 'drizzle-orm'
import { db } from './db'
import { persons, rosterAvailableClasses, rosterCourseCatalog, rosterEnrollments, rosterTeachers } from '../tables'
import { courseOf } from './classroom-mirror'

/** The year's classes with catalog fields, classroom and Meet, by department, level and short code. */
export async function classesOfYearWithMeet(tenantId: string, year: number) {
  const rows = await db
    .select({
      classId: rosterAvailableClasses.id,
      shortCode: rosterCourseCatalog.shortCode,
      fullName: rosterCourseCatalog.fullName,
      department: rosterCourseCatalog.department,
      level: rosterCourseCatalog.level,
      section: rosterAvailableClasses.section,
      classroomCourseId: rosterAvailableClasses.classroomCourseId,
    })
    .from(rosterAvailableClasses)
    .leftJoin(rosterCourseCatalog, eq(rosterCourseCatalog.id, rosterAvailableClasses.courseId))
    .where(and(
      eq(rosterAvailableClasses.tenantId, tenantId),
      eq(rosterAvailableClasses.year, year),
    ))
    .orderBy(asc(rosterCourseCatalog.department), asc(rosterCourseCatalog.level), asc(rosterCourseCatalog.shortCode))
  const course = await courseOf(rows)
  return rows.map(r => ({ ...r, meet: course(r)?.meet ?? null }))   // the Google Classroom's — the one Meet store
}

/** Every teacher row of the year's classes, with the person's name and contacts. */
export function teachersOfYear(tenantId: string, year: number) {
  return db
    .select({
      id: rosterTeachers.id,
      classId: rosterTeachers.classId,
      personId: rosterTeachers.personId,
      typeOfTeacher: rosterTeachers.typeOfTeacher,
      firstName: persons.firstName,
      lastName: persons.lastName,
      email: persons.email,
      phone: persons.phone,
      role: persons.role,
    })
    .from(rosterTeachers)
    .leftJoin(persons, eq(persons.id, rosterTeachers.personId))
    .leftJoin(rosterAvailableClasses, eq(rosterAvailableClasses.id, rosterTeachers.classId))
    .where(and(
      eq(rosterTeachers.tenantId, tenantId),
      eq(rosterAvailableClasses.year, year),
    ))
}

/** Live students per class, for the given classes. */
export async function liveEnrollmentCounts(classIds: string[]) {
  if (classIds.length === 0) return []
  return db
    .select({ classId: rosterEnrollments.classId, cnt: count() })
    .from(rosterEnrollments)
    .where(and(
      inArray(rosterEnrollments.classId, classIds),
      isNull(rosterEnrollments.droppedOutAt),
      isNull(rosterEnrollments.deletedAt),
    ))
    .groupBy(rosterEnrollments.classId)
}

/** Every live person of the tenant, by first then last name — each is a candidate to teach. */
export function teacherCandidates(tenantId: string) {
  return db
    .select({ id: persons.id, firstName: persons.firstName, lastName: persons.lastName, email: persons.email })
    .from(persons)
    .where(and(
      eq(persons.tenantId, tenantId),
      isNull(persons.deletedAt),
    ))
    .orderBy(asc(persons.firstName), asc(persons.lastName))
}
