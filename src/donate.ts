// THE DOORS WITH NO PERSON. The donation, its order and capture, and the payment provider's notices are the host's
// public routes, which call these with the host's certificate alone: each is MARKED public-door, so no permission or
// role is added anywhere. A notice is verified by the provider's own call, made here with its raw body and
// transmission headers forwarded unchanged.
import type { IncomingHttpHeaders } from 'node:http'
import type { Answer, Route } from './routes'
import { field, S } from './op'
import { startDonation, donationOrder, captureDonation, type DoorAnswer } from './lib/paypal-doors'
import { ports, type NoticeHeaders } from './ports'
import { noticeFrom, receiveNotice } from './lib/paypal-notices'

const T = '/v1/tenants/{slug}'
const door = (a: DoorAnswer): Answer => ({ status: a.status, body: a.body })
const doorBody = { type: 'object', description: "the route's own answer: its fields on 200, `{ error }` otherwise" }
const publicDoor = { permission: null, publicDoor: true as const, allowed: async () => false }

function noticeHeaders(h: IncomingHttpHeaders): NoticeHeaders | null {
  const one = (name: string) => { const v = h[name]; return (Array.isArray(v) ? v[0] : v)?.trim() || null }
  const authAlgo = one('paypal-auth-algo'), certUrl = one('paypal-cert-url'), transmissionId = one('paypal-transmission-id')
  const transmissionSig = one('paypal-transmission-sig'), transmissionTime = one('paypal-transmission-time')
  if (!authAlgo || !certUrl || !transmissionId || !transmissionSig || !transmissionTime) return null
  return { authAlgo, certUrl, transmissionId, transmissionSig, transmissionTime }
}

export const DONATE_ROUTES: Route[] = [
  {
    method: 'POST', path: `${T}/donations`, operationId: 'donation.start',
    summary: "A pending donation record, from a donate form.",
    ...publicDoor,
    request: S.obj({ donorName: S.str, donorEmail: S.str, 'amountIntended?': S.nullable(S.num), 'message?': S.nullable(S.str) }),
    response: doorBody,
    handle: async c => door(await startDonation(c.tenant.id, field.obj(c.body))),
  },
  {
    method: 'POST', path: `${T}/donations/{id}/paypal/orders`, operationId: 'donation.paypalOrder',
    summary: "A PayPal order for the donation's intended amount, stamped on it.",
    ...publicDoor,
    response: doorBody,
    handle: async c => door(await donationOrder(c.tenant.id, c.params.id)),
  },
  {
    method: 'POST', path: `${T}/donations/{id}/paypal/captures`, operationId: 'donation.paypalCapture',
    summary: "Capture the donation's own order, record the money, and mail the donor the tax receipt.",
    ...publicDoor,
    request: S.obj({ orderId: S.str }),
    response: doorBody,
    handle: async c => door(await captureDonation(c.tenant.id, c.params.id, field.str(c.body, 'orderId'))),
  },
  {
    method: 'POST', path: `${T}/paypal/notices`, operationId: 'paypal.notice',
    summary: "PayPal's notice of a refund, reversal or dispute made on its own site: no webhook id 503, a signature PayPal does not verify 403, then 200 once kept.",
    ...publicDoor, rawBody: true,
    response: { type: 'object', description: '`{ outcome }` on 200, `{ error }` otherwise' },
    handle: c => notice(c.headers, c.raw, c.tenant.id).catch(e => {
      // A named 500 when the host's secret read, PayPal or the store fails, so PayPal resends.
      console.error('[dakhila] paypal.notice', e)
      return { status: 500, body: { error: e instanceof Error ? e.message : String(e) } }
    }),
  },
]

/** The notice route's checks in its order: no webhook id 503, then the signature 403, then 200 once kept. */
async function notice(h: IncomingHttpHeaders, raw: string, tenantId: string): Promise<Answer> {
  const { webhookId, verifyNotice } = ports().paymentNotices
  const hook = await webhookId()
  if (!hook.id) return { status: 503, body: { error: `the host holds no ${hook.name} for this notice, so it cannot be checked` } }
  const headers = noticeHeaders(h)
  if (!headers) return { status: 403, body: { error: 'no PAYPAL-* transmission headers' } }
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return { status: 403, body: { error: 'the body is not JSON' } } }
  const n = noticeFrom(parsed)
  if (!n) return { status: 403, body: { error: 'the body is not a PayPal notice: no id or event_type' } }
  if (!await verifyNotice(headers, raw, hook.id)) return { status: 403, body: { error: 'PayPal does not verify the signature' } }
  const r = await receiveNotice(tenantId, n)
  return { status: 200, body: { outcome: r.outcome } }
}
