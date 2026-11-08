// THE BURSAR'S BOOKS: the incoming Zelle and PayPal rows, pending donations, open enrollments to match against, what was
// matched lately, and what the ledger has not booked; and the bursar's hand matches. The caller decides who may
// (bursar.write).
import { db } from './db'
import {
  incomingPayments, rosterDonations, familyEnrollments,
  cashEnrollmentPayments,
  rosterFamilies, persons, PAYMENT_CHARACTER_TUITION,
  events, eventPayments,
} from '../tables'
import { tenantTimezone } from './tenant'
import { eq, and, inArray, sql, desc, isNull, isNotNull } from 'drizzle-orm'
import { tenantFamilyRow } from './enrollment-reads'
import { alias } from 'drizzle-orm/pg-core'
import { maybeMarkEnrollmentPaid } from './enrollment-ops'
import { birthId, dropIds } from './registry-id'
import { accountRow, bookEntry, removeEntry, entriesByIds } from './ledger'
import { payableEvents, EVENT_PAYMENT_MIN } from './event-payments'
import { tenantRules } from './rules-context'
import { byCode } from './zoned'
import { moneyIn, moneyRules } from './fees'
import { schoolWord } from './school-words'

/** A Zelle receipt the roster holds that the ledger has not booked — what the booking button will send.
 *  Shown BEFORE the press, because "what is not booked" is a question with an answer at rest and
 *  nobody should have to press a write to ask it. An event's Zelle money is one too. */
export type UnbookedReceiptRow = {
  id: string
  confirmationId: string | null
  paidAt: string | null
  amount: string
  /** What the money is for: the enrollment's family, or the event's title (its caption is the reader's). */
  familyId: string | null
  eventTitle: string | null
  /** tuition, donation, refund … — the row's own word, printed, never re-judged here; empty for an event's row. */
  character: string
}

export async function getUnbookedZelleReceipts(tenantId: string): Promise<UnbookedReceiptRow[]> {
  const [enrollmentRows, eventRows] = await Promise.all([
    db
      .select({
        id: cashEnrollmentPayments.id,
        confirmationId: cashEnrollmentPayments.referenceId,
        paidAt: cashEnrollmentPayments.paidAt,
        amount: cashEnrollmentPayments.amount,
        familyId: familyEnrollments.familyId,
        character: cashEnrollmentPayments.character,
      })
      .from(cashEnrollmentPayments)
      .innerJoin(familyEnrollments, eq(familyEnrollments.id, cashEnrollmentPayments.enrollmentId))
      .where(and(
        eq(cashEnrollmentPayments.tenantId, tenantId),
        eq(cashEnrollmentPayments.method, 'zelle'),
        isNull(cashEnrollmentPayments.ledgerMovementId),
      )),
    unbookedZelleEventPayments(tenantId),
  ])
  const rows: UnbookedReceiptRow[] = [
    ...enrollmentRows.map(r => ({
      id: r.id,
      confirmationId: r.confirmationId,
      paidAt: r.paidAt ? String(r.paidAt).slice(0, 10) : null,
      amount: String(r.amount),
      familyId: r.familyId,
      eventTitle: null,
      character: r.character,
    })),
    ...eventRows.map(r => ({ id: r.id, confirmationId: r.confirmationId, paidAt: r.valueDate, amount: r.amount, familyId: null, eventTitle: r.title, character: '' })),
  ]
  return rows.sort((a, b) => byCode(a.paidAt ?? '', b.paidAt ?? ''))
}

/** An event's Zelle payments the ledger has not booked, dated by their cash transaction's day (the received day). */
export async function unbookedZelleEventPayments(tenantId: string) {
  const paid = await db
    .select({
      id: eventPayments.id,
      confirmationId: eventPayments.referenceId,
      transactionId: eventPayments.transactionId,
      amount: eventPayments.amount,
      title: events.title,
    })
    .from(eventPayments)
    .innerJoin(events, eq(events.id, eventPayments.eventId))
    .where(and(
      eq(eventPayments.tenantId, tenantId),
      eq(eventPayments.method, 'zelle'),
      eq(eventPayments.status, 'paid'),
      isNull(eventPayments.ledgerMovementId),
    ))
  // The value date is the payment's ledger entry's day; a payment with no entry is not listed.
  const dayOf = new Map((await entriesByIds(paid.map(r => r.transactionId).filter((id): id is string => !!id))).map(e => [e.id, e.paidAt]))
  return paid.filter(r => r.transactionId !== null && dayOf.has(r.transactionId))
    .map(({ transactionId, ...r }) => {
      const valueDate = dayOf.get(transactionId!)
      return { ...r, valueDate: valueDate ? String(valueDate).slice(0, 10) : null, amount: String(r.amount) }
    })
}

