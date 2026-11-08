// THE CLASSES, READ. Their writes live in roster-class-writes.ts; standby and placement in roster-standby.ts.

import { db } from './db'
import { rosterEnrollments, rosterAvailableClasses, rosterCourseCatalog, rosterTeachers, persons, rosterEvaluations, rosterEvents } from '../tables'
import { courseOf } from './classroom-mirror'
import { tenantTimezone } from './tenant'
import { eq, and, asc, desc, isNull, isNotNull, count } from 'drizzle-orm'
import { academicYearOf } from './year-context'
import { schoolYearLabel } from './enrollment'

export async function getClassAssignment(tenantId: string, studentId: string, classId: string) {
  const [row] = await db
    .select({ id: rosterEnrollments.id })
    .from(rosterEnrollments)
    .where(and(
      eq(rosterEnrollments.tenantId, tenantId),
      eq(rosterEnrollments.studentId, studentId),
      eq(rosterEnrollments.classId, classId),
      isNull(rosterEnrollments.droppedOutAt),
      isNull(rosterEnrollments.deletedAt),
    ))
    .limit(1)
  return row ?? null
}

export async function getStudentEnrollments(tenantId: string, studentId: string) {
  return db
    .select({ id: rosterEnrollments.id, classId: rosterEnrollments.classId })
    .from(rosterEnrollments)
    .where(and(
      eq(rosterEnrollments.tenantId, tenantId),
      eq(rosterEnrollments.studentId, studentId),
      isNull(rosterEnrollments.droppedOutAt),
      isNull(rosterEnrollments.deletedAt),
    ))
}

// A student's active classes for one school year, with course code/name, time, and
// join links. Active = enrollment not dropped and not deleted. Ordered by start time.
// The single source for a student's own schedule: every reader of it calls this; an inline copy elsewhere would miss
// the dropped/deleted filter.
export async function getStudentSchedule(tenantId: string, studentId: string, year: number) {
  const rows = await db
    .select({
      classId:           rosterAvailableClasses.id,
      shortCode:         rosterCourseCatalog.shortCode,
      fullName:          rosterCourseCatalog.fullName,
      section:           rosterAvailableClasses.section,
      startTime:         rosterAvailableClasses.startTime,
      endTime:           rosterAvailableClasses.endTime,
      classroomCourseId: rosterAvailableClasses.classroomCourseId,
    })
    .from(rosterEnrollments)
    .innerJoin(rosterAvailableClasses, eq(rosterAvailableClasses.id, rosterEnrollments.classId))
    .innerJoin(rosterCourseCatalog, eq(rosterCourseCatalog.id, rosterAvailableClasses.courseId))
    .where(and(
      eq(rosterEnrollments.studentId, studentId),
      eq(rosterEnrollments.tenantId, tenantId),
      eq(rosterAvailableClasses.year, year),
      isNull(rosterEnrollments.droppedOutAt),
      isNull(rosterEnrollments.deletedAt),
    ))
    .orderBy(asc(rosterAvailableClasses.startTime))
  const course = await courseOf(rows)
  return rows.map(r => ({
    classId: r.classId, shortCode: r.shortCode, fullName: r.fullName, section: r.section, startTime: r.startTime, endTime: r.endTime,
    meet: course(r)?.meet ?? null,   // the Google Classroom's — the one Meet store
    classroomCourseId: r.classroomCourseId,
  }))
}

// THE SAME SHAPE, FROM THE OTHER SIDE OF THE CLASS. A teacher's classes for a year, read from
// roster_teachers instead of roster_enrollments — the select is deliberately identical to
// getStudentSchedule's so a caller (the teacher card) formats one kind of row, not two.
export async function getTeacherSchedule(tenantId: string, personId: string, year: number) {
  const rows = await db
    .select({
      classId:           rosterAvailableClasses.id,
      shortCode:         rosterCourseCatalog.shortCode,
      fullName:          rosterCourseCatalog.fullName,
      section:           rosterAvailableClasses.section,
      startTime:         rosterAvailableClasses.startTime,
      endTime:           rosterAvailableClasses.endTime,
      classroomCourseId: rosterAvailableClasses.classroomCourseId,
      typeOfTeacher:     rosterTeachers.typeOfTeacher,
      department:        rosterCourseCatalog.department,
    })
    .from(rosterTeachers)
    .innerJoin(rosterAvailableClasses, eq(rosterAvailableClasses.id, rosterTeachers.classId))
    .innerJoin(rosterCourseCatalog, eq(rosterCourseCatalog.id, rosterAvailableClasses.courseId))
    .where(and(
      eq(rosterTeachers.personId, personId),
      eq(rosterTeachers.tenantId, tenantId),
      eq(rosterAvailableClasses.year, year),
    ))
    .orderBy(asc(rosterAvailableClasses.startTime))
  const course = await courseOf(rows)
  return rows.map(r => ({
    classId: r.classId, shortCode: r.shortCode, fullName: r.fullName, section: r.section, startTime: r.startTime, endTime: r.endTime,
    meet: course(r)?.meet ?? null,   // the Google Classroom's — the one Meet store
    classroomCourseId: r.classroomCourseId, typeOfTeacher: r.typeOfTeacher, department: r.department,
  }))
}

/** The students the roster places in a class this year, names included. */
export async function getClassStudents(tenantId: string, classId: string) {
  return db
    .select({
      personId:  persons.id,
      firstName: persons.firstName,
      lastName:  persons.lastName,
      email:     persons.email,
    })
    .from(rosterEnrollments)
    .innerJoin(persons, eq(persons.id, rosterEnrollments.studentId))
    .where(and(
      eq(rosterEnrollments.tenantId, tenantId),
      eq(rosterEnrollments.classId, classId),
      isNull(rosterEnrollments.droppedOutAt),
      isNull(rosterEnrollments.deletedAt),
      isNull(persons.deletedAt),
    ))
    .orderBy(asc(persons.firstName), asc(persons.lastName))
}

