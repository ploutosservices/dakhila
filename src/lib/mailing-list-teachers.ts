// THIS SESSION'S TEACHERS FOR THE MAILING LISTS — the roster read a mailing-list sync makes; the roster API's
// teacher.session calls it.
import { db } from './db'
import { persons, rosterTeachers, rosterAvailableClasses, rosterCourseCatalog } from '../tables'
import { and, eq, isNull } from 'drizzle-orm'

export type SessionTeacherRow = { personId: string; firstName: string; lastName: string | null; email: string | null; role: string | null; department: string }

/** Every live person teaching a class of the year, once per department they teach in. */
export async function sessionTeacherRows(tenantId: string, year: number): Promise<SessionTeacherRow[]> {
  return db.selectDistinct({
    personId: persons.id, firstName: persons.firstName, lastName: persons.lastName, email: persons.email,
    role: persons.role, department: rosterCourseCatalog.department,
  })
    .from(rosterTeachers)
    .innerJoin(persons, eq(persons.id, rosterTeachers.personId))
    .innerJoin(rosterAvailableClasses, eq(rosterAvailableClasses.id, rosterTeachers.classId))
    .innerJoin(rosterCourseCatalog, eq(rosterCourseCatalog.id, rosterAvailableClasses.courseId))
    .where(and(eq(rosterTeachers.tenantId, tenantId), eq(rosterAvailableClasses.year, year), isNull(persons.deletedAt)))
}
