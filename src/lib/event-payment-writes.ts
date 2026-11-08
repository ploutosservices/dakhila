// AN EVENT PAYMENT, WRITTEN, apart from the reads (event-payments.ts); the roster API's PayPal doors carry these
// (paypal-doors.ts).
import { eq } from 'drizzle-orm'
import { db } from './db'
import { now } from './host'
import { eventPayments } from '../tables'
import { birthId } from './registry-id'
import { bookEntry } from './ledger'
import { paymentRefusal, paypalBankAccountId, tenantToday } from './event-payments'

/** Start a payment: a pending row for the family, the event and the amount. Answers its id, or why not. */
export async function startEventPayment(tenantId: string, eventId: string, familyId: string, userId: string, amount: number): Promise<{ id: string } | { error: string }> {
  const refusal = await paymentRefusal(tenantId, eventId, amount)
  if (refusal) return { error: refusal }
  const [row] = await db.insert(eventPayments)
    .values({ tenantId, eventId, familyId, userId, amount: amount.toFixed(2) })
    .returning({ id: eventPayments.id })
  return { id: row.id }
}

/** Stamp the PayPal order made for this payment; capture honours no other (the pairing of). */
export async function stampEventPaymentOrder(id: string, orderId: string): Promise<void> {
  await db.update(eventPayments).set({ paypalOrderId: orderId }).where(eq(eventPayments.id, id))
}

/** Book a captured payment: the money that arrived as a cash transaction, the row paid. */
export async function bookEventPayment(tenantId: string, id: string, userId: string, c: { charged: string; surcharge: number | null; processingFee: string | null; captureId: string }): Promise<void> {
  const bankAccountId = await paypalBankAccountId(tenantId)
  const today = await tenantToday(tenantId)
  await db.transaction(async tx => {
    const txn = { id: await bookEntry(tx, {
      id: await birthId(tx, 'ledger_entry', tenantId),
      tenantId,
      bankAccountId,
      amount: c.charged,
      direction: 'in',
      type: 'event_payment',
      paidAt: today,
      // The CAPTURE id: only the capture appears in PayPal's reporting API.
      referenceId: c.captureId,
      recordedBy: userId,
    }) }
    await tx.update(eventPayments).set({
      status: 'paid', paidAt: now(), transactionId: txn.id, captureId: c.captureId,
      surcharge: c.surcharge != null ? c.surcharge.toFixed(2) : null, processingFee: c.processingFee,
    }).where(eq(eventPayments.id, id))
  })
}
