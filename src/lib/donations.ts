// DONATIONS AS RECORDED — every roster_donations row with the payment it was matched to, newest first, for the
// donations viewer.
import { desc, eq } from 'drizzle-orm'
import { db } from './db'
import { rosterDonations, incomingPayments } from '../tables'

/** Every donation of the tenant with its matched payment's own fields (empty when unmatched), newest first. */
export function donationsWithPayments(tenantId: string) {
  return db
    .select({
      id: rosterDonations.id,
      recordedAt: rosterDonations.createdAt,
      donorName: rosterDonations.donorName,
      donorEmail: rosterDonations.donorEmail,
      amountIntended: rosterDonations.amountIntended,
      message: rosterDonations.message,
      status: rosterDonations.status,
      receiptSentAt: rosterDonations.receiptSentAt,
      paymentSource: incomingPayments.source,
      paymentAmount: incomingPayments.amount,
      paymentReceivedAt: incomingPayments.receivedAt,
      paymentReference: incomingPayments.referenceId,
    })
    .from(rosterDonations)
    .leftJoin(incomingPayments, eq(incomingPayments.id, rosterDonations.paymentId))
    .where(eq(rosterDonations.tenantId, tenantId))
    .orderBy(desc(rosterDonations.createdAt))
}
