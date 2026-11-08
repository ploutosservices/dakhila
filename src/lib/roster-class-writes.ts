// THE CLASSES, WRITTEN, apart from their reads (roster-classes.ts). The roster API and the host's long-running jobs call these.
import type { Actor } from './outward-act'
import { isNotMade } from './not-made'
import type { TeacherType } from './teacher-type'
import { db } from './db'
import { now } from './host'
import { rosterEnrollments, rosterAvailableClasses, rosterCourseCatalog, rosterTeachers } from '../tables'
import { birthId, dropIds } from './registry-id'
import { unlinkClass } from './classroom-mirror'
import { eq, and, inArray, isNull, isNotNull } from 'drizzle-orm'
import { archiveCourse } from './google-classroom'
import { classTimesForDepartment } from './class-times'
import { courseRules } from './rules-context'
import { classDeletionBlockers } from './roster-classes'

export type ClassData = {
  courseId?: string | null
  year: number
  section?: string | null
  startTime?: string | null
  endTime?: string | null
  meet?: string | null
}

// The one door for class creation. Times are rule-based: when the caller
// does not supply them, they are derived from the course's department via
// classTimesForDepartment. A class can never be created without times — the
// store refuses it — so an unmapped department or a missing course is an error
// here, not a silent null.
export async function createClass(tenantId: string, data: ClassData): Promise<string> {
  if (!data.startTime || !data.endTime) {
    if (!data.courseId) {
      throw new Error('createClass: no times supplied and no course to derive them from')
    }
    const [course] = await db
      .select({ department: rosterCourseCatalog.department })
      .from(rosterCourseCatalog)
      .where(and(eq(rosterCourseCatalog.id, data.courseId), eq(rosterCourseCatalog.tenantId, tenantId)))
      .limit(1)
    if (!course) {
      throw new Error(`createClass: course ${data.courseId} not found in catalog`)
    }
    const times = classTimesForDepartment(await courseRules(tenantId), course.department)
    if (!times) {
      throw new Error(`createClass: no class-time rule for department '${course.department}'`)
    }
    data = { ...data, ...times }
  }
  return db.transaction(async tx => {
    const id = await birthId(tx, 'class', tenantId)
    await tx.insert(rosterAvailableClasses).values({ id, tenantId, ...data })
    return id
  })
}

export async function assignStudentToClass(tenantId: string, studentId: string, classId: string): Promise<void> {
  await db.insert(rosterEnrollments).values({ tenantId, studentId, classId }).onConflictDoNothing()
}

export async function removeClassAssignment(tenantId: string, enrollmentId: string): Promise<void> {
  await db.update(rosterEnrollments)
    .set({ deletedAt: now() })
    .where(and(
      eq(rosterEnrollments.id, enrollmentId),
      eq(rosterEnrollments.tenantId, tenantId),
    ))
}

export async function swapClassAssignment(
  tenantId: string,
  removeEnrollmentId: string,
  studentId: string,
  newClassId: string,
): Promise<void> {
  await db.transaction(async tx => {
    await tx.update(rosterEnrollments)
      .set({ deletedAt: now() })
      .where(and(
        eq(rosterEnrollments.id, removeEnrollmentId),
        eq(rosterEnrollments.tenantId, tenantId),
      ))
    const [existing] = await tx
      .select({ id: rosterEnrollments.id })
      .from(rosterEnrollments)
      .where(and(
        eq(rosterEnrollments.tenantId, tenantId),
        eq(rosterEnrollments.studentId, studentId),
        eq(rosterEnrollments.classId, newClassId),
        isNull(rosterEnrollments.droppedOutAt),
        isNull(rosterEnrollments.deletedAt),
      ))
      .limit(1)
    if (!existing) {
      await tx.insert(rosterEnrollments).values({ tenantId, studentId, classId: newClassId })
    }
  })
}

/** Set or clear (null) a class's section. */
export async function setClassSection(tenantId: string, classId: string, section: string | null): Promise<void> {
  await db
    .update(rosterAvailableClasses)
    .set({ section })
    .where(and(
      eq(rosterAvailableClasses.id, classId),
      eq(rosterAvailableClasses.tenantId, tenantId),
    ))
}

/** Make a person a teacher of each class that does not already have them, as the type given. */
export async function assignTeacherToClasses(tenantId: string, classIds: string[], personId: string, typeOfTeacher: TeacherType): Promise<void> {
  for (const classId of classIds) {
    const existing = await db.select().from(rosterTeachers)
      .where(and(eq(rosterTeachers.classId, classId), eq(rosterTeachers.personId, personId)))
      .limit(1)
    if (existing.length === 0) {
      await db.insert(rosterTeachers).values({ tenantId, classId, personId, typeOfTeacher })
    }
  }
}

/** Change what a person is in each of the classes — lead, regular or backup. */
export async function setTeacherTypeInClasses(tenantId: string, classIds: string[], personId: string, typeOfTeacher: TeacherType): Promise<void> {
  if (classIds.length === 0) return
  await db.update(rosterTeachers)
    .set({ typeOfTeacher })
    .where(and(eq(rosterTeachers.tenantId, tenantId), inArray(rosterTeachers.classId, classIds), eq(rosterTeachers.personId, personId)))
}

/** Take a person off every one of the classes as teacher. */
export async function removeTeacherFromClasses(classIds: string[], personId: string): Promise<void> {
  await db.delete(rosterTeachers).where(
    and(inArray(rosterTeachers.classId, classIds), eq(rosterTeachers.personId, personId))
  )
}

/** Archive the linked Google Classroom (production only), then remove the class, its teacher assignments and —
 *  when nothing else names it — its record id. Refuses a class that ever had a child.
 *  Returns the class's year. */
export async function deleteEmptyClass(tenantId: string, classId: string, actor: Actor): Promise<{ year: number; notMade?: string }> {
  const [cls] = await db.select({ year: rosterAvailableClasses.year, classroomCourseId: rosterAvailableClasses.classroomCourseId })
    .from(rosterAvailableClasses).where(and(eq(rosterAvailableClasses.id, classId), eq(rosterAvailableClasses.tenantId, tenantId)))
  if (!cls) throw new Error('This class does not exist.')
  const blockers = await classDeletionBlockers(tenantId, classId)
  if (blockers.length) throw new Error(`This class cannot be deleted: ${blockers.join('; ')}.`)
  // Off production the archive is not made: the delete goes on and the statement is handed back.
  const archived = cls.classroomCourseId ? await archiveCourse(tenantId, cls.classroomCourseId, actor) : undefined
  await db.transaction(async tx => {
    await tx.delete(rosterTeachers).where(and(eq(rosterTeachers.tenantId, tenantId), eq(rosterTeachers.classId, classId)))
    // Removed enrollments only — the blockers above refused any live one.
    await tx.delete(rosterEnrollments).where(and(eq(rosterEnrollments.tenantId, tenantId), eq(rosterEnrollments.classId, classId), isNotNull(rosterEnrollments.deletedAt)))
    await unlinkClass(tx, tenantId, classId)
    await tx.delete(rosterAvailableClasses).where(and(eq(rosterAvailableClasses.id, classId), eq(rosterAvailableClasses.tenantId, tenantId)))
    // The record id goes too unless another record still names it — a savepoint, so a refusal keeps the rest.
    await tx.transaction(async sp => { await dropIds(sp, [classId], tenantId) }).catch(() => {})
  })
  return { year: cls.year, ...(isNotMade(archived) ? { notMade: archived.statement } : {}) }
}