/** Set an incoming payment aside as ignored. */
export async function ignoreIncomingPayment(tenantId: string, paymentId: string): Promise<void> {
  await db.update(incomingPayments)
    .set({ status: 'ignored' })
    .where(and(eq(incomingPayments.id, paymentId), eq(incomingPayments.tenantId, tenantId)))
}

/** Match an incoming payment to a donation: the payment matched, the donation received. */
export async function matchPaymentToDonation(tenantId: string, paymentId: string, donationId: string): Promise<void> {
  await db.update(incomingPayments)
    .set({ status: 'matched', matchedToType: 'donation', matchedToId: donationId })
    .where(and(eq(incomingPayments.id, paymentId), eq(incomingPayments.tenantId, tenantId)))
  await db.update(rosterDonations)
    .set({ status: 'received', paymentId })
    .where(and(eq(rosterDonations.id, donationId), eq(rosterDonations.tenantId, tenantId)))
}

/**
 * Match an incoming payment to an enrollment by hand: a cash transaction and an enrollment payment (tuition) in one
 * transaction, the incoming row matched, the enrollment marked paid when it now is. Answers the enrollment's family.
 */
export async function matchPaymentToEnrollment(tenantId: string, userId: string, paymentId: string, enrollmentId: string): Promise<{ error: string } | { familyId: string }> {
  const [payment] = await db
    .select()
    .from(incomingPayments)
    .where(and(eq(incomingPayments.id, paymentId), eq(incomingPayments.tenantId, tenantId)))
    .limit(1)
  if (!payment) return { error: 'Payment not found.' }

  const [enrollment] = await db
    .select({ id: familyEnrollments.id, familyId: familyEnrollments.familyId })
    .from(familyEnrollments)
    .where(and(eq(familyEnrollments.id, enrollmentId), eq(familyEnrollments.tenantId, tenantId)))
    .limit(1)
  if (!enrollment) return { error: 'Enrollment not found.' }

  const method = payment.source === 'paypal' ? 'paypal' : 'zelle'
  const account = await accountRow(tenantId, method)

  await db.transaction(async (tx) => {
    const txn = { id: await bookEntry(tx, {
      id: await birthId(tx, 'ledger_entry', tenantId),
      tenantId: tenantId,
      bankAccountId: account?.id ?? null,
      amount: payment.amount,
      direction: 'in',
      type: 'enrollment_payment',
      paidAt: payment.receivedAt,
      referenceId: payment.referenceId ?? null,
      notes: `Manually matched from ${method} sync — ${payment.senderName ?? 'unknown sender'}`,
      recordedBy: userId,
    }) }

    await tx.insert(cashEnrollmentPayments).values({
      tenantId: tenantId,
      enrollmentId,
      transactionId: txn.id,
      amount: payment.amount,
      character: PAYMENT_CHARACTER_TUITION,
      method,
      notes: `Manually matched from ${method} sync — ${payment.senderName ?? 'unknown sender'}`,
      recordedBy: userId,
      bankAccountId: account?.id ?? null,
      // What the source charged, as the source stated it — a '0.00' written here for a
      // paypal payment is a fee we were charged and did not record.
      processingFee: payment.processingFee,
      paidAt: payment.receivedAt,
      referenceId: payment.referenceId ?? null,
    })

    await tx.update(incomingPayments)
      .set({ status: 'matched', matchedToType: 'enrollment', matchedToId: enrollmentId })
      .where(eq(incomingPayments.id, paymentId))
  })

  await maybeMarkEnrollmentPaid(tenantId, enrollmentId)
  return { familyId: enrollment.familyId }
}

/** Delete a donation that is still pending. */
export async function deletePendingDonationRow(tenantId: string, donationId: string): Promise<void> {
  await db.delete(rosterDonations)
    .where(and(
      eq(rosterDonations.id, donationId),
      eq(rosterDonations.tenantId, tenantId),
      eq(rosterDonations.status, 'pending'),
    ))
}

