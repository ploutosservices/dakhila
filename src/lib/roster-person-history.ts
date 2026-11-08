// A PERSON'S CLASS HISTORY — the years they were enrolled in classes and the classes they taught, newest first.
import { and, desc, eq, isNull } from 'drizzle-orm'
import { db } from './db'
import { rosterAvailableClasses, rosterCourseCatalog, rosterEnrollments, rosterTeachers } from '../tables'

/** Every live enrollment of a student, with its class's year, code, section and department, newest year first. */
export function studentClassHistory(personId: string) {
  return db
    .select({
      year: rosterAvailableClasses.year,
      shortCode: rosterCourseCatalog.shortCode,
      section: rosterAvailableClasses.section,
      classId: rosterAvailableClasses.id,
      department: rosterCourseCatalog.department,
    })
    .from(rosterEnrollments)
    .innerJoin(rosterAvailableClasses, eq(rosterAvailableClasses.id, rosterEnrollments.classId))
    .innerJoin(rosterCourseCatalog, eq(rosterCourseCatalog.id, rosterAvailableClasses.courseId))
    .where(and(eq(rosterEnrollments.studentId, personId), isNull(rosterEnrollments.deletedAt), isNull(rosterEnrollments.droppedOutAt)))
    .orderBy(desc(rosterAvailableClasses.year))
}

/** Every class a person taught, with year, code, section, course name and whether they led it, newest year first. */
export function teachingHistory(personId: string) {
  return db
    .select({
      year: rosterAvailableClasses.year,
      shortCode: rosterCourseCatalog.shortCode,
      section: rosterAvailableClasses.section,
      fullName: rosterCourseCatalog.fullName,
      typeOfTeacher: rosterTeachers.typeOfTeacher,
      classId: rosterAvailableClasses.id,
    })
    .from(rosterTeachers)
    .innerJoin(rosterAvailableClasses, eq(rosterAvailableClasses.id, rosterTeachers.classId))
    .innerJoin(rosterCourseCatalog, eq(rosterCourseCatalog.id, rosterAvailableClasses.courseId))
    .where(eq(rosterTeachers.personId, personId))
    .orderBy(desc(rosterAvailableClasses.year))
}
