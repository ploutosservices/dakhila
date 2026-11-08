// THE CLASSES, AS A LIST READS THEM: the catalog for a new class, a year's classes with their
// classroom, Meet and live enrolment, who teaches each, and how many children the year holds.
import { and, eq, isNull, sql } from 'drizzle-orm'
import { db } from './db'
import { persons, rosterAvailableClasses, rosterCourseCatalog, rosterEnrollments, rosterTeachers } from '../tables'
import { courseOf } from './classroom-mirror'

/** The tenant's course catalog, by department then short code — what a new class is made from. */
export function tenantCatalogCourses(tenantId: string) {
  return db
    .select({
      id: rosterCourseCatalog.id,
      shortCode: rosterCourseCatalog.shortCode,
      fullName: rosterCourseCatalog.fullName,
      department: rosterCourseCatalog.department,
    })
    .from(rosterCourseCatalog)
    .where(eq(rosterCourseCatalog.tenantId, tenantId))
    .orderBy(rosterCourseCatalog.department, rosterCourseCatalog.shortCode)
}

/** The year's classes with catalog fields, their Google Classroom and Meet, and each one's live enrolment count. */
export async function classesOfYearWithEnrolment(tenantId: string, year: number) {
  const rows = await db
    .select({
      id: rosterAvailableClasses.id,
      legacyId: rosterAvailableClasses.legacyId,
      section: rosterAvailableClasses.section,
      startTime: rosterAvailableClasses.startTime,
      endTime: rosterAvailableClasses.endTime,
      shortCode: rosterCourseCatalog.shortCode,
      fullName: rosterCourseCatalog.fullName,
      department: rosterCourseCatalog.department,
      level: rosterCourseCatalog.level,
      classroomCourseId: rosterAvailableClasses.classroomCourseId,
      enrollmentCount: sql<number>`count(distinct ${rosterEnrollments.id})`.as('enrollment_count'),
    })
    .from(rosterAvailableClasses)
    .leftJoin(rosterCourseCatalog, eq(rosterCourseCatalog.id, rosterAvailableClasses.courseId))
    .leftJoin(rosterEnrollments, and(
      eq(rosterEnrollments.classId, rosterAvailableClasses.id),
      isNull(rosterEnrollments.droppedOutAt),
      isNull(rosterEnrollments.deletedAt),
    ))
    .where(and(
      eq(rosterAvailableClasses.tenantId, tenantId),
      eq(rosterAvailableClasses.year, year),
    ))
    .groupBy(
      rosterAvailableClasses.id,
      rosterCourseCatalog.shortCode,
      rosterCourseCatalog.fullName,
      rosterCourseCatalog.department,
      rosterCourseCatalog.level,
    )
    .orderBy(rosterCourseCatalog.department, rosterCourseCatalog.level)
  const course = await courseOf(rows)
  return rows.map(r => {
    const c = course(r)
    return {
      id: r.id, legacyId: r.legacyId, section: r.section, startTime: r.startTime, endTime: r.endTime,
      shortCode: r.shortCode, fullName: r.fullName, department: r.department, level: r.level,
      // The class's Google Classroom and its Meet — the one Meet store, shown
      // here with the classroom link.
      classroomName: c?.name ?? null,
      classroomSection: c?.section ?? null,
      classroomUrl: c?.alternateLink ?? null,
      enrollmentCode: c?.enrollmentCode ?? null,
      classroomCourseId: r.classroomCourseId,
      meet: c?.meet ?? null,
      enrollmentCount: r.enrollmentCount,
    }
  })
}

/** The year's teacher rows with each teacher's name. */
export function classTeacherNamesOfYear(tenantId: string, year: number) {
  return db
    .select({
      classId: rosterTeachers.classId,
      personId: rosterTeachers.personId,
      typeOfTeacher: rosterTeachers.typeOfTeacher,
      firstName: persons.firstName,
      lastName: persons.lastName,
    })
    .from(rosterTeachers)
    .leftJoin(persons, eq(persons.id, rosterTeachers.personId))
    .leftJoin(rosterAvailableClasses, eq(rosterAvailableClasses.id, rosterTeachers.classId))
    .where(and(
      eq(rosterTeachers.tenantId, tenantId),
      eq(rosterAvailableClasses.year, year),
    ))
}

/** How many children hold a live enrolment in the year — one child in two classes is one student. */
export async function studentsOfYearCount(tenantId: string, year: number): Promise<number> {
  const [{ students }] = await db
    .select({ students: sql<number>`count(distinct ${rosterEnrollments.studentId})` })
    .from(rosterEnrollments)
    .innerJoin(rosterAvailableClasses, eq(rosterAvailableClasses.id, rosterEnrollments.classId))
    .where(and(
      eq(rosterEnrollments.tenantId, tenantId),
      eq(rosterAvailableClasses.year, year),
      isNull(rosterEnrollments.droppedOutAt),
      isNull(rosterEnrollments.deletedAt),
    ))
  return students
}
