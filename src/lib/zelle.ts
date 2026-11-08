// Zelle payment pipeline — the school's bank deposits (the host's deposits port) matched to obligations and booked.

import type { Actor } from './outward-act'
import type { Deposit } from '../ports'
import { db } from './db'
import { now } from './host'
import {
  incomingPayments, rosterDonations, familyEnrollments, cashEnrollmentPayments,
  rosterFamilies, persons, PAYMENT_CHARACTER_TUITION,
  eventPayments,
} from '../tables'
import { eq, and, isNull, inArray, sql } from 'drizzle-orm'
import { sendEmail } from './mail'
import { platformEmail } from './email-template'
import { catalogValue } from './message-catalog'
import { getTenantBySlug } from './tenant'
import { owedAndPaid } from './tuition-owed-store'
import { maybeMarkEnrollmentPaid } from './enrollment-ops'
import { birthId } from './registry-id'
import { accountRow, bookEntry } from './ledger'
import { roleMailbox } from './role-mailbox'
import { ports } from '../ports'
import { donationReceipt } from './donation-receipt'
import { nameTokens } from './name-tokens'
import { startOfDayIn } from './zoned'
import { yearRules } from './year-context'

/** The school's bank deposits since a day, through the host's deposits port: how they are read is the host's. */
export function readZelleDeposits(tenantId: string, sinceDate: string): Promise<Deposit[]> {
  return ports().deposits.since(tenantId, sinceDate)
}

export async function importZelleDeposits(tenantId: string, deposits: Deposit[]): Promise<number> {
  let imported = 0
  for (const d of deposits) {
    const existing = await db
      .select({ id: incomingPayments.id, receivedAtUtc: incomingPayments.receivedAtUtc })
      .from(incomingPayments)
      .where(and(
        eq(incomingPayments.tenantId, tenantId),
        eq(incomingPayments.referenceId, d.reference),
      ))
      .limit(1)

    if (existing.length > 0) {
      // A row with no instant takes the deposit's
      if (!existing[0].receivedAtUtc) {
        await db.update(incomingPayments)
          .set({ receivedAtUtc: d.receivedAt })
          .where(eq(incomingPayments.id, existing[0].id))
      }
      continue
    }

    await db.transaction(async tx => tx.insert(incomingPayments).values({
      id: await birthId(tx, 'incoming_payment', tenantId),
      tenantId,
      source: 'zelle',
      amount: d.amount,
      senderName: d.payer,
      referenceId: d.reference,
      receivedAt: d.day,
      receivedAtUtc: d.receivedAt,
      status: 'unmatched',
    }))
    imported++
  }
  return imported
}

// One hour in milliseconds — used only for donation candidate window
const ONE_HOUR_MS = 60 * 60 * 1000