// Most recent received_at across all payments — used as the default sync start date.
export async function getLastPaymentDate(tenantId: string): Promise<string | null> {
  const [row] = await db
    .select({ date: incomingPayments.receivedAt })
    .from(incomingPayments)
    .where(eq(incomingPayments.tenantId, tenantId))
    .orderBy(sql`${incomingPayments.receivedAt} DESC`)
    .limit(1)
  return row?.date ?? null
}

/** The payments waiting on a person: unmatched, and held — a person's Undo of an event match, which the automatic
 *  matchers do not read. */
export async function getUnmatchedPayments(tenantId: string) {
  return db.select().from(incomingPayments)
    .where(and(
      eq(incomingPayments.tenantId, tenantId),
      inArray(incomingPayments.status, WAITING_ON_A_PERSON),
    ))
    .orderBy(incomingPayments.receivedAt)
}

export async function getPendingDonations(tenantId: string) {
  return db.select().from(rosterDonations)
    .where(and(
      eq(rosterDonations.tenantId, tenantId),
      eq(rosterDonations.status, 'pending'),
    ))
    .orderBy(rosterDonations.createdAt)
}

export type EnrollmentOption = {
  id: string
  label: string
}

/** What a recently matched payment was matched to, as data; its caption is the reader's. */
export type RecentPaymentRow = {
  id: string
  senderName: string | null
  amount: string
  receivedAt: string
  matchedToType: string | null
  /** The enrollment family's father's surname (an enrollment match). */
  fatherLast: string | null
  /** The donor (a donation match). */
  donorName: string | null
  /** The event's title (an event match); the family is familyId. */
  eventTitle: string | null
  /** Whether the matched row was found at all. */
  matchedFound: boolean
  familyId: string | null   // set for enrollment and event matches, null for donations
}

export async function getRecentlyMatchedPayments(tenantId: string): Promise<RecentPaymentRow[]> {
  const payments = await db
    .select({
      id: incomingPayments.id,
      senderName: incomingPayments.senderName,
      amount: incomingPayments.amount,
      receivedAt: incomingPayments.receivedAt,
      matchedToType: incomingPayments.matchedToType,
      matchedToId: incomingPayments.matchedToId,
    })
    .from(incomingPayments)
    .where(and(
      eq(incomingPayments.tenantId, tenantId),
      eq(incomingPayments.status, 'matched'),
    ))
    .orderBy(desc(incomingPayments.receivedAt))
    .limit(10)

  // Resolve labels + familyIds for enrollment matches, donor names for donations.
  const enrollmentIds = payments
    .filter(p => p.matchedToType === 'enrollment' && p.matchedToId != null)
    .map(p => p.matchedToId as string)

  const donationIds = payments
    .filter(p => p.matchedToType === 'donation' && p.matchedToId != null)
    .map(p => p.matchedToId as string)

  const eventRowIds = payments
    .filter(p => p.matchedToType === 'event' && p.matchedToId != null)
    .map(p => p.matchedToId as string)

  const found      = new Map<string, { fatherLast?: string | null; donorName?: string; eventTitle?: string }>()
  const familyMap  = new Map<string, string>()  // enrollmentId or event payment id → familyId

  if (enrollmentIds.length > 0) {
    const rows = await db
      .select({
        enrollmentId: familyEnrollments.id,
        familyId: familyEnrollments.familyId,
        fatherLast: persons.lastName,
      })
      .from(familyEnrollments)
      .innerJoin(rosterFamilies, eq(rosterFamilies.id, familyEnrollments.familyId))
      .leftJoin(persons, eq(persons.id, rosterFamilies.fatherId))
      .where(inArray(familyEnrollments.id, enrollmentIds))

    for (const r of rows) {
      found.set(r.enrollmentId, { fatherLast: r.fatherLast })
      familyMap.set(r.enrollmentId, r.familyId)
    }
  }

  if (donationIds.length > 0) {
    const rows = await db
      .select({ id: rosterDonations.id, donorName: rosterDonations.donorName })
      .from(rosterDonations)
      .where(inArray(rosterDonations.id, donationIds))

    for (const r of rows) {
      found.set(r.id, { donorName: r.donorName })
    }
  }

  // An event match is named by the event's title and the family.
  if (eventRowIds.length > 0) {
    const rows = await db
      .select({ id: eventPayments.id, familyId: eventPayments.familyId, title: events.title })
      .from(eventPayments)
      .innerJoin(events, eq(events.id, eventPayments.eventId))
      .where(and(eq(eventPayments.tenantId, tenantId), inArray(eventPayments.id, eventRowIds)))
    for (const r of rows) {
      found.set(r.id, { eventTitle: r.title })
      familyMap.set(r.id, r.familyId)
    }
  }

  return payments
    .map(p => {
      const f = p.matchedToId ? found.get(p.matchedToId) : undefined
      return {
        id: p.id,
        senderName: p.senderName,
        amount: p.amount,
        receivedAt: p.receivedAt,
        matchedToType: p.matchedToType,
        fatherLast: f?.fatherLast ?? null,
        donorName: f?.donorName ?? null,
        eventTitle: f?.eventTitle ?? null,
        matchedFound: !!f,
        familyId: p.matchedToId ? (familyMap.get(p.matchedToId) ?? null) : null,
      }
    })
}

