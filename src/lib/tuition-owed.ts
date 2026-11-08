// WHAT A FAMILY OWES FOR A YEAR'S TUITION — one rule, pure, so every reader of "owed" can ask it.
//
// The roster knows every family that registered and the day it first enrolled; from the school's rules (fees.ts) it
// knows how much tuition each family owes; if the two numbers differ, an action is required. A drop-out after the
// school's day (`fees.dropoutCountsAfter`) does not change the fee owed.
//
// - The rate is the one in force at the moment the family first PAID, as the family's own form prices it; a family
//   that has not paid is priced at the moment asked. The MOMENT counts, not only its day: a tier's grace window keeps a
//   payment made late on the night before a tier ends inside it.
// - A child counts unless they dropped out on or before the school's day of the enrollment year.
// - A cancelled enrollment owes nothing.
// Paid is the sum of every entry, refunds being negative entries (family-money.ts).

import { calculateFee, type FeeContext } from './fees'
import { isoDayIn, offsetMinutes } from './zoned'

export type OwedInput = {
  status: string | null
  year: number
  /** The moment of the family's first payment, or null when nothing is paid yet. */
  firstPaid: Date | null
  /** Each child on the enrollment: when they dropped out, or null. */
  droppedOutAt: (Date | null)[]
}

/** The calendar day of an instant in the school's zone, "YYYY-MM-DD". */
const dayIn = isoDayIn

/** The children the fee counts: every child but one who dropped out on or before the school's day of the year. */
export function countedChildren(c: FeeContext, year: number, droppedOutAt: (Date | null)[]): number {
  const d = c.fees.dropoutCountsAfter
  const cutoff = `${year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`
  return droppedOutAt.filter(x => x === null || dayIn(x, c.timezone) > cutoff).length
}

/** 23:59:59 of a calendar day in a zone, as an instant. */
function endOfDayIn(day: string, tz: string): Date {
  const guess = new Date(`${day}T23:59:59Z`)
  return new Date(guess.getTime() - offsetMinutes(guess, tz) * 60_000)
}

/** A payment's moment: when it was recorded, or the end of its paid day when that is earlier (a Zelle synced
 *  days after it was sent). */
export function paymentMoment(p: { paidAt: string | null; createdAt: Date | string }, tz: string): Date {
  const recorded = new Date(p.createdAt)
  if (!p.paidAt) return recorded
  const endOfPaidDay = endOfDayIn(p.paidAt.slice(0, 10), tz)
  return endOfPaidDay < recorded ? endOfPaidDay : recorded
}

/** The moment of the first money in (refunds, being negative, are not a payment), or null. */
export function firstPaymentMoment(payments: { amount: number | string; paidAt: string | null; createdAt: Date | string }[], tz: string): Date | null {
  const moments = payments.filter(p => Number(p.amount) > 0).map(p => paymentMoment(p, tz).getTime())
  return moments.length ? new Date(Math.min(...moments)) : null
}

/** What an enrollment owes: priced at its first payment's moment, or at `now` when nothing is paid. */
export function tuitionOwed(c: FeeContext, e: OwedInput, now: Date): number {
  if (e.status === 'cancelled') return 0
  return calculateFee(c, countedChildren(c, e.year, e.droppedOutAt), e.firstPaid ?? now)
}

/** True when paid and owed differ by a cent or more — the report's row, an action. */
export function paidDiffersFromOwed(paid: number, owed: number): boolean {
  return Math.round((paid - owed) * 100) !== 0
}