export async function matchZellePayments(tenantId: string, actor: Actor): Promise<{ matched: number; unmatched: number }> {
  const unmatchedPayments = await db
    .select()
    .from(incomingPayments)
    .where(and(
      eq(incomingPayments.tenantId, tenantId),
      eq(incomingPayments.source, 'zelle'),
      eq(incomingPayments.status, 'unmatched'),
    ))

  let matched = 0

  for (const payment of unmatchedPayments) {
    // Step 1: match by reference ID against already-booked enrollment payments
    if (payment.referenceId) {
      const existing = await db
        .select({ enrollmentId: familyEnrollments.id })
        .from(cashEnrollmentPayments)
        .innerJoin(familyEnrollments, eq(familyEnrollments.id, cashEnrollmentPayments.enrollmentId))
        .where(and(
          eq(cashEnrollmentPayments.tenantId, tenantId),
          eq(cashEnrollmentPayments.referenceId, payment.referenceId),
        ))
        .limit(1)

      if (existing.length > 0) {
        await db.update(incomingPayments)
          .set({ status: 'matched', matchedToType: 'enrollment', matchedToId: existing[0].enrollmentId })
          .where(eq(incomingPayments.id, payment.id))
        matched++
        continue
      }

      // A Zelle recorded for an event on the family's card: its receipt is that row's,
      // booked already — matched to it, nothing booked again.
      const [eventRow] = await db.select({ id: eventPayments.id }).from(eventPayments)
        .where(and(
          eq(eventPayments.tenantId, tenantId), eq(eventPayments.method, 'zelle'),
          eq(eventPayments.referenceId, payment.referenceId),
        ))
        .limit(1)
      if (eventRow) {
        await db.update(incomingPayments)
          .set({ status: 'matched', matchedToType: 'event', matchedToId: eventRow.id })
          .where(eq(incomingPayments.id, payment.id))
        matched++
        continue
      }
    }

    // With no instant, the day the deposit names starts in the school's zone, not at UTC midnight.
    const [ry, rm, rd] = String(payment.receivedAt).slice(0, 10).split('-').map(Number)
    const paymentTime = payment.receivedAtUtc ?? startOfDayIn(ry, { month: rm, day: rd }, (await yearRules(tenantId)).timezone)
    const windowStart = new Date(paymentTime.getTime() - ONE_HOUR_MS)
    const windowEnd   = new Date(paymentTime.getTime() + ONE_HOUR_MS)

    type Candidate = { type: 'donation'; id: string; name: string } | { type: 'enrollment'; id: string; name: string }
    const candidates: Candidate[] = []

    // Pending donations created within ±1 hour of payment (one-shot payments, window is appropriate)
    const donations = await db
      .select()
      .from(rosterDonations)
      .where(and(
        eq(rosterDonations.tenantId, tenantId),
        eq(rosterDonations.status, 'pending'),
        isNull(rosterDonations.paymentId),
        sql`${rosterDonations.createdAt} >= ${windowStart.toISOString()}`,
        sql`${rosterDonations.createdAt} <= ${windowEnd.toISOString()}`,
      ))

    for (const d of donations) {
      candidates.push({ type: 'donation', id: d.id, name: d.donorName })
    }

    // All non-cancelled enrollments with an outstanding balance — no time window because
    // installment payments arrive days or weeks after the enrollment was created.
    const enrollmentRows = await db
      .select({
        id:        familyEnrollments.id,
        familyId:  familyEnrollments.familyId,
        fatherId:  rosterFamilies.fatherId,
        motherId:  rosterFamilies.motherId,
        createdAt: familyEnrollments.createdAt,
      })
      .from(familyEnrollments)
      .innerJoin(rosterFamilies, eq(rosterFamilies.id, familyEnrollments.familyId))
      .where(and(
        eq(familyEnrollments.tenantId, tenantId),
        sql`${familyEnrollments.status} != 'cancelled'`,
      ))

    // What each owes and has paid is the one rule (tuition-owed-store.ts).
    const owing = await owedAndPaid(enrollmentRows.map(e => e.id))
    for (const e of enrollmentRows) {
      const money = owing.get(e.id)
      if (!money || money.owed <= 0 || money.paid >= money.owed) continue

      const parentIds = [e.fatherId, e.motherId].filter(Boolean) as string[]
      const parentRows = await db
        .select({ firstName: persons.firstName, lastName: persons.lastName })
        .from(persons)
        .where(inArray(persons.id, parentIds))

      const familyName = parentRows.map(p => `${p.firstName ?? ''} ${p.lastName ?? ''}`).join(' ')
      candidates.push({ type: 'enrollment', id: e.id, name: familyName })
    }

    if (candidates.length === 0) continue

    // Step 3: token-based matching — always require a unique name match
    const senderTokens = payment.senderName ? nameTokens(payment.senderName) : []
    if (senderTokens.length === 0) continue

    let match: Candidate | null = null

    // Find a candidate uniquely identified by any single sender token
    for (const token of senderTokens) {
      const hits = candidates.filter(c => nameTokens(c.name).includes(token))
      if (hits.length === 1) {
        match = hits[0]
        break
      }
    }

    if (!match) continue

    if (match.type === 'enrollment') {
      // Create the payment record — same as a manual Zelle match
      const zelleAccount = await accountRow(tenantId, 'zelle')

      await db.transaction(async (tx) => {
        const txn = { id: await bookEntry(tx, {
          id: await birthId(tx, 'ledger_entry', tenantId),
          tenantId,
          bankAccountId: zelleAccount?.id ?? null,
          amount: payment.amount,
          direction: 'in',
          type: 'enrollment_payment',
          paidAt: payment.receivedAt,
          referenceId: payment.referenceId ?? null,
          notes: `Auto-matched from Zelle sync — ${payment.senderName ?? 'unknown sender'}`,
        }) }

        await tx.insert(cashEnrollmentPayments).values({
          tenantId,
          enrollmentId: match!.id,
          transactionId: txn.id,
          amount: payment.amount,
          character: PAYMENT_CHARACTER_TUITION,
          method: 'zelle',
          notes: `Auto-matched from Zelle sync — ${payment.senderName ?? 'unknown sender'}`,
          bankAccountId: zelleAccount?.id ?? null,
          processingFee: '0.00',
          paidAt: payment.receivedAt,
          referenceId: payment.referenceId ?? null,
        })

        await tx.update(incomingPayments)
          .set({ status: 'matched', matchedToType: 'enrollment', matchedToId: match!.id })
          .where(eq(incomingPayments.id, payment.id))
      })

      await maybeMarkEnrollmentPaid(tenantId, match.id)

    } else {
      await db.update(incomingPayments)
        .set({ status: 'matched', matchedToType: 'donation', matchedToId: match.id })
        .where(eq(incomingPayments.id, payment.id))
      await db.update(rosterDonations)
        .set({ status: 'received', paymentId: payment.id })
        .where(eq(rosterDonations.id, match.id))
      await sendDonationReceipt(tenantId, match.id, payment, actor)
    }

    matched++
  }

  return { matched, unmatched: unmatchedPayments.length - matched }
}

