// THE BURSAR. Its reads, which settle PENDING refunds first, its nine acts, the two runs' batches, and the two halves of
// the ledger booking the API holds (the unbooked rows, and recording the movement the ledger answered). Captions are
// the host's: this answers with data.
import { may } from './access'
import type { Route } from './routes'
import { field, notFound, ok, refused, result, S } from './op'
import { enrollmentYearOf } from './lib/year-context'
import {
  getUnmatchedPayments, getPendingDonations, getEnrollmentsForMatching, getRecentlyMatchedPayments, getLastPaymentDate,
  getUnbookedZelleReceipts, getEventsForMatching, getEventMatches, ignoreIncomingPayment, matchPaymentToDonation,
  matchPaymentToEnrollment, deletePendingDonationRow, matchPaymentToEvent, movePaymentToEvent, undoEventMatch,
} from './lib/bursar'
import { soleFamilyOfAddresses, tenantFamilyNames } from './lib/enrollment-reads'
import { tuitionDifferences } from './lib/tuition-differences'
import { refundablePayments, settlePendingRefunds, refundPayment, refundPressRefusal, type RefundKind } from './lib/paypal-refunds'
import { disputesKept, noticesKept } from './lib/paypal-notices'
import { readPaypalTransactions } from './lib/paypal'
import { reconcilePaypalFees, importPaypalTransactions, matchPaypalPayments } from './lib/paypal-booking'
import { readZelleDeposits, importZelleDeposits, matchZellePayments } from './lib/zelle'
import { unbookedZelleRows, recordLedgerMovement } from './lib/zelle-book'
import { donationsWithPayments } from './lib/donations'

const T = '/v1/tenants/{slug}'
const IP = `${T}/incoming-payments/{id}`
const write = { permission: 'bursar.write' as const, allowed: async (c: Parameters<Route['allowed']>[0]) => may(c.caller, 'bursar.write') }
const counts = S.obj({ imported: S.num, matched: S.num, unmatched: S.num })

