// PAYPAL AND EVENT PAYMENTS. The enrollment pair (create-order, capture-order) and the event pair (event-create-order,
// event-capture-order), run by lib/paypal-doors.ts; and a family's event payments and the event Zelle record. Captions
// are the reader's: the family names come as data.
import { may, ownFamilyOf } from './access'
import type { Answer, Route } from './routes'
import { field, mayOrOwn, OWN_FAMILY, refused, ok, S } from './op'
import {
  enrollmentFamily, enrollmentOrder, captureEnrollmentOrder, eventOrder, captureEventOrder, type DoorAnswer,
} from './lib/paypal-doors'
import { payableEvents, paymentsForEvent, tenantToday } from './lib/event-payments'
import { familyNames } from './lib/enrollment-reads'
import { recordZelleEventPayment } from './lib/bursar'

const T = '/v1/tenants/{slug}'
const door = (a: DoorAnswer): Answer => ({ status: a.status, body: a.body })
const doorBody = { type: 'object', description: "the route's own answer: its fields on 200, `{ error }` on 400, 404 or 409" }
/** The enrollment's family must be the caller's own, or the caller hold enrollment.write; no such enrollment answers 404. */
const payer = async (c: Parameters<Route['allowed']>[0]): Promise<boolean> => {
  const e = await enrollmentFamily(c.tenant.id, c.params.id)
  return !e || await mayOrOwn(c, 'enrollment.write', e.familyId)
}
const notFound = { status: 404, body: { error: 'Enrollment not found' } }

export const PAYPAL_ROUTES: Route[] = [
  {
    method: 'POST', path: `${T}/enrollments/{id}/paypal/orders`, operationId: 'paypal.enrollmentOrder',
    summary: 'Make a PayPal order for what the enrollment has left to pay (Apple Pay: for the total its sheet showed).',
    permission: 'enrollment.write', alsoAllowed: `${OWN_FAMILY}, when the enrollment is that family's`,
    allowed: payer,
    request: S.obj({ 'sheetTotal?': S.nullable(S.str) }),
    response: doorBody,
    handle: async c => {
      if (!await enrollmentFamily(c.tenant.id, c.params.id)) return notFound
      return door(await enrollmentOrder(c.tenant.id, c.params.id, field.obj(c.body).sheetTotal, c.actor!))
    },
  },
  {
    method: 'POST', path: `${T}/enrollments/{id}/paypal/captures`, operationId: 'paypal.enrollmentCapture',
    summary: "Capture an approved order onto the enrollment and book it; a credit card's fee is quoted first.",
    permission: 'enrollment.write', alsoAllowed: `${OWN_FAMILY}, when the enrollment is that family's`,
    allowed: payer,
    request: S.obj({ orderId: S.str, 'acceptedTotal?': S.nullable(S.str) }),
    response: doorBody,
    handle: async c => {
      if (!await enrollmentFamily(c.tenant.id, c.params.id)) return notFound
      return door(await captureEnrollmentOrder(c.tenant.id, c.caller!.userId, c.params.id, field.str(c.body, 'orderId'),
        field.obj(c.body).acceptedTotal, c.actor!))
    },
  },
  {
    method: 'POST', path: `${T}/events/{id}/paypal/orders`, operationId: 'paypal.eventOrder',
    summary: "A family pays for an event: a pending payment for the caller's own family, and a PayPal order stamped on it.",
    permission: null, alsoAllowed: OWN_FAMILY,
    allowed: async c => (await ownFamilyOf(c.store, c.caller)) !== null,
    request: S.obj({ amount: S.num, 'sheetTotal?': S.nullable(S.str) }),
    response: doorBody,
    handle: async c => door(await eventOrder(c.tenant.id, (await ownFamilyOf(c.store, c.caller!))!, c.caller!.userId, c.params.id,
      field.num(c.body, 'amount'), field.obj(c.body).sheetTotal, c.actor!)),
  },
  {
    method: 'POST', path: `${T}/event-payments/paypal/captures`, operationId: 'paypal.eventCapture',
    summary: "Settle the caller's own family's pending event payment for an order; a credit card's fee is quoted first.",
    permission: null, alsoAllowed: OWN_FAMILY,
    allowed: async c => (await ownFamilyOf(c.store, c.caller)) !== null,
    request: S.obj({ orderId: S.str, 'acceptedTotal?': S.nullable(S.str) }),
    response: doorBody,
    handle: async c => door(await captureEventOrder(c.tenant.id, (await ownFamilyOf(c.store, c.caller!))!, c.caller!.userId,
      field.str(c.body, 'orderId'), field.obj(c.body).acceptedTotal, c.actor!)),
  },

  // ---- a family's own event payments
  {
    method: 'GET', path: `${T}/events/payable/mine`, operationId: 'eventPayment.payable',
    summary: "The events a family may pay for today (last paying day today or later), and today in the tenant's zone — for the caller's own family.",
    permission: null, alsoAllowed: OWN_FAMILY,
    allowed: async c => (await ownFamilyOf(c.store, c.caller)) !== null,
    response: S.obj({ events: S.list(S.obj({ id: S.uuid, title: S.str, date: S.date, payUntil: S.date })), today: S.date }),
    handle: async c => ok({ events: await payableEvents(c.tenant.id), today: await tenantToday(c.tenant.id) }),
  },
  {
    method: 'GET', path: `${T}/events/payable/payments`, operationId: 'eventPayment.payableLists',
    summary: "Each event still taking payments, with its paid payments, newest first, and the paying families' names.",
    permission: 'event.write',
    allowed: async c => may(c.caller, 'event.write'),
    response: S.obj({
      events: S.list(S.obj({ id: S.uuid, title: S.str, date: S.date, payUntil: S.date, rows: S.list(S.row('src/lib/event-payments.ts EventPaymentData')) })),
      familyNames: S.list(S.obj({ id: S.uuid, legacyFamilyId: S.nullable(S.num), mother: S.nullable(S.str), father: S.nullable(S.str) })),
    }),
    handle: async c => {
      const events = await Promise.all((await payableEvents(c.tenant.id)).map(async e => ({ ...e, rows: await paymentsForEvent(c.tenant.id, e.id) })))
      return ok({ events, familyNames: await familyNames(c.tenant.id, events.flatMap(e => e.rows.map(r => r.familyId))) })
    },
  },
  {
    method: 'POST', path: `${T}/events/{id}/zelle`, operationId: 'eventPayment.recordZelle',
    summary: "Record a Zelle payment for an event, for the caller's own family.",
    permission: 'bursar.write', alsoAllowed: "and the caller's own family is the one paid for (no family: 422 code no_family)",
    allowed: async c => may(c.caller, 'bursar.write'),
    request: S.obj({ amount: S.num, receivedOn: S.date, referenceId: S.str, notes: S.nullable(S.str) }),
    response: S.done,
    handle: async c => {
      const familyId = await ownFamilyOf(c.store, c.caller!)
      if (!familyId) return { status: 422, body: { error: 'the caller belongs to no family in this tenant', code: 'no_family' } }
      const r = await recordZelleEventPayment(c.tenant.id, c.caller!.userId, familyId, c.params.id, field.num(c.body, 'amount'),
        field.str(c.body, 'receivedOn'), field.str(c.body, 'referenceId'), field.strOrNull(c.body, 'notes'))
      return 'error' in r ? refused(r.error) : ok({ success: true })
    },
  },
]
