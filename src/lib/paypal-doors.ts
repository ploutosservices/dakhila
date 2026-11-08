// THE PAYPAL AND DONATION ORDERS AND CAPTURES: each function takes the tenant, the actor and the store, and answers a
// status and a body. Who may is the caller's: the roster API asks it before calling these.
import { and, eq } from 'drizzle-orm'
import { db } from './db'
import type { Store } from '../store'
import type { Actor } from './outward-act'
import {
  familyEnrollments, cashEnrollmentPayments, PAYMENT_CHARACTER_TUITION,
  rosterDonations, incomingPayments,
} from '../tables'
import { createOrder, captureOrder } from './paypal'
import { orderTotal, settleApprovedOrder } from './paypal-checkout'
import { feeContext } from './fee-context'
import { owedAndPaidOf } from './tuition-owed-store'
import { maybeMarkEnrollmentPaid } from './enrollment-ops'
import { birthId } from './registry-id'
import { accountRow, bookEntry } from './ledger'
import { pendingEventPaymentForOrder } from './event-payments'
import { startEventPayment, stampEventPaymentOrder, bookEventPayment } from './event-payment-writes'
import { sendEmail } from './mail'
import { platformEmail } from './email-template'
import { catalogValue } from './message-catalog'
import { roleMailbox } from './role-mailbox'
import { hostPage, now } from './host'
import { todayOf } from './year-context'
import { donationReceipt } from './donation-receipt'

export type DoorAnswer = { status: number; body: Record<string, unknown> }
const answer = (status: number, body: Record<string, unknown>): DoorAnswer => ({ status, body })

/** The tenant's enrollment's family, or null when the enrollment is not the tenant's — who may pay is asked of it. */
export async function enrollmentFamily(tenantId: string, enrollmentId: string, store: Store = db): Promise<{ familyId: string } | null> {
  const [e] = await store.select({ familyId: familyEnrollments.familyId }).from(familyEnrollments)
    .where(and(eq(familyEnrollments.id, enrollmentId), eq(familyEnrollments.tenantId, tenantId))).limit(1)
  return e ?? null
}

// ── create-order: an order for what the enrollment has left to pay ─────────────────────────────────────────────────
export async function enrollmentOrder(tenantId: string, enrollmentId: string, sheetTotal: unknown, actor: Actor): Promise<DoorAnswer> {
  // What is left to pay: what the enrollment owes (the one rule, tuition-owed-store.ts) less what it has paid.
  const { owed, paid } = await owedAndPaidOf(enrollmentId)
  const net = Math.round((owed - paid) * 100) / 100
  if (net <= 0) return answer(400, { error: 'Nothing is owed' })
  // APPLE PAY: the order is made for the total Apple's sheet showed.
  const t = orderTotal(await feeContext(tenantId), net, sheetTotal, 'enrollment')
  if ('error' in t) return answer(409, { error: t.error })
  const order = await createOrder(tenantId, t.total, actor, net.toFixed(2))
  return answer(200, { orderId: order.id, net })
}

