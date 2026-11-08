// A Zelle receipt is booked as a movement AFTER the roster's own row is committed, and the movement id recorded.
//
// WHY THIS IS NOT INSIDE THE TRANSACTION. The receipt is the roster's own record of a payment a person
// really made; the roster commits it first, so a failure in the booking never rolls it back. The booking
// is a second step, made by the caller.
//
// WHY A FAILURE HERE DOES NOT FAIL THE ACTION. The booking is idempotent on the confirmation
// (a second run books nothing and returns the same ids), so an unbooked
// row is not lost work — it is a row with a null movement id that the next run picks up. Refusing
// the bursar's match because the booking failed would trade a recoverable gap for an unrecoverable one.
//
// THREE PARTS: the roster serves the unbooked rows (unbookedZelleRows) and records the movement id it is handed
// (recordLedgerMovement); the booking between them is the caller's.
import { db } from './db'
import { cashEnrollmentPayments, eventPayments } from '../tables'
import { unbookedZelleEventPayments } from './bursar'
import { and, eq, isNull } from 'drizzle-orm'

export type UnbookedZelleRow = { id: string; confirmationId: string | null; valueDate: string | null; amount: string; event: boolean }

/** Every Zelle receipt of the tenant with no movement id yet: enrollment money, then event money. */
export async function unbookedZelleRows(tenantId: string): Promise<UnbookedZelleRow[]> {
  const enrollmentRows = await db
    .select({
      id: cashEnrollmentPayments.id,
      confirmationId: cashEnrollmentPayments.referenceId,
      valueDate: cashEnrollmentPayments.paidAt,
      amount: cashEnrollmentPayments.amount,
    })
    .from(cashEnrollmentPayments)
    .where(and(
      eq(cashEnrollmentPayments.tenantId, tenantId),
      eq(cashEnrollmentPayments.method, 'zelle'),
      isNull(cashEnrollmentPayments.ledgerMovementId),
      // MONEY OUT GOES TOO, AS A NEGATIVE AMOUNT: a refund is booked as a negative amount, and
      // the ledger decides what to do with it. Leaving the ledger short of a real movement is worse than a receipt
      // booking receiving a negative amount, and which shape an outgoing movement takes is the ledger's to decide.
      // A refund is the same row with a negative amount (lib/family-money.ts), so it
      // needs no second path here; if the ledger refuses it, the refusal is printed and the row keeps
      // its null movement id for the next sweep.
    ))
  // An event's Zelle money goes the same way, dated by its cash transaction's day.
  return [
    ...enrollmentRows.map(r => ({ ...r, amount: String(r.amount), event: false })),
    ...(await unbookedZelleEventPayments(tenantId)).map(r => ({ id: r.id, confirmationId: r.confirmationId, valueDate: r.valueDate, amount: String(r.amount), event: true })),
  ]
}

/** Store the ledger's movement id on the tenant's receipt row; false when no such row is the tenant's. */
export async function recordLedgerMovement(tenantId: string, id: string, event: boolean, movementId: number): Promise<boolean> {
  const done = event
    ? await db.update(eventPayments).set({ ledgerMovementId: movementId })
      .where(and(eq(eventPayments.id, id), eq(eventPayments.tenantId, tenantId))).returning({ id: eventPayments.id })
    : await db.update(cashEnrollmentPayments).set({ ledgerMovementId: movementId })
      .where(and(eq(cashEnrollmentPayments.id, id), eq(cashEnrollmentPayments.tenantId, tenantId))).returning({ id: cashEnrollmentPayments.id })
  return done.length > 0
}