/** An open enrollment as data: its year and its parents' surnames. The option's label is the reader's. */
export type EnrollmentForMatching = { id: string; year: number; fatherLast: string | null; motherLast: string | null }

export async function getEnrollmentsForMatching(tenantId: string): Promise<EnrollmentForMatching[]> {
  // The family's name is the family's to give: the father's surname, the mother's when there is
  // no father. familySurname() is the one rule, shared with the placement
  // sync, so a family cannot read "?" on one screen and by name on another — applied by the reader.
  const mother = alias(persons, 'mother')
  const rows = await db
    .select({
      id: familyEnrollments.id,
      year: familyEnrollments.year,
      fatherLast: persons.lastName,
      motherLast: mother.lastName,
    })
    .from(familyEnrollments)
    .innerJoin(rosterFamilies, eq(rosterFamilies.id, familyEnrollments.familyId))
    .leftJoin(persons, eq(persons.id, rosterFamilies.fatherId))
    .leftJoin(mother, eq(mother.id, rosterFamilies.motherId))
    .where(and(
      eq(familyEnrollments.tenantId, tenantId),
      // Enrolled families too: a second payment arrives after the first set the status — a child added later, a
      // balance still owed — and must still find its enrollment.
      inArray(familyEnrollments.status, ['pending', 'enrolled']),
    ))
    .orderBy(familyEnrollments.year, persons.lastName)

  return rows
}

// ── A PAYMENT MATCHED TO AN EVENT BY A PERSON ────────────────────────────────────────
// An event's payment that did not come through the family's card is matched here, on the payer's word through the bursar.
// Nothing matches an event on its own: the automatic matchers (zelle.ts, paypal.ts) read `unmatched` rows only and
// book only what expects money from a family, and an event expects no amount.

/** The incoming payment statuses a person may still match: unmatched, and held (a person's Undo). */
export const WAITING_ON_A_PERSON = ['unmatched', 'held']

/** Every event of the tenant with a last paying day, newest date first, past ones included (a payment can arrive after
 *  the day). */