// ── capture-order ─────────────────────────────────────────────────────────────────────────────────────────────────
// THE CREDIT-CARD FEE IS SHOWN BEFORE IT IS CHARGED. An approved
// order paid by a credit card is not captured on the first call: the answer is the fee and the total, and the reader
// shows them and waits for the family's press. The press calls again with the total it showed; only a total equal to
// the one reckoned here is added to the order and captured. Any other card, and every PayPal-wallet payment, is
// captured at the enrollment amount at once.
export async function captureEnrollmentOrder(
  tenantId: string, userId: string, enrollmentId: string, orderId: string, acceptedTotal: unknown, actor: Actor, store: Store = db,
): Promise<DoorAnswer> {
  // The quote, the refusals and the capture are the one checkout (paypal-checkout.ts); this books the rows.
  const settled = await settleApprovedOrder(tenantId, orderId, acceptedTotal, actor)
  if (settled.kind === 'quote') return answer(200, { quote: true, amount: settled.amount, fee: settled.fee, total: settled.total })
  if (settled.kind === 'refused') return answer(409, { error: settled.error })
  const { amount, charged: capturedAmount, processingFee, captureId, surcharge } = settled

  const paypalAccount = await accountRow(tenantId, 'paypal')

  const today = await todayOf(tenantId)
  // Tuition is what the family owed, A (`amount`); the cash transaction is the money that arrived, G.
  await store.transaction(async (tx) => {
    const txn = { id: await bookEntry(tx, {
      id: await birthId(tx, 'ledger_entry', tenantId),
      tenantId,
      bankAccountId: paypalAccount?.id ?? null,
      amount: capturedAmount,
      direction: 'in',
      type: 'enrollment_payment',
      paidAt: today,
      // The CAPTURE id, not the order id: only the capture appears in PayPal's reporting
      // API, so an order id here reconciles against nothing.
      referenceId: captureId,
      recordedBy: userId,
    }) }

    await tx.insert(cashEnrollmentPayments).values({
      tenantId,
      enrollmentId,
      transactionId: txn.id,
      amount,
      surcharge: surcharge != null ? surcharge.toFixed(2) : null,
      character: PAYMENT_CHARACTER_TUITION,
      method: 'paypal',
      paypalOrderId: orderId,
      recordedBy: userId,
      bankAccountId: paypalAccount?.id ?? null,
      processingFee,
      paidAt: today,
      referenceId: captureId,
    })
  })

  await maybeMarkEnrollmentPaid(tenantId, enrollmentId)
  return answer(200, { success: true, amount, charged: capturedAmount, processingFee })
}

// ── event-create-order: a family pays for an event ───────────────────────────────────
// The family is the caller's own. The event must still take payments and the amount be at least the smallest; a
// pending row is written and the order made for it is stamped on it.
export async function eventOrder(tenantId: string, familyId: string, userId: string, eventId: string, amount: number, sheetTotal: unknown, actor: Actor): Promise<DoorAnswer> {
  // APPLE PAY: the order is made for the total Apple's sheet showed.
  const t = orderTotal(await feeContext(tenantId), amount, sheetTotal, 'payment')
  if ('error' in t) return answer(409, { error: t.error })
  const started = await startEventPayment(tenantId, eventId, familyId, userId, amount)
  if ('error' in started) return answer(400, { error: started.error })
  const order = await createOrder(tenantId, t.total, actor, amount.toFixed(2))
  await stampEventPaymentOrder(started.id, order.id)
  return answer(200, { orderId: order.id })
}

// ── event-capture-order ───────────────────────────────────────────────────────────────────────────────────────
// Only the order stamped on the family's own pending payment is honoured. A credit card answers with its quote first;
// the capture is the one checkout's, and the money that arrived is booked here.
export async function captureEventOrder(tenantId: string, familyId: string, userId: string, orderId: string, acceptedTotal: unknown, actor: Actor): Promise<DoorAnswer> {
  const payment = await pendingEventPaymentForOrder(tenantId, familyId, orderId)
  if (!payment) return answer(400, { error: 'This order is not one your family started. Nothing was charged.' })
  const settled = await settleApprovedOrder(tenantId, orderId, acceptedTotal, actor)
  if (settled.kind === 'quote') return answer(200, { quote: true, amount: settled.amount, fee: settled.fee, total: settled.total })
  if (settled.kind === 'refused') return answer(409, { error: settled.error })
  await bookEventPayment(tenantId, payment.id, userId, settled)
  return answer(200, { success: true, amount: settled.amount, charged: settled.charged, processingFee: settled.processingFee })
}

// ── donate: a pending donation record (from any donation form) ─────────────────────────────────────────────────────────
export async function startDonation(tenantId: string, body: Record<string, unknown>, store: Store = db): Promise<DoorAnswer> {
  const { donorName, donorEmail, amountIntended, message } = body as Record<string, string | number | undefined>
  if (typeof donorName !== 'string' || !donorName.trim() || typeof donorEmail !== 'string' || !donorEmail.trim()) {
    return answer(400, { error: 'Name and email are required.' })
  }
  const [donation] = await store.insert(rosterDonations).values({
    tenantId,
    donorName:      donorName.trim(),
    donorEmail:     donorEmail.trim().toLowerCase(),
    amountIntended: amountIntended ? String(amountIntended) : null,
    message:        typeof message === 'string' ? message.trim() || null : null,
    status:         'pending',
  }).returning({ id: rosterDonations.id })
  return answer(200, { ok: true, donationId: donation.id })
}

