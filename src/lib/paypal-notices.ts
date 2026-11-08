// PAYPAL TELLS THE ROSTER WHAT HAPPENED ON PAYPAL'S OWN SITE. A notice whose
// signature PayPal verified is handled here: the object it names is read from PayPal's API (the notice is a hint, the
// API the fact), and what that read answers is booked — a refund or a reversal as a `paypal_refunds` row booked as the
// Refund button's are, a dispute as a `paypal_disputes` row that moves no money. Every notice is kept once, AFTER it is
// handled, in the same transaction as its booking: a notice that failed leaves no row, and PayPal's resend handles it.
import { and, desc, eq, isNull } from 'drizzle-orm'
import { db } from './db'
import { now } from './host'
import { paypalDisputes, paypalNotices, paypalRefunds, rosterDonations } from '../tables'
import { readCapture, readDispute, readRefundWithCapture } from './paypal'
import { bookRefund, refundablePayments, type RefundablePayment } from './paypal-refunds'

/** The notice types the app is subscribed to. Any other type that verifies is kept as "not read". */
export const NOTICE_TYPES = [
  'PAYMENT.CAPTURE.REFUNDED', 'PAYMENT.CAPTURE.REVERSED',
  'CUSTOMER.DISPUTE.CREATED', 'CUSTOMER.DISPUTE.UPDATED', 'CUSTOMER.DISPUTE.RESOLVED',
] as const

export type Notice = { id: string; event_type: string; resource?: Record<string, unknown> }

export type NoticeResult = { outcome: string; duplicate: boolean }

const ALREADY = 'already handled: a resent notice'

/** The notice body's own fields, refused by name when it is not a PayPal notice. */
export function noticeFrom(body: unknown): Notice | null {
  const b = body as Notice | null
  if (!b || typeof b.id !== 'string' || !b.id || typeof b.event_type !== 'string' || !b.event_type) return null
  return b
}

async function kept(eventId: string): Promise<boolean> {
  const [row] = await db.select({ id: paypalNotices.id }).from(paypalNotices).where(eq(paypalNotices.eventId, eventId))
  return !!row
}

/** Keep the notice row; false when another handling of the same event kept it first (nothing else is then written). */
async function keep(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], tenantId: string, n: Notice, objectId: string | null, outcome: string): Promise<boolean> {
  const [row] = await tx.insert(paypalNotices).values({ tenantId, eventId: n.id, eventType: n.event_type, objectId, outcome })
    .onConflictDoNothing({ target: paypalNotices.eventId }).returning({ id: paypalNotices.id })
  return !!row
}

/** Keep a notice that books nothing. */
async function keepOnly(tenantId: string, n: Notice, objectId: string | null, outcome: string): Promise<NoticeResult> {
  const fresh = await db.transaction(tx => keep(tx, tenantId, n, objectId, outcome))
  return fresh ? { outcome, duplicate: false } : { outcome: ALREADY, duplicate: true }
}

/** The payment captured with this capture id, in this tenant — or a donation taken before its capture id was
 *  stored, found by the capture's order id. Answers the donation's id to store the capture on. */
async function paymentFor(tenantId: string, captureId: string): Promise<{ payment: RefundablePayment; storeOnDonation: string | null } | null> {
  const payments = await refundablePayments(tenantId)
  const held = payments.find(p => p.captureId === captureId)
  if (held) return { payment: held, storeOnDonation: null }
  const capture = await readCapture(captureId)
  if (!capture?.orderId) return null
  const [donation] = await db.select({ id: rosterDonations.id }).from(rosterDonations)
    .where(and(eq(rosterDonations.tenantId, tenantId), eq(rosterDonations.paypalOrderId, capture.orderId), isNull(rosterDonations.captureId)))
  const payment = donation && payments.find(p => p.kind === 'donation' && p.id === donation.id)
  return payment ? { payment: { ...payment, captureId }, storeOnDonation: donation.id } : null
}