export async function getEventsForMatching(tenantId: string): Promise<{ id: string; title: string; date: string }[]> {
  return db.select({ id: events.id, title: events.title, date: events.date })
    .from(events)
    .where(and(eq(events.tenantId, tenantId), isNotNull(events.payUntil)))
    .orderBy(desc(events.date))
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
type Incoming = typeof incomingPayments.$inferSelect

/** Refuses an event or a family that is not this tenant's, or an event with no last paying day; null when both may be
 *  booked to. */
async function eventAndFamilyRefusal(tenantId: string, eventId: string, familyId: string): Promise<string | null> {
  const [event] = await db.select({ payUntil: events.payUntil }).from(events)
    .where(and(eq(events.id, eventId), eq(events.tenantId, tenantId))).limit(1)
  if (!event) return 'Event not found.'
  if (!event.payUntil) return 'This event takes no money: it has no last paying day.'
  if (!(await tenantFamilyRow(tenantId, familyId))) return 'Family not found.'
  return null
}

/** The two writes every event payment that did not come through the card makes, inside `tx`: the cash transaction in
 *  (on the tenant's account for `method`) and the paid event row. Shared by a bursar's match and a Zelle
 *  recorded on the family's card, so the two cannot drift apart. Answers the row's id. */
async function bookEventMoney(tx: Tx, tenantId: string, userId: string, v: {
  eventId: string; familyId: string; amount: string; method: 'paypal' | 'zelle'; receivedOn: string; receivedAtUtc: Date | null
  referenceId: string | null; fee: string | null; notes: string; ledgerMovementId: number | null
}): Promise<string> {
  const account = await accountRow(tenantId, v.method)
  const tenant = { tz: (await tenantTimezone(tenantId)) ?? undefined }
  const txn = { id: await bookEntry(tx, {
    id: await birthId(tx, 'ledger_entry', tenantId),
    tenantId,
    bankAccountId: account?.id ?? null,
    amount: v.amount,
    direction: 'in',
    type: 'event_payment',
    paidAt: v.receivedOn,
    referenceId: v.referenceId,
    notes: v.notes,
    recordedBy: userId,
  }) }
  const [row] = await tx.insert(eventPayments).values({
    tenantId, eventId: v.eventId, familyId: v.familyId, userId,
    amount: v.amount,
    // The source's fee as stated; no surcharge, no PayPal order, no capture id — so the refund list
    // (paypal-refunds.ts) never offers it as money captured through the checkout.
    processingFee: v.fee,
    transactionId: txn.id,
    status: 'paid',
    // The moment it arrived; a Zelle row knows only its day, read as that day's start in the tenant's zone.
    paidAt: v.receivedAtUtc ?? sql`(${v.receivedOn}::date)::timestamp at time zone ${tenant.tz}`,
    method: v.method,
    referenceId: v.referenceId,
    ledgerMovementId: v.ledgerMovementId,
  }).returning({ id: eventPayments.id })
  return row.id
}

/** Book an incoming payment to an event and a family inside `tx`: the cash transaction (the received day), the paid
 *  event row, and the incoming row matched — the last `where` the status is still `from`, so a second press books
 *  nothing (the caller's transaction rolls back when this answers false). */
async function bookIncomingToEvent(
  tx: Tx, tenantId: string, userId: string, payment: Incoming, eventId: string, familyId: string,
  from: { status: string[]; type: string | null }, ledgerMovementId: number | null,
): Promise<boolean> {
  const method = payment.source === 'paypal' ? 'paypal' : 'zelle'
  const rowId = await bookEventMoney(tx, tenantId, userId, {
    eventId, familyId, amount: payment.amount, method, receivedOn: payment.receivedAt, receivedAtUtc: payment.receivedAtUtc ?? null,
    referenceId: payment.referenceId ?? null, fee: payment.processingFee,
    notes: `Matched to an event by hand from ${method} — ${payment.senderName ?? 'unknown sender'}`, ledgerMovementId,
  })
  const touched = await tx.update(incomingPayments)
    .set({ status: 'matched', matchedToType: 'event', matchedToId: rowId })
    .where(and(
      eq(incomingPayments.id, payment.id),
      eq(incomingPayments.tenantId, tenantId),
      inArray(incomingPayments.status, from.status),
      from.type == null ? isNull(incomingPayments.matchedToType) : eq(incomingPayments.matchedToType, from.type),
    ))
    .returning({ id: incomingPayments.id })
  return touched.length === 1
}

/** A Zelle a family sent for an event, recorded on the family's own card by a bursar.write holder.
 *  The family is the caller's, read from the session by the caller; the event must still take payments; a Zelle ID an
 *  event or enrollment payment of the tenant already holds is refused by name. Fee 0.00: Zelle charges none. */
export async function recordZelleEventPayment(
  tenantId: string, userId: string, familyId: string, eventId: string, amount: number, receivedOn: string, referenceId: string, notes: string | null,
): Promise<{ error: string } | { id: string }> {
  if (!Number.isFinite(amount) || amount < EVENT_PAYMENT_MIN) return { error: `The smallest payment is ${moneyIn(moneyRules(await tenantRules(tenantId)), EVENT_PAYMENT_MIN)}.` }
  if (Math.round(amount * 100) !== amount * 100) return { error: 'An amount has at most two decimal places.' }
  const ref = referenceId.trim()
  if (!ref) return { error: 'Zelle ID is required.' }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(receivedOn)) return { error: 'Enter the day the Zelle was sent.' }
  if (!(await payableEvents(tenantId)).some(e => e.id === eventId)) return { error: 'This event no longer takes payments.' }
  const refusal = await eventAndFamilyRefusal(tenantId, eventId, familyId)
  if (refusal) return { error: refusal }
  const [heldByEvent] = await db.select({ id: eventPayments.id }).from(eventPayments)
    .where(and(eq(eventPayments.tenantId, tenantId), eq(eventPayments.referenceId, ref))).limit(1)
  const [heldByEnrollment] = await db.select({ id: cashEnrollmentPayments.id }).from(cashEnrollmentPayments)
    .where(and(eq(cashEnrollmentPayments.tenantId, tenantId), eq(cashEnrollmentPayments.referenceId, ref))).limit(1)
  if (heldByEvent || heldByEnrollment) return { error: `Zelle ID ${ref} is already recorded ${heldByEvent ? 'for an event' : 'for an enrollment'}; nothing was booked.` }
  const recordedOn = await schoolWord(tenantId, 'family-record-place')
  const id = await db.transaction(tx => bookEventMoney(tx, tenantId, userId, {
    eventId, familyId, amount: amount.toFixed(2), method: 'zelle', receivedOn, receivedAtUtc: null,
    referenceId: ref, fee: '0.00', notes: notes?.trim() || `Zelle recorded on ${recordedOn}`, ledgerMovementId: null,
  }))
  return { id }
}

