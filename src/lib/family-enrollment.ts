import { db } from './db'
import { now as hostNow } from './host'
import { familyEnrollments, familyEnrollmentStudents, rosterEnrollments, rosterAvailableClasses } from '../tables'
import { eq, and, inArray, isNull, isNotNull, sql } from 'drizzle-orm'

export async function getEnrollment(tenantId: string, familyId: string, year: number) {
  const [row] = await db
    .select()
    .from(familyEnrollments)
    .where(and(
      eq(familyEnrollments.tenantId, tenantId),
      eq(familyEnrollments.familyId, familyId),
      eq(familyEnrollments.year, year),
    ))
    .limit(1)
  return row ?? null
}

export async function getEnrolledStudentIds(enrollmentId: string): Promise<string[]> {
  const rows = await db
    .select({ studentId: familyEnrollmentStudents.studentId })
    .from(familyEnrollmentStudents)
    .where(and(
      eq(familyEnrollmentStudents.enrollmentId, enrollmentId),
      isNull(familyEnrollmentStudents.droppedOutAt),
    ))
  return rows.map(r => r.studentId)
}

export async function getEnrolledStudentCount(enrollmentId: string): Promise<number> {
  return db.$count(familyEnrollmentStudents, and(
    eq(familyEnrollmentStudents.enrollmentId, enrollmentId),
    isNull(familyEnrollmentStudents.droppedOutAt),
  ))
}

export async function setEnrolledStudents(enrollmentId: string, tenantId: string, studentIds: string[]): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(familyEnrollmentStudents)
      .where(and(
        eq(familyEnrollmentStudents.enrollmentId, enrollmentId),
        eq(familyEnrollmentStudents.tenantId, tenantId),
      ))
    if (studentIds.length > 0) {
      await tx.insert(familyEnrollmentStudents).values(
        studentIds.map(studentId => ({ enrollmentId, tenantId, studentId }))
      )
    }
  })
}

// Returns a map of enrollmentId → student count.
export async function countEnrolledStudents(enrollmentIds: string[]): Promise<Map<string, number>> {
  if (enrollmentIds.length === 0) return new Map()
  const rows = await db
    .select({
      enrollmentId: familyEnrollmentStudents.enrollmentId,
      count: sql<number>`count(*)::int`,
    })
    .from(familyEnrollmentStudents)
    .where(and(
      inArray(familyEnrollmentStudents.enrollmentId, enrollmentIds),
      isNull(familyEnrollmentStudents.droppedOutAt),
    ))
    .groupBy(familyEnrollmentStudents.enrollmentId)
  return new Map(rows.map(r => [r.enrollmentId, r.count]))
}

export async function setEnrollmentStatus(tenantId: string, enrollmentId: string, status: string): Promise<void> {
  await db.update(familyEnrollments)
    .set({ status })
    .where(and(
      eq(familyEnrollments.tenantId, tenantId),
      eq(familyEnrollments.id, enrollmentId),
    ))
}

export async function getEnrollmentStudents(enrollmentId: string): Promise<{ id: string; studentId: string; droppedOutAt: Date | null }[]> {
  return db
    .select({
      id: familyEnrollmentStudents.id,
      studentId: familyEnrollmentStudents.studentId,
      droppedOutAt: familyEnrollmentStudents.droppedOutAt,
    })
    .from(familyEnrollmentStudents)
    .where(eq(familyEnrollmentStudents.enrollmentId, enrollmentId))
}

/**
 * CANCEL A YEAR'S ENROLMENT — as if it never happened.
 *
 * Cancel means as if nothing happened; drop out means the kids are not attending classes. Two acts,
 * two meanings, and two columns say them apart:
 *
 *   drop out   `dropped_out_at`  they enrolled, they attended, they stopped. The enrolment stands,
 *                                the fee stands, the class row stays as history.
 *   cancel      status + fee 0   nothing happened. No obligation, so no fee and no balance; the
 *              + `deleted_at`    class rows are DELETED rather than marked as left, because a
 *                                left row tells a drop-out story about a year that never ran.
 *
 * WHY THE FEE GOES TO ZERO. A cancelled year owes nothing by definition, so a stored fee must not outlive the
 * children it was for.
 *
 * AND ANY EARLIER DROP-OUT IS UNDONE, on the same reasoning: if the year never happened, it did not
 * happen and then stop happening. A cancel after a drop-out leaves one story, not two.
 *
 * THE MONEY IS NOT TOUCHED. Cancelling returns no money, and a payment that was made was made — the
 * refund is its own recorded act (`bookMoneyForFamily`, a negative amount). Cancelling an enrolment
 * must never silently delete a payment row.
 */
