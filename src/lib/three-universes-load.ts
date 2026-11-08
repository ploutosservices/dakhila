// THE THREE-UNIVERSES RUN'S LOADER — the store half of three-universes.ts (whose pure core, computeRun and the run's
// words, reach no store). The roster API's universe.* reads run this; the API's own code calls it directly.

import { db } from './db'
import { tenantTimezone } from './tenant'
import {
  persons,
  rosterFamilies,
  rosterAvailableClasses,
  rosterCourseCatalog,
  rosterEnrollments,
  rosterTeachers,
  familyEnrollments,
  familyEnrollmentStudents,
} from '../tables'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { boardBySlug, sessionMembers } from './classroom-mirror'
import { schoolYearLabel } from './enrollment'
import { workspaceDomain } from './role-mailbox'
import { academicYearOf } from './year-context'
import { courseRules, tenantRules } from './rules-context'
import { computeRun, type RunResult } from './three-universes'

/** Load one tenant's rows and run. Reads only — the run writes nothing. */
export async function runThreeUniverses(tenantId: string): Promise<RunResult> {
  const timezone = await tenantTimezone(tenantId)
  if (timezone === null) throw new Error(`three-universes: no live tenant ${tenantId}`)
  const year = await academicYearOf(tenantId)

  // Roster's DECLARATION:
  // roster declares to the map only classes where someone is expected to come
  // to school — at least one live student enrollment. An undeclared class does
  // not exist for the run; this is roster's boundary, not a map rule.
  const declared = sql`exists (select 1 from roster_enrollments re
    where re.class_id = ${rosterAvailableClasses.id}
      and re.dropped_out_at is null
      and re.deleted_at is null)`

  const [classes, teacherAssignments, studentAssignments, enrollments, enrollmentKids, tenantFamilies, tenantPersons, boardRows, snapshotRows] = await Promise.all([
    db.select({
      id: rosterAvailableClasses.id,
      year: rosterAvailableClasses.year,
      shortCode: rosterCourseCatalog.shortCode,
      department: rosterCourseCatalog.department,
      section: rosterAvailableClasses.section,
      startTime: rosterAvailableClasses.startTime,
      endTime: rosterAvailableClasses.endTime,
      classroomCourseId: rosterAvailableClasses.classroomCourseId,
    }).from(rosterAvailableClasses)
      .leftJoin(rosterCourseCatalog, eq(rosterCourseCatalog.id, rosterAvailableClasses.courseId))
      .where(and(eq(rosterAvailableClasses.tenantId, tenantId), eq(rosterAvailableClasses.year, year), declared)),
    db.select({ id: rosterTeachers.id, classId: rosterTeachers.classId, personId: rosterTeachers.personId })
      .from(rosterTeachers)
      .innerJoin(rosterAvailableClasses, eq(rosterAvailableClasses.id, rosterTeachers.classId))
      .where(and(eq(rosterTeachers.tenantId, tenantId), eq(rosterAvailableClasses.year, year), declared)),
    db.select({ id: rosterEnrollments.id, classId: rosterEnrollments.classId, studentId: rosterEnrollments.studentId })
      .from(rosterEnrollments)
      .innerJoin(rosterAvailableClasses, eq(rosterAvailableClasses.id, rosterEnrollments.classId))
      .where(and(
        eq(rosterEnrollments.tenantId, tenantId),
        eq(rosterAvailableClasses.year, year),
        isNull(rosterEnrollments.droppedOutAt),
        isNull(rosterEnrollments.deletedAt),
        declared,   // a no-op by construction (a live row satisfies it), stated so every class-joined dataset wears the boundary
      )),
    db.select({ id: familyEnrollments.id, familyId: familyEnrollments.familyId, status: familyEnrollments.status })
      .from(familyEnrollments)
      .where(and(eq(familyEnrollments.tenantId, tenantId), eq(familyEnrollments.year, year))),
    db.select({ id: familyEnrollmentStudents.id, enrollmentId: familyEnrollmentStudents.enrollmentId, studentId: familyEnrollmentStudents.studentId })
      .from(familyEnrollmentStudents)
      .innerJoin(familyEnrollments, eq(familyEnrollments.id, familyEnrollmentStudents.enrollmentId))
      .where(and(
        eq(familyEnrollments.tenantId, tenantId),
        eq(familyEnrollments.year, year),
        isNull(familyEnrollmentStudents.droppedOutAt),
      )),
    // A deleted family is gone from the universe too — its persons already are,
    // so leaving the family row in produces a household with nobody in it.
    db.select({ id: rosterFamilies.id, motherId: rosterFamilies.motherId, fatherId: rosterFamilies.fatherId })
      .from(rosterFamilies)
      .where(eq(rosterFamilies.tenantId, tenantId)),
    db.select({
      id: persons.id,
      firstName: persons.firstName,
      lastName: persons.lastName,
      email: persons.email,
      classroomEmail: persons.classroomEmail,
      guardian: persons.guardian,
      familyId: persons.familyId,
    }).from(persons)
      .where(and(eq(persons.tenantId, tenantId), isNull(persons.deletedAt))),
    courseRules(tenantId).then(c => boardBySlug(tenantId, c.schoolBoard.slug)).then(b => (b ? [b] : [])),
    // The snapshot this run reads is the members of the courses whose room claims the session's label — the
    // room = {session} claim, the host's Classroom mirror's one definition (the port's sessionMembers).
    sessionMembers(tenantId, schoolYearLabel(year)),
  ])

  return computeRun({
    year,
    classes,
    teacherAssignments,
    studentAssignments,
    enrollments,
    enrollmentKids,
    tenantFamilies,
    tenantPersons,
    board: boardRows[0] ?? null,
    snapshot: snapshotRows,
    domain: await workspaceDomain(tenantId),
    language: (await tenantRules(tenantId)).locale.language,
  })
}