/** A cash transaction goes, then its record id — which the database refuses if anything else still names it
 *  (family-enrollment-writes.ts deleteManualEnrollmentPayment, the same order). */
async function deleteCashTransaction(tx: Tx, tenantId: string, transactionId: string) {
  await removeEntry(tx, transactionId, tenantId)
  await dropIds(tx, [transactionId], tenantId)
}

class Refused extends Error {}

/** Match an unmatched (or held) incoming payment to an event and a family, chosen by a person. */
export async function matchPaymentToEvent(tenantId: string, userId: string, paymentId: string, eventId: string, familyId: string): Promise<{ error: string } | { eventId: string }> {
  const [payment] = await db.select().from(incomingPayments)
    .where(and(eq(incomingPayments.id, paymentId), eq(incomingPayments.tenantId, tenantId))).limit(1)
  if (!payment) return { error: 'Payment not found.' }
  if (!WAITING_ON_A_PERSON.includes(payment.status)) return { error: `This payment is ${payment.status}, no longer waiting to be matched.` }
  const refusal = await eventAndFamilyRefusal(tenantId, eventId, familyId)
  if (refusal) return { error: refusal }
  try {
    await db.transaction(async tx => {
      if (!(await bookIncomingToEvent(tx, tenantId, userId, payment, eventId, familyId, { status: WAITING_ON_A_PERSON, type: null }, null))) {
        throw new Refused('This payment was matched meanwhile; nothing was booked.')
      }
    })
  } catch (e) {
    if (e instanceof Refused) return { error: e.message }
    throw e
  }
  return { eventId }
}

/** "Move to event": a payment booked as tuition is moved by a person — that enrollment payment undone and the event
 *  booked, in one transaction. The enrollment payment is the one the match wrote: its enrollment and the
 *  source's reference. The ledger's movement, if it booked one, moves with it: the ledger holds the confirmation, day and
 *  amount, not what the money was for. */
export async function movePaymentToEvent(tenantId: string, userId: string, paymentId: string, eventId: string, familyId: string): Promise<{ error: string } | { eventId: string; enrollmentFamilyId: string }> {
  const [payment] = await db.select().from(incomingPayments)
    .where(and(eq(incomingPayments.id, paymentId), eq(incomingPayments.tenantId, tenantId))).limit(1)
  if (!payment) return { error: 'Payment not found.' }
  if (payment.status !== 'matched' || payment.matchedToType !== 'enrollment' || !payment.matchedToId) return { error: 'Only a payment matched to an enrollment moves to an event.' }
  if (!payment.referenceId) return { error: `This payment carries no reference, so its enrollment payment cannot be told from another; undo it on the family's ${await schoolWord(tenantId, 'enrollment-page')}.` }
  const refusal = await eventAndFamilyRefusal(tenantId, eventId, familyId)
  if (refusal) return { error: refusal }
  const booked = await db.select({ id: cashEnrollmentPayments.id, transactionId: cashEnrollmentPayments.transactionId, ledgerMovementId: cashEnrollmentPayments.ledgerMovementId, paypalOrderId: cashEnrollmentPayments.paypalOrderId, familyId: familyEnrollments.familyId })
    .from(cashEnrollmentPayments)
    .innerJoin(familyEnrollments, eq(familyEnrollments.id, cashEnrollmentPayments.enrollmentId))
    .where(and(
      eq(cashEnrollmentPayments.tenantId, tenantId),
      eq(cashEnrollmentPayments.enrollmentId, payment.matchedToId),
      eq(cashEnrollmentPayments.referenceId, payment.referenceId),
    ))
  if (booked.length !== 1) return { error: `The enrollment holds ${booked.length} payments with this reference; nothing was moved.` }
  const ep = booked[0]
  if (ep.paypalOrderId) return { error: `This enrollment payment was captured at the ${await schoolWord(tenantId, 'enrollment-page')}, not matched; nothing was moved.` }
  try {
    await db.transaction(async tx => {
      await tx.delete(cashEnrollmentPayments).where(eq(cashEnrollmentPayments.id, ep.id))
      if (ep.transactionId) await deleteCashTransaction(tx, tenantId, ep.transactionId)
      if (!(await bookIncomingToEvent(tx, tenantId, userId, payment, eventId, familyId, { status: ['matched'], type: 'enrollment' }, ep.ledgerMovementId))) {
        throw new Refused('This payment was changed meanwhile; nothing was moved.')
      }
    })
  } catch (e) {
    if (e instanceof Refused) return { error: e.message }
    throw e
  }
  return { eventId, enrollmentFamilyId: ep.familyId }
}