/** PAYMENT.CAPTURE.REFUNDED and .REVERSED: both name a refund (measured), read with its capture. */
async function onRefund(tenantId: string, n: Notice, refundId: string, kind: 'refund' | 'reversal'): Promise<NoticeResult> {
  const refund = await readRefundWithCapture(refundId)
  if (!refund) return keepOnly(tenantId, n, refundId, 'PayPal holds no such refund')

  const [existing] = await db.select().from(paypalRefunds)
    .where(and(eq(paypalRefunds.tenantId, tenantId), eq(paypalRefunds.refundId, refund.refundId)))
  if (existing) {
    // A refund pressed here (or one an earlier notice wrote): PayPal's answer is the status; a COMPLETED one not yet
    // booked is booked now — as settlePendingRefunds does before the bursar's read.
    const moved = existing.status !== refund.status
    const outcome = moved ? `refund already recorded; status ${existing.status} → ${refund.status}` : 'refund already recorded'
    const fresh = await db.transaction(async tx => {
      if (!await keep(tx, tenantId, n, refundId, outcome)) return false
      if (moved) await tx.update(paypalRefunds).set({ status: refund.status, refundedFee: refund.refundedFee }).where(eq(paypalRefunds.id, existing.id))
      await bookRefund(tx, tenantId, existing.id)
      return true
    })
    return fresh ? { outcome, duplicate: false } : { outcome: ALREADY, duplicate: true }
  }

  if (!refund.captureId) return keepOnly(tenantId, n, refundId, 'PayPal named no capture for this refund')
  const found = await paymentFor(tenantId, refund.captureId)
  if (!found) return keepOnly(tenantId, n, refundId, 'names no payment captured here')

  const { payment, storeOnDonation } = found
  const outcome = `${kind} of ${refund.amount} ${refund.status} recorded against the ${payment.kind} ${payment.id}`
  const fresh = await db.transaction(async tx => {
    if (!await keep(tx, tenantId, n, refundId, outcome)) return false
    if (storeOnDonation) await tx.update(rosterDonations).set({ captureId: refund.captureId }).where(eq(rosterDonations.id, storeOnDonation))
    const [row] = await tx.insert(paypalRefunds).values({
      tenantId, paymentKind: payment.kind, paymentId: payment.id, captureId: refund.captureId as string, refundId: refund.refundId,
      amount: Number(refund.amount).toFixed(2), status: refund.status, refundedFee: refund.refundedFee, refundedBy: null, refundKind: kind,
    }).returning({ id: paypalRefunds.id })
    await bookRefund(tx, tenantId, row.id)
    return true
  })
  return fresh ? { outcome, duplicate: false } : { outcome: ALREADY, duplicate: true }
}

/** CUSTOMER.DISPUTE.*: the dispute as PayPal's API answers it, one row per dispute id. No money. */
async function onDispute(tenantId: string, n: Notice, disputeId: string): Promise<NoticeResult> {
  const d = await readDispute(disputeId)
  if (!d) return keepOnly(tenantId, n, disputeId, 'PayPal holds no such dispute')
  const fields = {
    transactionId: d.transactionId, reason: d.reason, status: d.status,
    amount: d.amount == null ? null : Number(d.amount).toFixed(2), outcome: d.outcome, lastReadAt: now(),
  }
  const outcome = `dispute ${d.status ?? 'with no status'} recorded`
  const fresh = await db.transaction(async tx => {
    if (!await keep(tx, tenantId, n, disputeId, outcome)) return false
    await tx.insert(paypalDisputes).values({ tenantId, disputeId: d.disputeId, ...fields })
      .onConflictDoUpdate({ target: paypalDisputes.disputeId, set: fields })
    return true
  })
  return fresh ? { outcome, duplicate: false } : { outcome: ALREADY, duplicate: true }
}

/** Handle one verified notice inside the tenant its route named. Throws on a failed PayPal read or store write. */
export async function receiveNotice(tenantId: string, n: Notice): Promise<NoticeResult> {
  if (await kept(n.id)) return { outcome: ALREADY, duplicate: true }
  const r = n.resource ?? {}
  switch (n.event_type) {
    case 'PAYMENT.CAPTURE.REFUNDED':
    case 'PAYMENT.CAPTURE.REVERSED': {
      const id = typeof r.id === 'string' ? r.id : null
      if (!id) return keepOnly(tenantId, n, null, 'the notice names no refund')
      return onRefund(tenantId, n, id, n.event_type === 'PAYMENT.CAPTURE.REVERSED' ? 'reversal' : 'refund')
    }
    case 'CUSTOMER.DISPUTE.CREATED':
    case 'CUSTOMER.DISPUTE.UPDATED':
    case 'CUSTOMER.DISPUTE.RESOLVED': {
      const id = typeof r.dispute_id === 'string' ? r.dispute_id : null
      if (!id) return keepOnly(tenantId, n, null, 'the notice names no dispute')
      return onDispute(tenantId, n, id)
    }
    default:
      return keepOnly(tenantId, n, typeof r.id === 'string' ? r.id : null, 'not read')
  }
}

export type NoticeRow = { eventId: string; eventType: string; objectId: string | null; outcome: string; receivedAt: string }
export type DisputeRow = {
  disputeId: string; transactionId: string | null; reason: string | null; status: string | null; amount: string | null; outcome: string | null; lastReadAt: string
}

/** The tenant's kept notices, newest first, as stored. */
export async function noticesKept(tenantId: string): Promise<NoticeRow[]> {
  const rows = await db.select().from(paypalNotices).where(eq(paypalNotices.tenantId, tenantId)).orderBy(desc(paypalNotices.receivedAt))
  return rows.map(r => ({ eventId: r.eventId, eventType: r.eventType, objectId: r.objectId, outcome: r.outcome, receivedAt: r.receivedAt.toISOString() }))
}

/** The tenant's disputes, newest read first, as stored. */
export async function disputesKept(tenantId: string): Promise<DisputeRow[]> {
  const rows = await db.select().from(paypalDisputes).where(eq(paypalDisputes.tenantId, tenantId)).orderBy(desc(paypalDisputes.lastReadAt))
  return rows.map(r => ({
    disputeId: r.disputeId, transactionId: r.transactionId, reason: r.reason, status: r.status, amount: r.amount,
    outcome: r.outcome, lastReadAt: r.lastReadAt.toISOString(),
  }))
}
