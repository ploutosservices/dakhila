// A FAMILY PAYS FOR AN EVENT: any amount the family chooses, not tuition or donation, offered until the event's last
// paying day. The event and its last paying day are rows; the money's purpose is the payer's — the press names the
// event.
import { and, desc, eq, gte, isNotNull } from 'drizzle-orm'
import { db } from './db'
import { events, eventPayments } from '../tables'
import { tenantTimezone } from './tenant'
import { birthId } from './registry-id'
import { accountFor } from './ledger'
import { todayOf } from './year-context'
import { tenantRules } from './rules-context'
import { moneyIn, moneyRules } from './fees'
import { EVENT_PAYMENT_MIN, type PayableEvent, type EventPaymentData } from './event-payment-words'
// The constants and shapes live in event-payment-words.ts, store-free; re-exported for this file's importers.
export { EVENT_PAYMENT_MIN, EVENT_PAYMENTS_LATEST, type PayableEvent, type EventPaymentData, type EventPaymentRow } from './event-payment-words'

/** Today in the tenant's own zone, "YYYY-MM-DD" — the day a last paying day is held against. */
export async function tenantToday(tenantId: string): Promise<string> {
  return todayOf(tenantId)
}

/** The events a family may pay for today: those whose last paying day is today or later. */
export async function payableEvents(tenantId: string): Promise<PayableEvent[]> {
  const today = await tenantToday(tenantId)
  const rows = await db.select({ id: events.id, title: events.title, date: events.date, payUntil: events.payUntil })
    .from(events)
    .where(and(eq(events.tenantId, tenantId), isNotNull(events.payUntil), gte(events.payUntil, today)))
    .orderBy(events.date)
  return rows.map(r => ({ ...r, payUntil: r.payUntil as string }))
}

/** Refuses a payment the event does not take, by name; null when it may be made. */
export async function paymentRefusal(tenantId: string, eventId: string, amount: number): Promise<string | null> {
  if (!Number.isFinite(amount) || amount < EVENT_PAYMENT_MIN) return `The smallest payment is ${moneyIn(moneyRules(await tenantRules(tenantId)), EVENT_PAYMENT_MIN)}.`
  if (Math.round(amount * 100) !== amount * 100) return 'An amount has at most two decimal places.'
  const payable = await payableEvents(tenantId)
  if (!payable.some(e => e.id === eventId)) return 'This event no longer takes payments.'
  return null
}

// Starting, stamping and booking a payment are event-payment-writes.ts, which the roster API's PayPal doors carry.

/** The family's pending payment that this order was made for, or null. */
export async function pendingEventPaymentForOrder(tenantId: string, familyId: string, orderId: string) {
  const [row] = await db.select().from(eventPayments).where(and(
    eq(eventPayments.tenantId, tenantId),
    eq(eventPayments.familyId, familyId),
    eq(eventPayments.paypalOrderId, orderId),
    eq(eventPayments.status, 'pending'),
  ))
  return row ?? null
}

/** The tenant's PayPal account in the cash register, where PayPal money in and out is booked; null when it has none. */
export async function paypalBankAccountId(tenantId: string): Promise<string | null> {
  return accountFor(tenantId, 'paypal')
}


/** An event's paid payments, newest first. */
export async function paymentsForEvent(tenantId: string, eventId: string): Promise<EventPaymentData[]> {
  const rows = await db.select().from(eventPayments).where(and(
    eq(eventPayments.tenantId, tenantId), eq(eventPayments.eventId, eventId), eq(eventPayments.status, 'paid'),
  )).orderBy(desc(eventPayments.paidAt))
  const n = (v: string | null) => v == null ? null : Number(v)
  return rows.map(r => ({
    id: r.id, familyId: r.familyId, amount: Number(r.amount), surcharge: n(r.surcharge),
    processingFee: n(r.processingFee), paidAt: r.paidAt ? r.paidAt.toISOString() : null, order: r.paypalOrderId, method: r.method,
  }))
}
