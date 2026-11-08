// REFUNDING A PAYPAL PAYMENT. Only payments captured through the roster's own
// checkout: an enrollment, an event payment, a donation. The payment row is never changed; the refund is a
// second fact — a `paypal_refunds` row as PayPal answered it, and, once PayPal says COMPLETED, the money going out
// booked as the capture booked the money coming in: an enrollment's as a cash transaction out and a NEGATIVE
// `cash_enrollment_payments` entry of the tuition part (the shape `bookFamilyMoney` books, so owed = due − total paid
// reads it unchanged); an event's as a cash transaction out; a donation's capture booked no cash, so its refund is the
// `paypal_refunds` row alone.
import { and, desc, eq, inArray, isNotNull, gt, notInArray, sql } from 'drizzle-orm'
import { db } from './db'
import {
  cashEnrollmentPayments, events, paypalRefunds, rosterDonations, familyEnrollments,
  eventPayments, incomingPayments,
} from '../tables'
import { birthId } from './registry-id'
import { bookEntry, entriesByIds } from './ledger'
import { readOrderCapture, readRefund, refundCapture } from './paypal'
import type { Actor } from './outward-act'
import { paypalBankAccountId, tenantToday } from './event-payments'
import { PAYMENT_CHARACTER_TUITION } from './payment-characters'

import type { RefundKind } from './refund-press'
import { tenantRules } from './rules-context'
import { tenantTimezone } from './tenant'
import { byCode, isoDayIn } from './zoned'
import { moneyIn, moneyRules, type MoneyRules } from './fees'
export type { RefundKind } from './refund-press'

export type RefundablePayment = {
  kind: RefundKind
  id: string
  /** Who paid, as data: the family (an enrollment or an event) or the donor. The payer line is the reader's. */
  familyId: string | null
  donor: string | null
  what: string
  paidOn: string | null
  /** What PayPal captured: the amount, card fee included. */
  paid: number
  refunded: number
  remainder: number
  /** Null for a donation taken before the capture id was stored: read from PayPal on the press. */
  captureId: string | null
}

/** The statuses of refunds that moved no money and never will; every other status counts. */
const NOT_LIVE = ['FAILED', 'CANCELLED']

const cents = (v: number) => Math.round(v * 100) / 100

export async function refundedByCapture(tenantId: string): Promise<Map<string, number>> {
  const rows = await db.select({ captureId: paypalRefunds.captureId, total: sql<string>`sum(${paypalRefunds.amount})` })
    .from(paypalRefunds)
    .where(and(eq(paypalRefunds.tenantId, tenantId), notInArray(paypalRefunds.status, NOT_LIVE)))
    .groupBy(paypalRefunds.captureId)
  return new Map(rows.map(r => [r.captureId, Number(r.total)]))
}

/** Every payment captured through PayPal, newest first, with what has been refunded against it. */
export async function refundablePayments(tenantId: string): Promise<RefundablePayment[]> {
  const refunded = await refundedByCapture(tenantId)
  const zone = await tenantTimezone(tenantId)
  if (!zone) throw new Error(`no live tenant ${tenantId}, so no time zone to date its payments in`)
  const out: RefundablePayment[] = []
  const add = (r: Omit<RefundablePayment, 'refunded' | 'remainder'>) => {
    const done = r.captureId ? refunded.get(r.captureId) ?? 0 : 0
    out.push({ ...r, refunded: done, remainder: cents(r.paid - done) })
  }

  // Enrollments paid through the checkout: the capture id is the entry's reference; the paid total its cash row's.
  const enrollmentPaid = await db.select({
    id: cashEnrollmentPayments.id, familyId: familyEnrollments.familyId, year: familyEnrollments.year,
    paidAt: cashEnrollmentPayments.paidAt, captureId: cashEnrollmentPayments.referenceId, transactionId: cashEnrollmentPayments.transactionId,
  }).from(cashEnrollmentPayments)
    .innerJoin(familyEnrollments, eq(familyEnrollments.id, cashEnrollmentPayments.enrollmentId))
    .where(and(
      eq(cashEnrollmentPayments.tenantId, tenantId), eq(cashEnrollmentPayments.method, 'paypal'),
      isNotNull(cashEnrollmentPayments.paypalOrderId), isNotNull(cashEnrollmentPayments.referenceId),
      gt(cashEnrollmentPayments.amount, '0'),
    ))

  // A family's event payments.
  const eventPaid = await db.select({
    id: eventPayments.id, familyId: eventPayments.familyId, title: events.title,
    paidAt: eventPayments.paidAt, captureId: eventPayments.captureId, transactionId: eventPayments.transactionId,
  }).from(eventPayments)
    .innerJoin(events, eq(events.id, eventPayments.eventId))
    .where(and(eq(eventPayments.tenantId, tenantId), eq(eventPayments.status, 'paid'), isNotNull(eventPayments.captureId)))

  // The paid total is each payment's ledger entry's; a payment with no entry is not offered.
  const charged = new Map((await entriesByIds([...enrollmentPaid, ...eventPaid].map(r => r.transactionId).filter((id): id is string => !!id)))
    .map(e => [e.id, e.amount]))
  const withCharge = <T extends { transactionId: string | null }>(rows: T[]) => rows
    .filter(r => r.transactionId !== null && charged.has(r.transactionId))
    .map(r => ({ ...r, charged: charged.get(r.transactionId!)! }))
  const enrollmentRows = withCharge(enrollmentPaid)
  const eventRows = withCharge(eventPaid)

  for (const r of enrollmentRows) {
    add({ kind: 'enrollment', id: r.id, familyId: r.familyId, donor: null, what: `Enrollment ${r.year}`, paidOn: r.paidAt, paid: Number(r.charged), captureId: r.captureId })
  }
  for (const r of eventRows) {
    add({ kind: 'event', id: r.id, familyId: r.familyId, donor: null, what: r.title, paidOn: r.paidAt ? isoDayIn(r.paidAt, zone) : null, paid: Number(r.charged), captureId: r.captureId })
  }

  // Donations captured through the checkout: the amount is the incoming payment it wrote.
  const donationRows = await db.select({
    id: rosterDonations.id, donor: rosterDonations.donorName, captureId: rosterDonations.captureId,
    paidOn: incomingPayments.receivedAt, amount: incomingPayments.amount,
  }).from(rosterDonations)
    .innerJoin(incomingPayments, eq(incomingPayments.id, rosterDonations.paymentId))
    .where(and(
      eq(rosterDonations.tenantId, tenantId), isNotNull(rosterDonations.paypalOrderId),
      inArray(rosterDonations.status, ['received', 'receipted']), eq(incomingPayments.source, 'paypal'),
    ))
  for (const r of donationRows) {
    add({ kind: 'donation', id: r.id, familyId: null, donor: r.donor, what: 'Donation', paidOn: r.paidOn, paid: Number(r.amount), captureId: r.captureId })
  }

  return out.sort((a, b) => byCode(b.paidOn ?? '', a.paidOn ?? ''))
}

