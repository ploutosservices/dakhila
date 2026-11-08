// Shared helper for swapping a student out of a language standby class into their recommended class.
import { db } from './db'
import { now } from './host'
import {
  rosterEnrollments, rosterAvailableClasses, rosterCourseCatalog,
} from '../tables'
import { eq, and, inArray, isNull } from 'drizzle-orm'
import { createClass } from './roster-class-writes'
import { courseRules } from './rules-context'


// Swap a student out of standby and into their recommended language class for nextYear.
// Returns true if a swap was performed. No-op (returns false) if student is not in standby.
export async function swapStandbyToRecommended(
  tenantId: string,
  studentId: string,
  recommendedCourseId: string,
  nextYear: number,
): Promise<boolean> {
  const courses = await courseRules(tenantId)
  const langEnrollments = await db
    .select({
      enrollmentId: rosterEnrollments.id,
      department2:  rosterCourseCatalog.department2,
    })
    .from(rosterEnrollments)
    .leftJoin(rosterAvailableClasses, eq(rosterAvailableClasses.id, rosterEnrollments.classId))
    .leftJoin(rosterCourseCatalog, eq(rosterCourseCatalog.id, rosterAvailableClasses.courseId))
    .where(and(
      eq(rosterEnrollments.tenantId, tenantId),
      eq(rosterEnrollments.studentId, studentId),
      eq(rosterAvailableClasses.year, nextYear),
      inArray(rosterCourseCatalog.department, courses.languages),
      isNull(rosterEnrollments.droppedOutAt),
      isNull(rosterEnrollments.deletedAt),
    ))

  const standby = langEnrollments.find(e => e.department2 === courses.standbyDepartment2)
  if (!standby) return false

  let [targetClass] = await db
    .select({ id: rosterAvailableClasses.id })
    .from(rosterAvailableClasses)
    .where(and(
      eq(rosterAvailableClasses.tenantId, tenantId),
      eq(rosterAvailableClasses.courseId, recommendedCourseId),
      eq(rosterAvailableClasses.year, nextYear),
    ))
    .limit(1)

  if (!targetClass) {
    // createClass is the one door: it derives the class times from the course's
    // department, and the store refuses a class without times.
    targetClass = { id: await createClass(tenantId, { courseId: recommendedCourseId, year: nextYear }) }
  }

  await db.transaction(async tx => {
    await tx.update(rosterEnrollments)
      .set({ deletedAt: now() })
      .where(and(
        eq(rosterEnrollments.id, standby.enrollmentId),
        eq(rosterEnrollments.tenantId, tenantId),
      ))
    const [existing] = await tx
      .select({ id: rosterEnrollments.id })
      .from(rosterEnrollments)
      .where(and(
        eq(rosterEnrollments.tenantId, tenantId),
        eq(rosterEnrollments.studentId, studentId),
        eq(rosterEnrollments.classId, targetClass.id),
        isNull(rosterEnrollments.droppedOutAt),
        isNull(rosterEnrollments.deletedAt),
      ))
      .limit(1)
    if (!existing) {
      await tx.insert(rosterEnrollments).values({ tenantId, studentId, classId: targetClass.id })
    }
  })

  return true
}
