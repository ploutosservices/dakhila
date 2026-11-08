// THE ONE READER OF WHAT AN ENROLLMENT OWES AND HAS PAID — every server path asks here (no two codes for the same
// idea). The rule is tuition-owed.ts; this file only reads the rows it needs.
import { inArray } from 'drizzle-orm'
import { db } from './db'
import { cashEnrollmentPayments, familyEnrollments, familyEnrollmentStudents } from '../tables'
import { countedChildren, firstPaymentMoment, tuitionOwed } from './tuition-owed'
import type { FeeContext } from './fees'
import { feeContext } from './fee-context'
import { ports } from '../ports'

export type OwedAndPaid = {
  owed: number
  /** The sum of every entry, refunds negative. */
  paid: number
  /** The children the fee counts. */
  counted: number
  /** The moment of the first payment, which set the rate; null when nothing is paid. */
  firstPaid: Date | null
}

/** What each of the given enrollments owes and has paid. An id with no enrollment row is absent from the map. */
export async function owedAndPaid(enrollmentIds: string[]): Promise<Map<string, OwedAndPaid>> {
  const out = new Map<string, OwedAndPaid>()
  if (!enrollmentIds.length) return out
  const [enrollments, students, payments] = await Promise.all([
    db.select({ id: familyEnrollments.id, tenantId: familyEnrollments.tenantId, status: familyEnrollments.status, year: familyEnrollments.year })
      .from(familyEnrollments).where(inArray(familyEnrollments.id, enrollmentIds)),
    db.select({ enrollmentId: familyEnrollmentStudents.enrollmentId, droppedOutAt: familyEnrollmentStudents.droppedOutAt })
      .from(familyEnrollmentStudents).where(inArray(familyEnrollmentStudents.enrollmentId, enrollmentIds)),
    db.select({ enrollmentId: cashEnrollmentPayments.enrollmentId, amount: cashEnrollmentPayments.amount,
      paidAt: cashEnrollmentPayments.paidAt, createdAt: cashEnrollmentPayments.createdAt })
      .from(cashEnrollmentPayments).where(inArray(cashEnrollmentPayments.enrollmentId, enrollmentIds)),
  ])
  // The school's fee rules, read once for each tenant the enrollments belong to; one instant for every row.
  const contexts = new Map<string, FeeContext>()
  for (const t of new Set(enrollments.map(e => e.tenantId))) contexts.set(t, await feeContext(t))
  const now = ports().clock.now()
  for (const e of enrollments) {
    const c = contexts.get(e.tenantId)!
    const dropped = students.filter(s => s.enrollmentId === e.id).map(s => s.droppedOutAt)
    const mine = payments.filter(p => p.enrollmentId === e.id)
    const firstPaid = firstPaymentMoment(mine, c.timezone)
    const year = e.year
    out.set(e.id, {
      owed: tuitionOwed(c, { status: e.status, year, firstPaid, droppedOutAt: dropped }, now),
      paid: mine.reduce((s, p) => s + Number(p.amount), 0),
      counted: countedChildren(c, year, dropped),
      firstPaid,
    })
  }
  return out
}

/** One enrollment's owed and paid; zeros when the enrollment does not exist. */
export async function owedAndPaidOf(enrollmentId: string): Promise<OwedAndPaid> {
  return (await owedAndPaid([enrollmentId])).get(enrollmentId) ?? { owed: 0, paid: 0, counted: 0, firstPaid: null }
}