/** The one payment a refund is asked for, with its capture — a donation's read from PayPal once and stored. */
async function paymentToRefund(tenantId: string, kind: RefundKind, id: string): Promise<RefundablePayment | { error: string }> {
  const row = (await refundablePayments(tenantId)).find(p => p.kind === kind && p.id === id)
  if (!row) return { error: 'This payment was not taken through this site’s PayPal checkout; refund it on PayPal’s site.' }
  if (row.captureId) return row
  const [donation] = await db.select({ orderId: rosterDonations.paypalOrderId }).from(rosterDonations)
    .where(and(eq(rosterDonations.tenantId, tenantId), eq(rosterDonations.id, id)))
  const capture = donation?.orderId ? await readOrderCapture(donation.orderId) : null
  if (!capture) return { error: 'PayPal holds no capture for this donation; refund it on PayPal’s site.' }
  await db.update(rosterDonations).set({ captureId: capture.captureId }).where(eq(rosterDonations.id, id))
  const done = (await refundedByCapture(tenantId)).get(capture.captureId) ?? 0
  return { ...row, captureId: capture.captureId, refunded: done, remainder: cents(row.paid - done) }
}

// The press's own check (refundPressRefusal) lives in refund-press.ts, store-free; re-exported.
export { refundPressRefusal } from './refund-press'

/** Refuses an amount the payment cannot give back, by name; null when it may be refunded. */
export function refundAmountRefusal(amount: number, remainder: number, m: MoneyRules): string | null {
  if (!Number.isFinite(amount) || amount <= 0) return 'Enter an amount greater than zero.'
  if (Math.round(amount * 100) !== amount * 100) return 'An amount has at most two decimal places.'
  if (cents(amount) > cents(remainder)) return `At most ${moneyIn(m, remainder)} is left to refund on this payment.`
  return null
}

/** The tuition part of a refund: tuition is given back first, the card fee after it (the fee is
 *  not tuition). `before` is what was refunded on this capture already, `tuition` the entry's A. */
export function tuitionPart(amount: number, before: number, tuition: number): number {
  return cents(Math.min(before + amount, tuition) - Math.min(before, tuition))
}

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** Book a COMPLETED refund's money going out, once: the refund row carries the cash transaction it wrote. Runs inside
 *  the caller's transaction, so a PayPal notice writes its booking and its notice row together. */
