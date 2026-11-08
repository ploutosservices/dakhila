// BOOKING PAYPAL'S MONEY (the roster's): PayPal's transactions kept as incoming payments, matched to an enrollment
// that still owes, booked as the ledger's cash rows, and the fee PayPal charged written back. PayPal itself — its
// orders, captures, refunds, notices and reporting reads — is the host's payments port; this file only books what that
// port reads.
import { db } from './db'
import {
  incomingPayments, familyEnrollments, cashEnrollmentPayments,
  rosterFamilies, persons, PAYMENT_CHARACTER_TUITION,
} from '../tables'
import { eq, and, isNull, inArray, sql } from 'drizzle-orm'
import { owedAndPaid } from './tuition-owed-store'
import { maybeMarkEnrollmentPaid } from './enrollment-ops'
import { birthId } from './registry-id'
import { accountRow, bookEntry, setEntryReference } from './ledger'
import { readOrderCapture, readPaypalTransactions, type PaypalTransaction } from './paypal'
import { nameTokens } from './name-tokens'

export async function importPaypalTransactions(tenantId: string, transactions: PaypalTransaction[]): Promise<number> {
  let imported = 0
  for (const t of transactions) {
    const existing = await db
      .select({ id: incomingPayments.id })
      .from(incomingPayments)
      .where(and(
        eq(incomingPayments.tenantId, tenantId),
        eq(incomingPayments.referenceId, t.transactionId),
      ))
      .limit(1)

    if (existing.length > 0) continue

    await db.transaction(async tx => tx.insert(incomingPayments).values({
      id: await birthId(tx, 'incoming_payment', tenantId),
      tenantId,
      source: 'paypal',
      amount: t.amount,
      processingFee: t.processingFee,
      senderName: t.senderName,
      senderEmail: t.senderEmail,
      referenceId: t.transactionId,
      receivedAt: t.date,
      receivedAtUtc: t.receivedAtUtc,
      status: 'unmatched',
    }))
    imported++
  }
  return imported
}

export async function matchPaypalPayments(tenantId: string): Promise<{ matched: number; unmatched: number }> {
  const unmatchedPayments = await db
    .select()
    .from(incomingPayments)
    .where(and(
      eq(incomingPayments.tenantId, tenantId),
      eq(incomingPayments.source, 'paypal'),
      eq(incomingPayments.status, 'unmatched'),
    ))

  let matched = 0

  for (const payment of unmatchedPayments) {
    let matchedEnrollmentId: string | null = null

    // Step 1: email-based match — look up person by payer email, find their family's enrollment
    if (payment.senderEmail) {
      const [person] = await db
        .select({ familyId: persons.familyId })
        .from(persons)
        .where(and(
          eq(persons.tenantId, tenantId),
          eq(persons.email, payment.senderEmail),
          isNull(persons.deletedAt),
        ))
        .limit(1)

      if (person?.familyId) {
        const enrollmentsOfFamily = await db
          .select({
            id:        familyEnrollments.id,
            createdAt: familyEnrollments.createdAt,
          })
          .from(familyEnrollments)
          .where(and(
            eq(familyEnrollments.tenantId, tenantId),
            eq(familyEnrollments.familyId, person.familyId),
            sql`${familyEnrollments.status} != 'cancelled'`,
          ))

        const owing = await owedAndPaid(enrollmentsOfFamily.map(e => e.id))
        for (const e of enrollmentsOfFamily) {
          const money = owing.get(e.id)
          if (!money || money.owed <= 0 || money.paid >= money.owed) continue

          matchedEnrollmentId = e.id
          break
        }
      }
    }

    // Step 2: name-based match — same token approach as Zelle
    if (!matchedEnrollmentId && payment.senderName) {
      const senderTokens = nameTokens(payment.senderName)

      if (senderTokens.length > 0) {
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

        type Candidate = { id: string; name: string }
        const candidates: Candidate[] = []

        const owing = await owedAndPaid(enrollmentRows.map(e => e.id))
        for (const e of enrollmentRows) {
          const money = owing.get(e.id)
          if (!money || money.owed <= 0 || money.paid >= money.owed) continue

          const parentIds = [e.fatherId, e.motherId].filter(Boolean) as string[]
          const parentNames = parentIds.length > 0
            ? await db
                .select({ firstName: persons.firstName, lastName: persons.lastName })
                .from(persons)
                .where(inArray(persons.id, parentIds))
            : []

          const familyName = parentNames.map(p => `${p.firstName ?? ''} ${p.lastName ?? ''}`).join(' ')
          candidates.push({ id: e.id, name: familyName })
        }

        for (const token of senderTokens) {
          const hits = candidates.filter(c => nameTokens(c.name).includes(token))
          if (hits.length === 1) {
            matchedEnrollmentId = hits[0].id
            break
          }
        }
      }
    }

    if (!matchedEnrollmentId) continue

    // Book the payment against the matched enrollment
    const paypalAccount = await accountRow(tenantId, 'paypal')

    await db.transaction(async (tx) => {
      const txn = { id: await bookEntry(tx, {
        id: await birthId(tx, 'ledger_entry', tenantId),
        tenantId,
        bankAccountId: paypalAccount?.id ?? null,
        amount: payment.amount,
        direction: 'in',
        type: 'enrollment_payment',
        paidAt: payment.receivedAt,
        referenceId: payment.referenceId ?? null,
        notes: `Auto-matched from PayPal sync — ${payment.senderName ?? payment.senderEmail ?? 'unknown'}`,
      }) }

      await tx.insert(cashEnrollmentPayments).values({
        tenantId,
        enrollmentId: matchedEnrollmentId!,
        transactionId: txn.id,
        amount: payment.amount,
        character: PAYMENT_CHARACTER_TUITION,
        method: 'paypal',
        notes: `Auto-matched from PayPal sync — ${payment.senderName ?? payment.senderEmail ?? 'unknown'}`,
        bankAccountId: paypalAccount?.id ?? null,
        processingFee: payment.processingFee,
        paidAt: payment.receivedAt,
        referenceId: payment.referenceId ?? null,
      })

      await tx.update(incomingPayments)
        .set({ status: 'matched', matchedToType: 'enrollment', matchedToId: matchedEnrollmentId! })
        .where(eq(incomingPayments.id, payment.id))
    })

    await maybeMarkEnrollmentPaid(tenantId, matchedEnrollmentId)
    matched++
  }

  return { matched, unmatched: unmatchedPayments.length - matched }
}

