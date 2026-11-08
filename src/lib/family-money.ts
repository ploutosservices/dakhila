// ONE DOOR FOR MONEY THAT BELONGS TO A FAMILY — in or out, with its character, optionally
// settling something the bank already told us about.
//
// From a family, a caller the access rule lets book payments books an incoming or outgoing payment. An incoming one
// can be matched against PayPal or Zelle unapplied amounts; an outgoing one books a transaction in
// the transaction log. Either has the correct character — a tuition refund's character is tuition
// for this session, so "total paid" is the sum of all entries for this family for this session.
//
// It clears a queue row whether or not the family still owes, and books money OUT as well as in.
//
// THE SIGN IS THE WHOLE TRICK. An outgoing entry is the same row with a negative amount, so
// every "total paid" — a family's money read, the enrollment reads, the chatbot's context, the
// paid/unpaid check — is a plain sum and needs no special case. Read them before changing this:
// they all add `amount` with no assumption about its sign.
//
// WHAT IT DOES NOT DO: send an outgoing movement to the ledger. The Zelle sweep books RECEIPTS
// (lib/zelle-book.ts), and a refund is not a receipt; it is excluded there rather than posted as
// a negative one. The ledger has no outgoing door.

import { db } from './db'
import {
  cashEnrollmentPayments,
  familyEnrollments, incomingPayments,
  PAYMENT_CHARACTER_TUITION, PAYMENT_CHARACTERS,
} from '../tables'
import { and, eq } from 'drizzle-orm'
import { maybeMarkEnrollmentPaid } from './enrollment-ops'
import { birthId } from './registry-id'
import { accountRow, bookEntry } from './ledger'

export type BookDirection = 'in' | 'out'

export type BookFamilyMoney = {
  enrollmentId: string
  direction: BookDirection
  /** Always POSITIVE as typed; the direction decides the sign that is stored. */
  amountDollars: number
  method: string
  /** What the money is FOR. Defaults to tuition, free to be anything (lib/payment-characters.ts). */
  character?: string
  paidAt: string | null
  referenceId: string | null
  notes: string | null
  /** An unapplied Zelle/PayPal row this booking settles; it is marked matched in the same act. */
  settlesIncomingPaymentId?: string | null
  /** What the processor charged, when the caller knows it. */
  processingFeeDollars?: number | null
}

export async function bookFamilyMoney(
  tenantId: string,
  userId: string,
  input: BookFamilyMoney,
): Promise<{ familyId: string } | { error: string }> {
  const amount = Math.abs(input.amountDollars)
  if (!(amount > 0)) return { error: 'Enter an amount greater than zero.' }

  const [enrollment] = await db
    .select({ id: familyEnrollments.id, familyId: familyEnrollments.familyId })
    .from(familyEnrollments)
    .where(and(eq(familyEnrollments.id, input.enrollmentId), eq(familyEnrollments.tenantId, tenantId)))
    .limit(1)
  if (!enrollment) return { error: 'Enrollment not found.' }

  // The queue row, if this booking settles one. Refused rather than silently ignored when it is
  // already matched — a settled payment applied twice is money counted twice.
  let incoming: typeof incomingPayments.$inferSelect | null = null
  if (input.settlesIncomingPaymentId) {
    const [row] = await db
      .select()
      .from(incomingPayments)
      .where(and(
        eq(incomingPayments.id, input.settlesIncomingPaymentId),
        eq(incomingPayments.tenantId, tenantId),
      ))
      .limit(1)
    if (!row) return { error: 'That unapplied payment was not found.' }
    if (row.status !== 'unmatched') return { error: 'That payment has already been applied.' }
    if (input.direction === 'out') return { error: 'An outgoing payment cannot settle money received.' }
    incoming = row
  }

  const account = await accountRow(tenantId, input.method)

  // The transaction log states the direction; the enrolment entry states the sign. Same money,
  // said the way each table says it.
  const signed = (input.direction === 'out' ? -amount : amount).toFixed(2)
  // The list is the rule, and the door enforces it — a screen can be edited, a refusal cannot.
  const character = (input.character ?? '').trim() || PAYMENT_CHARACTER_TUITION
  if (!(PAYMENT_CHARACTERS as readonly string[]).includes(character)) {
    return { error: `Not a character we book: ${character}. Choose one of ${PAYMENT_CHARACTERS.join(', ')}.` }
  }

  await db.transaction(async (tx) => {
    const txn = { id: await bookEntry(tx, {
      id: await birthId(tx, 'ledger_entry', tenantId),
      tenantId,
      bankAccountId: account?.id ?? null,
      amount: amount.toFixed(2),
      direction: input.direction,
      type: 'enrollment_payment',
      paidAt: input.paidAt ?? null,
      referenceId: input.referenceId ?? null,
      notes: input.notes,
      recordedBy: userId,
    }) }

    await tx.insert(cashEnrollmentPayments).values({
      tenantId,
      enrollmentId: input.enrollmentId,
      transactionId: txn.id,
      amount: signed,
      character,
      method: input.method,
      notes: input.notes,
      recordedBy: userId,
      bankAccountId: account?.id ?? null,
      processingFee: input.processingFeeDollars != null ? input.processingFeeDollars.toFixed(2) : null,
      paidAt: input.paidAt ?? null,
      referenceId: input.referenceId ?? null,
    })

    if (incoming) {
      await tx.update(incomingPayments)
        .set({ status: 'matched', matchedToType: 'enrollment', matchedToId: input.enrollmentId })
        .where(eq(incomingPayments.id, incoming.id))
    }
  })

  await maybeMarkEnrollmentPaid(tenantId, input.enrollmentId)
  return { familyId: enrollment.familyId }
}