export async function bookRefund(tx: Tx, tenantId: string, refundRowId: string): Promise<void> {
  {
    const [r] = await tx.select().from(paypalRefunds).where(eq(paypalRefunds.id, refundRowId)).for('update')
    if (!r || r.status !== 'COMPLETED' || r.transactionId || r.paymentKind === 'donation') return
    const amount = Number(r.amount)
    const txn = { id: await bookEntry(tx, {
      id: await birthId(tx, 'ledger_entry', tenantId),
      tenantId,
      bankAccountId: await paypalBankAccountId(tenantId),
      amount: amount.toFixed(2),
      direction: 'out',
      type: r.paymentKind === 'enrollment' ? 'enrollment_payment' : 'event_payment',
      paidAt: await tenantToday(tenantId),
      referenceId: r.refundId,
      notes: `${r.refundKind === 'reversal' ? 'PayPal reversal' : 'PayPal refund'} of capture ${r.captureId}`,
      recordedBy: r.refundedBy,
    }) }
    await tx.update(paypalRefunds).set({ transactionId: txn.id }).where(eq(paypalRefunds.id, r.id))
    if (r.paymentKind !== 'enrollment') return
    const [entry] = await tx.select().from(cashEnrollmentPayments).where(eq(cashEnrollmentPayments.id, r.paymentId))
    const [prior] = await tx.select({ total: sql<string>`coalesce(sum(${paypalRefunds.amount}), 0)` }).from(paypalRefunds)
      .where(and(
        eq(paypalRefunds.tenantId, tenantId), eq(paypalRefunds.captureId, r.captureId), notInArray(paypalRefunds.status, NOT_LIVE),
        sql`${paypalRefunds.createdAt} < ${r.createdAt}`,
      ))
    const part = tuitionPart(amount, Number(prior?.total ?? 0), Number(entry.amount))
    if (part <= 0) return
    await tx.insert(cashEnrollmentPayments).values({
      tenantId,
      enrollmentId: entry.enrollmentId,
      transactionId: txn.id,
      amount: (-part).toFixed(2),
      character: PAYMENT_CHARACTER_TUITION,
      method: 'paypal',
      notes: `${r.refundKind === 'reversal' ? 'PayPal reversal' : 'PayPal refund'} ${r.refundId}`,
      recordedBy: r.refundedBy,
      bankAccountId: entry.bankAccountId,
      paidAt: await tenantToday(tenantId),
      referenceId: r.refundId,
    })
  }
}

export type RefundResult = { refundId: string; status: string; amount: string } | { error: string }

/** Refund `amount` of one payment. `requestId` is the press's own: a retried press answers the same refund. */
export async function refundPayment(tenantId: string, userId: string, kind: RefundKind, id: string, amount: number, requestId: string, actor: Actor): Promise<RefundResult> {
  const payment = await paymentToRefund(tenantId, kind, id)
  if ('error' in payment) return payment
  const refusal = refundAmountRefusal(amount, payment.remainder, moneyRules(await tenantRules(tenantId)))
  if (refusal) return { error: refusal }
  const captureId = payment.captureId as string

  const answer = await refundCapture(tenantId, captureId, amount.toFixed(2), requestId, actor)
  const [row] = await db.insert(paypalRefunds).values({
    tenantId, paymentKind: kind, paymentId: id, captureId, refundId: answer.refundId,
    amount: Number(answer.amount).toFixed(2), status: answer.status, refundedFee: answer.refundedFee, refundedBy: userId,
  // A PayPal notice of this refund may have written the row first, with no one named: the
  // press then names its bursar where the row has none; nothing is counted twice, and booking is once by the row.
  }).onConflictDoUpdate({ target: paypalRefunds.refundId, set: { refundedBy: sql`coalesce(${paypalRefunds.refundedBy}, excluded.refunded_by)` } })
    .returning({ id: paypalRefunds.id })
  if (row) await db.transaction(tx => bookRefund(tx, tenantId, row.id))
  return { refundId: answer.refundId, status: answer.status, amount: answer.amount }
}

/** Refunds PayPal answered PENDING, read again; one that has COMPLETED is booked. Run before the bursar's read. */
export async function settlePendingRefunds(tenantId: string): Promise<void> {
  const pending = await db.select().from(paypalRefunds)
    .where(and(eq(paypalRefunds.tenantId, tenantId), eq(paypalRefunds.status, 'PENDING')))
  for (const r of pending) {
    const now = await readRefund(r.refundId)
    if (!now || now.status === r.status) continue
    await db.update(paypalRefunds).set({ status: now.status, refundedFee: now.refundedFee }).where(eq(paypalRefunds.id, r.id))
    await db.transaction(tx => bookRefund(tx, tenantId, r.id))
  }
}

export type RefundRow = { refundId: string; kind: RefundKind; amount: number; status: string; refundedFee: number | null; when: string }

/** The tenant's refunds, newest first. */
export async function refundsMade(tenantId: string): Promise<RefundRow[]> {
  const rows = await db.select().from(paypalRefunds).where(eq(paypalRefunds.tenantId, tenantId)).orderBy(desc(paypalRefunds.createdAt))
  return rows.map(r => ({
    refundId: r.refundId, kind: r.paymentKind as RefundKind, amount: Number(r.amount), status: r.status,
    refundedFee: r.refundedFee == null ? null : Number(r.refundedFee), when: r.createdAt.toISOString(),
  }))
}
