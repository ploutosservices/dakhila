// THE ROSTER CLASSES BEHIND EACH GOOGLE CLASSROOM, for the roster API's classroom.* reads: a screen of the classrooms
// reaches no roster table, only these answers.
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { db } from './db'
import { rosterAvailableClasses, rosterCourseCatalog, rosterEnrollments } from '../tables'

/** The year's roster classes that no classroom holds yet, by short code and section. */
export function unassignedClassesOfYear(tenantId: string, year: number) {
  return db
    .select({
      id: rosterAvailableClasses.id,
      shortCode: rosterCourseCatalog.shortCode,
      section: rosterAvailableClasses.section,
    })
    .from(rosterAvailableClasses)
    .innerJoin(rosterCourseCatalog, eq(rosterCourseCatalog.id, rosterAvailableClasses.courseId))
    .where(and(
      eq(rosterAvailableClasses.tenantId, tenantId),
      eq(rosterAvailableClasses.year, year),
      isNull(rosterAvailableClasses.classroomCourseId),
    ))
    .orderBy(asc(rosterCourseCatalog.shortCode), asc(rosterAvailableClasses.section))
}

/** The classroom each of the year's roster classes points at (null for one that points at none). */
export function classroomIdsOfYear(tenantId: string, year: number) {
  return db
    .select({ courseId: rosterAvailableClasses.classroomCourseId })
    .from(rosterAvailableClasses)
    .where(and(
      eq(rosterAvailableClasses.tenantId, tenantId),
      eq(rosterAvailableClasses.year, year),
    ))
}

/** The roster classes (any year) that point at one classroom, each with its live student count. */
export function rosterClassesOfClassroom(tenantId: string, courseId: string) {
  return db
    .select({
      id: rosterAvailableClasses.id,
      year: rosterAvailableClasses.year,
      section: rosterAvailableClasses.section,
      startTime: rosterAvailableClasses.startTime,
      endTime: rosterAvailableClasses.endTime,
      shortCode: rosterCourseCatalog.shortCode,
      // Each class's live students — the count the roster's class list shows.
      students: sql<number>`(select count(*)::int from ${rosterEnrollments} e where e.class_id = ${rosterAvailableClasses.id} and e.deleted_at is null and e.dropped_out_at is null)`,
    })
    .from(rosterAvailableClasses)
    .leftJoin(rosterCourseCatalog, eq(rosterAvailableClasses.courseId, rosterCourseCatalog.id))
    .where(and(
      eq(rosterAvailableClasses.tenantId, tenantId),
      eq(rosterAvailableClasses.classroomCourseId, courseId),
    ))
}

/** The given roster classes' section and catalog course, and each catalog course's short code. */
export async function rosterClassLabelParts(classIds: string[]) {
  const rosterClasses = classIds.length > 0
    ? await db
        .select({ id: rosterAvailableClasses.id, section: rosterAvailableClasses.section, courseId: rosterAvailableClasses.courseId })
        .from(rosterAvailableClasses)
        .where(inArray(rosterAvailableClasses.id, classIds))
    : []
  const catalogIds = rosterClasses.map(r => r.courseId).filter(Boolean) as string[]
  const catalog = catalogIds.length > 0
    ? await db
        .select({ id: rosterCourseCatalog.id, shortCode: rosterCourseCatalog.shortCode })
        .from(rosterCourseCatalog)
        .where(inArray(rosterCourseCatalog.id, catalogIds))
    : []
  return { rosterClasses, catalog }
}