export type EventMatch = {
  eventPaymentId: string
  receivedAt: string
  source: string
  senderName: string | null
  amount: string
  eventId: string
  event: string
  familyId: string
  /** Set once the ledger booked it: the Undo is then refused. */
  ledgerMovementId: number | null
}

/** Every payment a person matched to an event, all of them. */
export async function getEventMatches(tenantId: string): Promise<EventMatch[]> {
  const rows = await db
    .select({
      eventPaymentId: eventPayments.id,
      receivedAt: incomingPayments.receivedAt,
      source: incomingPayments.source,
      senderName: incomingPayments.senderName,
      amount: incomingPayments.amount,
      eventId: events.id,
      event: events.title,
      familyId: eventPayments.familyId,
      ledgerMovementId: eventPayments.ledgerMovementId,
    })
    .from(incomingPayments)
    .innerJoin(eventPayments, eq(eventPayments.id, incomingPayments.matchedToId))
    .innerJoin(events, eq(events.id, eventPayments.eventId))
    .where(and(
      eq(incomingPayments.tenantId, tenantId),
      eq(incomingPayments.status, 'matched'),
      eq(incomingPayments.matchedToType, 'event'),
    ))
    .orderBy(desc(incomingPayments.receivedAt))
  return rows.map(r => ({ ...r, amount: String(r.amount) }))
}

/** Undo a person's event match: the event row and its cash transaction go, and the incoming payment is put back as
 *  `held` — listed with the unmatched ones, never read by the automatic matchers, so nothing books it again.
 *  Refused once the ledger holds it. */
export async function undoEventMatch(tenantId: string, eventPaymentId: string): Promise<{ error: string } | { eventId: string }> {
  const [row] = await db.select().from(eventPayments)
    .where(and(eq(eventPayments.id, eventPaymentId), eq(eventPayments.tenantId, tenantId))).limit(1)
  if (!row) return { error: 'Event payment not found.' }
  if (row.paypalOrderId) return { error: 'This payment was made at the family\'s card, not matched here; it cannot be undone here.' }
  if (row.ledgerMovementId != null) return { error: `the ledger has booked this payment (movement ${row.ledgerMovementId}); it cannot be undone here.` }
  try {
    await db.transaction(async tx => {
      const put = await tx.update(incomingPayments)
        .set({ status: 'held', matchedToType: null, matchedToId: null })
        .where(and(
          eq(incomingPayments.tenantId, tenantId),
          eq(incomingPayments.status, 'matched'),
          eq(incomingPayments.matchedToType, 'event'),
          eq(incomingPayments.matchedToId, row.id),
        ))
        .returning({ id: incomingPayments.id })
      if (put.length !== 1) throw new Refused('No matched payment names this event payment; nothing was undone.')
      await tx.delete(eventPayments).where(eq(eventPayments.id, row.id))
      if (row.transactionId) await deleteCashTransaction(tx, tenantId, row.transactionId)
    })
  } catch (e) {
    if (e instanceof Refused) return { error: e.message }
    throw e
  }
  return { eventId: row.eventId }
}