export async function cancelEnrollment(tenantId: string, enrollmentId: string): Promise<void> {
  await db.transaction(async tx => {
    const [enrollment] = await tx
      .select({ year: familyEnrollments.year })
      .from(familyEnrollments)
      .where(and(
        eq(familyEnrollments.tenantId, tenantId),
        eq(familyEnrollments.id, enrollmentId),
      ))
      .limit(1)
    if (!enrollment) return

    await tx.update(familyEnrollments)
      .set({ status: 'cancelled', fee: '0.00' })
      .where(eq(familyEnrollments.id, enrollmentId))

    // The children stay ON the cancelled enrolment — they are the record of who it was for — but
    // they are not "dropped out", because that is the other act's word.
    const students = await tx
      .select({ studentId: familyEnrollmentStudents.studentId })
      .from(familyEnrollmentStudents)
      .where(eq(familyEnrollmentStudents.enrollmentId, enrollmentId))
    await tx.update(familyEnrollmentStudents)
      .set({ droppedOutAt: null })
      .where(eq(familyEnrollmentStudents.enrollmentId, enrollmentId))

    const studentIds = students.map(s => s.studentId)
    if (studentIds.length === 0) return

    const classIdsForYear = await tx
      .select({ id: rosterAvailableClasses.id })
      .from(rosterAvailableClasses)
      .where(eq(rosterAvailableClasses.year, enrollment.year))
    const classIds = classIdsForYear.map(r => r.id)
    if (classIds.length === 0) return

    const now = hostNow()
    await tx.update(rosterEnrollments)
      .set({ deletedAt: now, droppedOutAt: null })
      .where(and(
        eq(rosterEnrollments.tenantId, tenantId),
        inArray(rosterEnrollments.studentId, studentIds),
        isNull(rosterEnrollments.deletedAt),
        inArray(rosterEnrollments.classId, classIds),
      ))
  })
}

export async function markStudentDroppedOut(tenantId: string, enrollmentStudentId: string): Promise<void> {
  await db.transaction(async tx => {
    const [esRow] = await tx
      .select({ studentId: familyEnrollmentStudents.studentId, enrollmentId: familyEnrollmentStudents.enrollmentId })
      .from(familyEnrollmentStudents)
      .where(and(
        eq(familyEnrollmentStudents.id, enrollmentStudentId),
        eq(familyEnrollmentStudents.tenantId, tenantId),
      ))
      .limit(1)
    if (!esRow) return

    const [enrollment] = await tx
      .select({ year: familyEnrollments.year })
      .from(familyEnrollments)
      .where(eq(familyEnrollments.id, esRow.enrollmentId))
      .limit(1)
    if (!enrollment) return

    const now = hostNow()

    await tx.update(familyEnrollmentStudents)
      .set({ droppedOutAt: now })
      .where(eq(familyEnrollmentStudents.id, enrollmentStudentId))

    const classIdsForYear = await tx
      .select({ id: rosterAvailableClasses.id })
      .from(rosterAvailableClasses)
      .where(eq(rosterAvailableClasses.year, enrollment.year))
    const classIds = classIdsForYear.map(r => r.id)

    if (classIds.length > 0) {
      await tx.update(rosterEnrollments)
        .set({ droppedOutAt: now })
        .where(and(
          eq(rosterEnrollments.tenantId, tenantId),
          eq(rosterEnrollments.studentId, esRow.studentId),
          isNull(rosterEnrollments.droppedOutAt),
          isNull(rosterEnrollments.deletedAt),
          inArray(rosterEnrollments.classId, classIds),
        ))
    }
  })
}

export async function markStudentReenrolled(tenantId: string, enrollmentStudentId: string): Promise<void> {
  await db.transaction(async tx => {
    const [esRow] = await tx
      .select({ studentId: familyEnrollmentStudents.studentId, enrollmentId: familyEnrollmentStudents.enrollmentId })
      .from(familyEnrollmentStudents)
      .where(and(
        eq(familyEnrollmentStudents.id, enrollmentStudentId),
        eq(familyEnrollmentStudents.tenantId, tenantId),
      ))
      .limit(1)
    if (!esRow) return

    const [enrollment] = await tx
      .select({ year: familyEnrollments.year })
      .from(familyEnrollments)
      .where(eq(familyEnrollments.id, esRow.enrollmentId))
      .limit(1)
    if (!enrollment) return

    await tx.update(familyEnrollmentStudents)
      .set({ droppedOutAt: null })
      .where(eq(familyEnrollmentStudents.id, enrollmentStudentId))

    const classIdsForYear = await tx
      .select({ id: rosterAvailableClasses.id })
      .from(rosterAvailableClasses)
      .where(eq(rosterAvailableClasses.year, enrollment.year))
    const classIds = classIdsForYear.map(r => r.id)

    if (classIds.length > 0) {
      await tx.update(rosterEnrollments)
        .set({ droppedOutAt: null })
        .where(and(
          eq(rosterEnrollments.tenantId, tenantId),
          eq(rosterEnrollments.studentId, esRow.studentId),
          isNotNull(rosterEnrollments.droppedOutAt),
          isNull(rosterEnrollments.deletedAt),
          inArray(rosterEnrollments.classId, classIds),
        ))
    }
  })
}
