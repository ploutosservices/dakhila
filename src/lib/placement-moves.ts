// THE STANDBY LIST'S TWO MOVES. Who may make them is the API's.
import { createClass, swapClassAssignment } from './roster-class-writes'
import { languageEnrollmentsOf, classOfCourseInYear, standbyEnrollmentOf } from './roster-standby'

// Move a student out of their current next-year language class into the recommended one.
// Works for any non-standby enrollment — the complement to swapStandbyToRecommended.
export async function moveToRecommendedAct(tenantId: string, studentId: string, recommendedCourseId: string, nextYear: number): Promise<{ error?: string }> {
  const langEnrollments = await languageEnrollmentsOf(tenantId, studentId, nextYear)

  if (langEnrollments.length === 0) return { error: 'No language enrollment found for next year' }
  const toRemove = langEnrollments.find(e => e.courseId !== recommendedCourseId)
  if (!toRemove) return {}

  const targetClassId = await classOfCourseInYear(tenantId, recommendedCourseId, nextYear)
    ?? await createClass(tenantId, { courseId: recommendedCourseId, year: nextYear })

  await swapClassAssignment(tenantId, toRemove.enrollmentId, studentId, targetClassId)
  return {}
}

// Move a student out of their standby enrollment into a chosen language class.
export async function assignFromStandbyAct(tenantId: string, studentId: string, targetCourseId: string, eYear: number): Promise<{ error?: string }> {
  const standbyEnrollmentId = await standbyEnrollmentOf(tenantId, studentId, eYear)

  if (!standbyEnrollmentId) return { error: 'No standby enrollment found' }

  const targetClassId = await classOfCourseInYear(tenantId, targetCourseId, eYear)

  if (!targetClassId) return { error: 'Class not found for this year' }

  await swapClassAssignment(tenantId, standbyEnrollmentId, studentId, targetClassId)
  return {}
}