export type ZelleCheckResult =
  | { status: 'found';           amount: string; date: string }
  | { status: 'already_recorded'; amount: string; date: string }
  | { status: 'not_found' }

// Participant-triggered check: search the deposits since enrollment date for a payment
// matching the provided sender name, then book it against the enrollment.
export async function checkZelleForFamily(
  tenantId: string,
  enrollmentId: string,
  sinceDate: string,   // ISO date — enrollment created_at date
  searchName: string,  // name the participant says their bank sends as
): Promise<ZelleCheckResult> {
  const deposits = await readZelleDeposits(tenantId, sinceDate)
  const searchTokens = nameTokens(searchName)
  if (searchTokens.length === 0) return { status: 'not_found' }

  // THE FIRST DEPOSIT NOT YET BOOKED to this enrollment, not the first by name: a family's second payment (a child added,
  // a balance owed) was answered "already recorded" with the first one's amount and never booked.
  const byName = deposits.filter(d =>
    searchTokens.some(t => nameTokens(d.payer).includes(t)) &&
    nameTokens(d.payer).some(t => searchTokens.includes(t))
  )
  if (byName.length === 0) return { status: 'not_found' }

  const recorded = await db
    .select({ referenceId: cashEnrollmentPayments.referenceId, amount: cashEnrollmentPayments.amount, paidAt: cashEnrollmentPayments.paidAt })
    .from(cashEnrollmentPayments)
    .where(eq(cashEnrollmentPayments.enrollmentId, enrollmentId))
  const match = byName.find(d => !recorded.some(r => r.referenceId === d.reference))
  if (!match) {
    const last = recorded.find(r => r.referenceId === byName[byName.length - 1].reference)
    return { status: 'already_recorded', amount: String(last?.amount ?? byName[byName.length - 1].amount), date: last?.paidAt ?? byName[byName.length - 1].day }
  }

  // Import + book
  await importZelleDeposits(tenantId, [match])

  const [payment] = await db
    .select()
    .from(incomingPayments)
    .where(and(
      eq(incomingPayments.tenantId, tenantId),
      eq(incomingPayments.referenceId, match.reference),
    ))
    .limit(1)

  if (!payment) return { status: 'not_found' }

  const zelleAccount = await accountRow(tenantId, 'zelle')

  await db.transaction(async (tx) => {
    const txn = { id: await bookEntry(tx, {
      id: await birthId(tx, 'ledger_entry', tenantId),
      tenantId,
      bankAccountId: zelleAccount?.id ?? null,
      amount: payment.amount,
      direction: 'in',
      type: 'enrollment_payment',
      paidAt: payment.receivedAt,
      referenceId: payment.referenceId ?? null,
      notes: `Participant-verified Zelle payment — ${payment.senderName ?? searchName}`,
    }) }

    await tx.insert(cashEnrollmentPayments).values({
      tenantId,
      enrollmentId,
      transactionId: txn.id,
      amount: payment.amount,
      character: PAYMENT_CHARACTER_TUITION,
      method: 'zelle',
      notes: `Participant-verified Zelle payment — ${payment.senderName ?? searchName}`,
      bankAccountId: zelleAccount?.id ?? null,
      processingFee: '0.00',
      paidAt: payment.receivedAt,
      referenceId: payment.referenceId ?? null,
    })

    await tx.update(incomingPayments)
      .set({ status: 'matched', matchedToType: 'enrollment', matchedToId: enrollmentId })
      .where(eq(incomingPayments.id, payment.id))
  })

  await maybeMarkEnrollmentPaid(tenantId, enrollmentId)
  return { status: 'found', amount: payment.amount, date: payment.receivedAt }
}


async function sendDonationReceipt(
  tenantId: string,
  donationId: string,
  payment: typeof incomingPayments.$inferSelect, actor: Actor,
) {
  const donations = await db
    .select()
    .from(rosterDonations)
    .where(eq(rosterDonations.id, donationId))
    .limit(1)
  const donation = donations[0]
  if (!donation) return

  const receipt = await donationReceipt(tenantId, {
    donorName: donation.donorName, amount: Number(payment.amount),
    lines: [{ label: 'Date received', value: payment.receivedAt }, { label: 'Reference', value: payment.referenceId ?? 'N/A' }],
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
    // A donation's replies go to the bursar, not to the owner's mailbox.
    replyTo: await roleMailbox(tenantId, 'bursar'),
  }, actor)

  await db.update(rosterDonations)
    .set({ status: 'receipted', receiptSentAt: now() })
    .where(eq(rosterDonations.id, donationId))
}