export const BURSAR_ROUTES: Route[] = [
  {
    method: 'GET', path: `${T}/bursar`, operationId: 'bursar.page',
    summary: "The bursar's work: unmatched and held payments, pending donations, open enrollments and events to match, what was matched lately, the last payment's day, what the ledger has not booked, the tuition reconciliation, every family's names, the event matches, the family each sender's address alone names, then — after PayPal's PENDING refunds are read again and settled — the refundable payments, disputes and notices, and whether the caller may refund.",
    permission: 'bursar.read',
    allowed: async c => may(c.caller, 'bursar.read'),
    response: S.obj({
      unmatched: S.list(S.row('an incoming_payments row')),
      pendingDonations: S.list(S.row('a roster_donations row')),
      enrollments: S.list(S.obj({ id: S.uuid, year: S.num, fatherLast: S.nullable(S.str), motherLast: S.nullable(S.str) })),
      recentlyMatched: S.list(S.row('src/lib/bursar.ts RecentPaymentRow')),
      lastPaymentDate: S.nullable(S.date),
      unbooked: S.list(S.row('src/lib/bursar.ts UnbookedReceiptRow')),
      differ: S.list(S.row('src/lib/tuition-differences.ts TuitionDifference')),
      events: S.list(S.obj({ id: S.uuid, title: S.str, date: S.date })),
      familyNames: S.list(S.obj({ id: S.uuid, legacyFamilyId: S.nullable(S.num), mother: S.nullable(S.str), father: S.nullable(S.str) })),
      eventMatches: S.list(S.row('src/lib/bursar.ts EventMatch')),
      suggestedFamily: { type: 'object', additionalProperties: S.uuid, description: 'payment id → the one family holding the sender address' },
      refundable: S.list(S.row('src/lib/paypal-refunds.ts RefundablePayment')),
      disputes: S.list(S.row('src/lib/paypal-notices.ts DisputeRow')),
      notices: S.list(S.row('src/lib/paypal-notices.ts NoticeRow')),
      mayRefund: S.bool,
    }),
    handle: async c => {
      const t = c.tenant.id
      const [unmatched, pendingDonations, enrollments, recentlyMatched, lastPaymentDate, unbooked, differ, events, familyNames, eventMatches] = await Promise.all([
        getUnmatchedPayments(t), getPendingDonations(t), getEnrollmentsForMatching(t), getRecentlyMatchedPayments(t),
        getLastPaymentDate(t), getUnbookedZelleReceipts(t), enrollmentYearOf(t).then(year => tuitionDifferences(t, year)), getEventsForMatching(t),
        tenantFamilyNames(t), getEventMatches(t),
      ])
      // The family list is preselected only when exactly one family holds the sender's address.
      const sole = await soleFamilyOfAddresses(t, unmatched.map(p => p.senderEmail ?? ''))
      const suggestedFamily = Object.fromEntries(unmatched.flatMap(p => {
        const f = p.senderEmail ? sole.get(p.senderEmail.trim().toLowerCase()) : undefined
        return f ? [[p.id, f]] : []
      }))
      // Refunds PayPal answered PENDING are read again first, so the list counts what PayPal now says.
      await settlePendingRefunds(t)
      const [refundable, disputes, notices] = await Promise.all([refundablePayments(t), disputesKept(t), noticesKept(t)])
      return ok({
        unmatched, pendingDonations, enrollments, recentlyMatched, lastPaymentDate, unbooked, differ, events, familyNames,
        eventMatches, suggestedFamily, refundable, disputes, notices, mayRefund: may(c.caller!, 'bursar.approve'),
      })
    },
  },
  {
    method: 'GET', path: `${T}/donations`, operationId: 'donation.list',
    summary: 'Every donation of the tenant with the payment it was matched to (empty when unmatched), newest first.',
    permission: 'bursar.read',
    allowed: async c => may(c.caller, 'bursar.read'),
    response: S.list(S.row('src/lib/donations.ts donationsWithPayments row (recordedAt and receiptSentAt as date-time)')),
    handle: async c => ok(await donationsWithPayments(c.tenant.id)),
  },
  {
    method: 'POST', path: `${T}/bursar/paypal-fees/reconcile`, operationId: 'bursar.reconcilePaypalFees',
    summary: "Read PayPal's fee for each PayPal payment and correct the books.",
    ...write, response: S.row('src/lib/paypal-booking.ts PaypalReconcileResult'),
    handle: async c => ok(await reconcilePaypalFees(c.tenant.id)),
  },
  {
    method: 'POST', path: `${T}/bursar/refunds`, operationId: 'bursar.refund',
    summary: 'Refund a PayPal payment the host took, once per request id.',
    permission: 'bursar.approve',
    allowed: async c => may(c.caller, 'bursar.approve'),
    request: S.obj({ kind: { type: 'string', enum: ['enrollment', 'event', 'donation'] }, paymentId: S.uuid, amount: S.num, requestId: S.uuid }),
    response: S.obj({ refundId: S.str, status: S.str, amount: S.str }),
    handle: async c => {
      const b = field.obj(c.body)
      const refusal = refundPressRefusal(b.kind, b.requestId)
      if (refusal) return refused(refusal)
      try {
        return result(await refundPayment(c.tenant.id, c.caller!.userId, b.kind as RefundKind, field.str(b, 'paymentId'),
          field.num(b, 'amount'), field.str(b, 'requestId'), c.actor!))
      } catch (e) {
        return refused(e instanceof Error ? e.message : String(e))
      }
    },
  },
  {
    method: 'POST', path: `${IP}/ignore`, operationId: 'incomingPayment.ignore',
    summary: 'Mark an incoming payment ignored.',
    ...write, response: S.done,
    handle: async c => { await ignoreIncomingPayment(c.tenant.id, c.params.id); return ok({ success: true }) },
  },
  {
    method: 'POST', path: `${IP}/match/donation`, operationId: 'incomingPayment.matchDonation',
    summary: 'Match an incoming payment to a pending donation.',
    ...write, request: S.obj({ donationId: S.uuid }), response: S.done,
    handle: async c => { await matchPaymentToDonation(c.tenant.id, c.params.id, field.str(c.body, 'donationId')); return ok({ success: true }) },
  },
  {
    method: 'POST', path: `${IP}/match/enrollment`, operationId: 'incomingPayment.matchEnrollment',
    summary: "Match an incoming payment to an enrollment, booking it to the family's tuition.",
    ...write, request: S.obj({ enrollmentId: S.uuid }), response: S.obj({ familyId: S.uuid }),
    handle: async c => result(await matchPaymentToEnrollment(c.tenant.id, c.caller!.userId, c.params.id, field.str(c.body, 'enrollmentId'))),
  },
  {
    method: 'POST', path: `${IP}/match/event`, operationId: 'incomingPayment.matchEvent',
    summary: "Match an incoming payment to an event, for a family.",
    ...write, request: S.obj({ eventId: S.uuid, familyId: S.uuid }), response: S.obj({ eventId: S.uuid }),
    handle: async c => result(await matchPaymentToEvent(c.tenant.id, c.caller!.userId, c.params.id, field.str(c.body, 'eventId'), field.str(c.body, 'familyId'))),
  },
  {
    method: 'POST', path: `${IP}/move-to-event`, operationId: 'incomingPayment.moveToEvent',
    summary: "Move a payment matched to an enrollment onto an event, for a family.",
    ...write, request: S.obj({ eventId: S.uuid, familyId: S.uuid }), response: S.obj({ eventId: S.uuid, enrollmentFamilyId: S.uuid }),
    handle: async c => result(await movePaymentToEvent(c.tenant.id, c.caller!.userId, c.params.id, field.str(c.body, 'eventId'), field.str(c.body, 'familyId'))),
  },
  {
    method: 'DELETE', path: `${T}/event-payments/{id}/match`, operationId: 'eventPayment.undoMatch',
    summary: "Undo a person's event match: the payment is held for a person again.",
    ...write, response: S.obj({ eventId: S.uuid }),
    handle: async c => result(await undoEventMatch(c.tenant.id, c.params.id)),
  },
  {
    method: 'DELETE', path: `${T}/donations/{id}`, operationId: 'donation.deletePending',
    summary: 'Delete a pending donation that never arrived.',
    ...write, response: S.done,
    handle: async c => { await deletePendingDonationRow(c.tenant.id, c.params.id); return ok({ success: true }) },
  },

  // ---- the runs' batches: the run is the host's and calls these
  {
    method: 'POST', path: `${T}/bursar/zelle/import`, operationId: 'bursar.importZelle',
    summary: "One batch of the Zelle run: read the school's Zelle deposits since a day (the host's deposits port), import them, match what can be matched.",
    ...write, request: S.obj({ since: S.date }), response: counts,
    handle: async c => {
      const deposits = await readZelleDeposits(c.tenant.id, field.str(c.body, 'since'))
      const imported = await importZelleDeposits(c.tenant.id, deposits)
      return ok({ imported, ...await matchZellePayments(c.tenant.id, c.actor!) })
    },
  },
  {
    method: 'POST', path: `${T}/bursar/paypal/import`, operationId: 'bursar.importPaypal',
    summary: "One batch of the PayPal run: read PayPal's transactions since a day, import them, match what can be matched.",
    ...write, request: S.obj({ since: S.date }), response: counts,
    handle: async c => {
      const transactions = await readPaypalTransactions(field.str(c.body, 'since'))
      const imported = await importPaypalTransactions(c.tenant.id, transactions)
      return ok({ imported, ...await matchPaypalPayments(c.tenant.id) })
    },
  },

  // ---- the ledger booking's two halves the API holds; the booking itself is the caller's
  {
    method: 'GET', path: `${T}/zelle-receipts/unbooked`, operationId: 'zelleReceipt.unbooked',
    summary: 'Every Zelle receipt with no ledger movement yet — enrollment money and event money — for the caller to book in its ledger.',
    ...write,
    response: S.list(S.obj({ id: S.uuid, confirmationId: S.nullable(S.str), valueDate: S.nullable(S.date), amount: S.str, event: S.bool })),
    handle: async c => ok(await unbookedZelleRows(c.tenant.id)),
  },
  {
    method: 'PUT', path: `${T}/zelle-receipts/{id}/ledger-movement`, operationId: 'zelleReceipt.recordMovement',
    summary: "Record the movement the ledger answered for one Zelle receipt (idempotent: the ledger answers the same movement for the same confirmation).",
    ...write, request: S.obj({ event: S.bool, movementId: S.num }), response: S.done,
    handle: async c => {
      const b = field.obj(c.body)
      if (typeof b.event !== 'boolean') return refused('event must be true or false')
      return (await recordLedgerMovement(c.tenant.id, c.params.id, b.event, field.num(b, 'movementId')))
        ? ok({ success: true }) : notFound('no such Zelle receipt in this tenant')
    },
  },
]