// ── donate-create-order ───────────────────────────────────────────────────────────────────────────────────────────
export async function donationOrder(tenantId: string, donationId: string, store: Store = db): Promise<DoorAnswer> {
  const [donation] = await store.select().from(rosterDonations).where(eq(rosterDonations.id, donationId)).limit(1)
  if (!donation) return answer(404, { error: 'Donation not found' })
  if (!donation.amountIntended) return answer(400, { error: 'No amount specified' })
  // A PUBLIC DOOR: no signed-in person approves a donation. The act is recorded under the donate page and the donation
  // it answers.
  const order = await createOrder(tenantId, Number(donation.amountIntended).toFixed(2), { page: hostPage('donate'), event: 'donation', caller: `donation ${donationId}` })
  // Stamp the pairing: unwritten, capture would have nothing to check against
  // and would honour any (donationId, orderId) pair the caller sent.
  await store.update(rosterDonations).set({ paypalOrderId: order.id }).where(eq(rosterDonations.id, donationId))
  return answer(200, { orderId: order.id })
}

// ── donate-capture-order ──────────────────────────────────────────────────────────────────────────────────────────
export async function captureDonation(tenantId: string, donationId: string, orderId: string, store: Store = db): Promise<DoorAnswer> {
  const [donation] = await store.select().from(rosterDonations).where(eq(rosterDonations.id, donationId)).limit(1)
  if (!donation) return answer(404, { error: 'Donation not found' })

  // The order must be the one THIS donation created.
  // Both ids are caller-supplied: unpaired, capturing order A
  // while citing donation B would mark B received and mail B's donor a
  // receipt for money B never gave.
  // create-order stamps the pairing; capture refuses any other combination.
  if (donation.paypalOrderId && donation.paypalOrderId !== orderId) return answer(400, { error: 'Order does not belong to this donation' })
  if (!donation.paypalOrderId) return answer(400, { error: 'No order was created for this donation' })
  if (donation.status === 'received') return answer(409, { error: 'Donation already captured' })

  // A PUBLIC DOOR: no signed-in person approves a donation. Both acts — the capture and the receipt — are recorded under
  // the donate page and the PayPal order it answers; a row that cannot be completed after the act is
  // logged, never answered as an error (outward-act.ts).
  const actor: Actor = { page: hostPage('donate'), event: 'donation', caller: `PayPal order ${orderId}` }
  const { capturedAmount, captureId } = await captureOrder(tenantId, orderId, actor)
  const today = await todayOf(tenantId)

  // Record as incoming payment, matched immediately
  const [payment] = await store.transaction(async tx => tx.insert(incomingPayments).values({
    id:            await birthId(tx, 'incoming_payment', tenantId),
    tenantId,
    source:        'paypal',
    amount:        capturedAmount,
    senderName:    donation.donorName,
    senderEmail:   donation.donorEmail,
    referenceId:   orderId,
    receivedAt:    today,
    status:        'matched',
    matchedToType: 'donation',
    matchedToId:   donationId,
  }).returning({ id: incomingPayments.id }))

  await store.update(rosterDonations)
    // The capture id: what a refund is made against.
    .set({ status: 'received', paymentId: payment.id, captureId })
    .where(eq(rosterDonations.id, donationId))

  // Send the receipt
  const receipt = await donationReceipt(tenantId, {
    donorName: donation.donorName, amount: Number(capturedAmount), via: 'PayPal',
    lines: [{ label: 'Date', value: today }, { label: 'PayPal Order', value: orderId }],
  })
  const emailTemplate = platformEmail(receipt.html,
    { contactEmail: await catalogValue(tenantId, 'receipts-contact'), tagline: receipt.legalName }
  )

  await sendEmail(tenantId, {
    to: donation.donorEmail,
    subject: receipt.subject,
    body: receipt.text,
    htmlBody: emailTemplate.html,
    cidLogo: emailTemplate.cidLogo,
    // Its replies go to the bursar role, not to a person's mailbox.
    replyTo: await roleMailbox(tenantId, 'bursar'),
  }, actor)

  await store.update(rosterDonations)
    .set({ status: 'receipted', receiptSentAt: now() })
    .where(eq(rosterDonations.id, donationId))

  return answer(200, { success: true, amount: capturedAmount })
}