export type FamilyStudentSchedule = {
  personId: string
  name: string
  classes: Awaited<ReturnType<typeof getStudentSchedule>>
}

// A family's schedule — every student in the family who has classes this year, each with
// their own class list. The org is a FAMILY UNIT, not individual: a login
// resolves to a family and the family sees all its students. Reuses getStudentSchedule (the
// one schedule engine) per member, so the active-enrollment filtering lives in one place.
// Members with no classes (e.g. a parent) are omitted. Family sizes are small, so the
// per-member query is fine.
export async function getFamilySchedule(tenantId: string, familyId: string, year: number): Promise<FamilyStudentSchedule[]> {
  const members = await db
    .select({ id: persons.id, firstName: persons.firstName, lastName: persons.lastName })
    .from(persons)
    .where(and(eq(persons.familyId, familyId), eq(persons.tenantId, tenantId), isNull(persons.deletedAt)))
    .orderBy(asc(persons.firstName))

  const out: FamilyStudentSchedule[] = []
  for (const m of members) {
    const classes = await getStudentSchedule(tenantId, m.id, year)
    if (classes.length > 0) {
      out.push({ personId: m.id, name: [m.firstName, m.lastName].filter(Boolean).join(' '), classes })
    }
  }
  return out
}

export async function getClassesForYear(tenantId: string, year: number) {
  return db
    .select()
    .from(rosterAvailableClasses)
    .where(and(
      eq(rosterAvailableClasses.tenantId, tenantId),
      eq(rosterAvailableClasses.year, year),
    ))
    .orderBy(asc(rosterAvailableClasses.year))
}

// NEWEST FIRST — the year anyone is working in is the one their eye lands on.
// Both readers of this list
// print it in the order it arrives.
export async function getDistinctYears(tenantId: string) {
  return db
    .selectDistinct({ year: rosterAvailableClasses.year })
    .from(rosterAvailableClasses)
    .where(eq(rosterAvailableClasses.tenantId, tenantId))
    .orderBy(desc(rosterAvailableClasses.year))
}

export async function getClass(tenantId: string, classId: string) {
  const [cls] = await db
    .select()
    .from(rosterAvailableClasses)
    .where(and(
      eq(rosterAvailableClasses.id, classId),
      eq(rosterAvailableClasses.tenantId, tenantId),
    ))
    .limit(1)
  return cls ?? null
}

/** Whether the catalog course is the tenant's. */
export async function tenantCatalogCourseExists(tenantId: string, courseId: string): Promise<boolean> {
  const [course] = await db
    .select({ id: rosterCourseCatalog.id })
    .from(rosterCourseCatalog)
    .where(and(eq(rosterCourseCatalog.id, courseId), eq(rosterCourseCatalog.tenantId, tenantId)))
    .limit(1)
  return !!course
}

// ── Delete a class that never had a child ────────────────
// A principal may delete a class that has no kids; if it has a Classroom, that may need to be archived too.

/** Why this class cannot be deleted, each reason a whole clause — empty when it is a CURRENT-SESSION class
 *  that never had a child: no enrolled student, none who
 *  dropped out, no evaluation, no calendar event naming it. A REMOVED enrollment is not a student and does not block;
 *  it goes with the class. */
export async function classDeletionBlockers(tenantId: string, classId: string): Promise<string[]> {
  const n = async (q: Promise<{ n: number }[]>) => Number((await q)[0]?.n ?? 0)
  const [row] = await db.select({ year: rosterAvailableClasses.year }).from(rosterAvailableClasses)
    .where(and(eq(rosterAvailableClasses.id, classId), eq(rosterAvailableClasses.tenantId, tenantId)))
  const timezone = row ? await tenantTimezone(tenantId) : null
  const cls = row && timezone !== null ? { year: row.year, timezone } : undefined
  const live = and(eq(rosterEnrollments.tenantId, tenantId), eq(rosterEnrollments.classId, classId), isNull(rosterEnrollments.deletedAt))
  const [enrolled, dropped, evaluated, events] = await Promise.all([
    n(db.select({ n: count() }).from(rosterEnrollments).where(and(live, isNull(rosterEnrollments.droppedOutAt)))),
    n(db.select({ n: count() }).from(rosterEnrollments).where(and(live, isNotNull(rosterEnrollments.droppedOutAt)))),
    n(db.select({ n: count() }).from(rosterEvaluations).where(and(eq(rosterEvaluations.tenantId, tenantId), eq(rosterEvaluations.classId, classId)))),
    n(db.select({ n: count() }).from(rosterEvents).where(and(eq(rosterEvents.tenantId, tenantId), eq(rosterEvents.classId, classId)))),
  ])
  const out: string[] = []
  const session = cls ? await academicYearOf(tenantId) : null
  if (cls && cls.year !== session) out.push(`it is a ${schoolYearLabel(cls.year)} class, and only the current session's (${schoolYearLabel(session!)}) classes can be deleted`)
  if (enrolled) out.push(`it has ${enrolled} enrolled student${enrolled === 1 ? '' : 's'}`)
  if (dropped) out.push(`it has ${dropped} student${dropped === 1 ? '' : 's'} who dropped out`)
  if (evaluated) out.push(`it has ${evaluated} evaluation${evaluated === 1 ? '' : 's'}`)
  if (events) out.push(`it has ${events} calendar event${events === 1 ? '' : 's'}`)
  return out
}