// ---------------------------------------------------------------------------
// Reconcile — PayPal is the authority on what it charged us
// ---------------------------------------------------------------------------

export type PaypalReconcileResult = {
  examined: number
  feesFilled: number
  idsFilled: number
  unresolved: Array<{ paymentId: string; paidAt: string | null; amount: string; why: string }>
}

// Ask PayPal what it charged, for every paypal payment whose fee or transaction id is
// missing, and write back what it answers. Repeatable by construction: a row PayPal has
// already answered for is not asked about again, and a row it cannot answer for is
// reported rather than filled with a guess.
//
// Two routes in, because the rows were written by two different paths:
//   paypal_order_id present -> GET /v2/checkout/orders/{id} gives capture id AND fee
//   reference_id present    -> already the transaction id; the reporting API gives the fee
export async function reconcilePaypalFees(tenantId: string): Promise<PaypalReconcileResult> {
  const rows = await db
    .select({
      id:            cashEnrollmentPayments.id,
      amount:        cashEnrollmentPayments.amount,
      paidAt:        cashEnrollmentPayments.paidAt,
      fee:           cashEnrollmentPayments.processingFee,
      orderId:       cashEnrollmentPayments.paypalOrderId,
      referenceId:   cashEnrollmentPayments.referenceId,
      transactionId: cashEnrollmentPayments.transactionId,
    })
    .from(cashEnrollmentPayments)
    .where(and(
      eq(cashEnrollmentPayments.tenantId, tenantId),
      eq(cashEnrollmentPayments.method, 'paypal'),
    ))

  // A fee of exactly 0 on a paypal payment is the defect this reconcile exists for —
  // PayPal charges for every one of them — so it is treated as missing, not as answered.
  const wanted = rows.filter(r => r.fee == null || parseFloat(String(r.fee)) === 0 || !r.referenceId)

  const result: PaypalReconcileResult = { examined: wanted.length, feesFilled: 0, idsFilled: 0, unresolved: [] }
  if (wanted.length === 0) return result

  // One reporting read covers every row reachable by transaction id.
  const earliest = wanted
    .map(r => r.paidAt)
    .filter((d): d is string => !!d)
    .sort()[0]
  const byTransactionId = new Map<string, PaypalTransaction>()
  if (earliest) {
    for (const t of await readPaypalTransactions(earliest)) byTransactionId.set(t.transactionId, t)
  }

  for (const row of wanted) {
    let captureId: string | null = row.referenceId
    let fee: string | null = null

    if (row.orderId) {
      const capture = await readOrderCapture(row.orderId)
      if (capture) {
        captureId = capture.captureId
        fee = capture.processingFee
      }
    }

    if (fee == null && captureId) fee = byTransactionId.get(captureId)?.processingFee ?? null

    const setFee = fee != null && (row.fee == null || parseFloat(String(row.fee)) === 0)
    const setId  = !!captureId && captureId !== row.referenceId

    if (!setFee && !setId) {
      result.unresolved.push({
        paymentId: row.id,
        paidAt: row.paidAt,
        amount: String(row.amount),
        why: row.orderId || row.referenceId
          ? 'PayPal returned no fee for this id'
          : 'row carries neither a paypal order id nor a transaction id',
      })
      continue
    }

    await db.transaction(async (tx) => {
      await tx.update(cashEnrollmentPayments)
        .set({
          ...(setFee ? { processingFee: fee } : {}),
          ...(setId  ? { referenceId: captureId } : {}),
        })
        .where(and(eq(cashEnrollmentPayments.id, row.id), eq(cashEnrollmentPayments.tenantId, tenantId)))

      // The cash transaction is the same money seen from the bank side; its reference
      // must name the same PayPal record, or the two halves reconcile to different things.
      if (setId && row.transactionId) {
        await setEntryReference(tx, tenantId, row.transactionId, captureId)
      }
    })

    if (setFee) result.feesFilled++
    if (setId) result.idsFilled++
  }

  return result
}
