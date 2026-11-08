// THE DOORS WITH NO PERSON (see also donate.ts): the self-registration pair and the phone vendor's two webhooks. The host admits the
// caller — the registering person's verified sign-in, the vendor's signature and the school's number — and
// then calls these with its client certificate alone. Each operation is MARKED public-door: no permission and no role;
// the tenant is the path's.
import type { Answer, Route } from './routes'
import { field, ok, S } from './op'
import { intakeAddressExists, registerIntakePerson, type IntakePerson } from './lib/intake-person'
import { receiveText, updateStatus } from './lib/sms-texts'
import { requireTenant } from './lib/roster-public-url'

const T = '/v1/tenants/{slug}'
const publicDoor = { permission: null, publicDoor: true as const, allowed: async () => false }
const answer = (a: { status: number; body: unknown }): Answer => ({ status: a.status, body: a.body })

/** Twilio's form parameters as the host verified them: each name to its text. */
function params(b: unknown): Record<string, string> {
  const o = field.obj(field.obj(b).params)
  return Object.fromEntries(Object.entries(o).filter(([, v]) => typeof v === 'string')) as Record<string, string>
}

export const INTAKE_ROUTES: Route[] = [
  {
    method: 'POST', path: `${T}/intake/address-check`, operationId: 'intake.check',
    summary: "Whether a live person of the tenant holds the address (a registration asks before it sends a parent on).",
    ...publicDoor,
    request: S.obj({ email: S.str }),
    response: S.obj({ exists: S.bool }),
    handle: async c => ok({ exists: await intakeAddressExists(c.tenant.id, field.str(c.body, 'email')) }),
  },
  {
    method: 'POST', path: `${T}/intake/persons`, operationId: 'intake.person',
    summary: "A parent's self-registration: their family and their person, the address the one the host verified from their sign-in; an address already on the roster is stated (200), a school account or a held phone number refused (400).",
    ...publicDoor,
    request: S.obj({ email: S.str, firstName: S.str, lastName: S.nullable(S.str), phone: S.str, role: S.str, smsConsent: S.bool }),
    response: { type: 'object', description: "201 { created, personId, familyId }, 200 { created: false, alreadyRegistered }, or 400 { error }" },
    handle: async c => {
      const role = field.str(c.body, 'role')
      if (role !== 'mother' && role !== 'father') return { status: 400, body: { error: 'invalid_role: role must be mother or father', code: 'bad_request' } }
      const request: IntakePerson = {
        firstName: field.str(c.body, 'firstName'), lastName: field.strOrNull(c.body, 'lastName'), phone: field.str(c.body, 'phone'),
        role, smsConsent: field.obj(c.body).smsConsent === true,
      }
      return answer(await registerIntakePerson(await requireTenant(c.tenant.id), request, field.str(c.body, 'email')))
    },
  },
  {
    method: 'POST', path: `${T}/texts/inbound`, operationId: 'text.receive',
    summary: "A text the school number received, as Twilio posted it and the host verified it: kept, and the texting rules applied (where a reply goes is the host's mail rule).",
    ...publicDoor,
    request: S.obj({ params: { type: 'object', additionalProperties: { type: 'string' } } }),
    response: S.done,
    handle: async c => { await receiveText(await requireTenant(c.tenant.id), params(c.body)); return ok({ success: true }) },
  },
  {
    method: 'POST', path: `${T}/texts/status`, operationId: 'text.status',
    summary: "Twilio's word on a text the school sent, as the host verified it: the status moves forward only.",
    ...publicDoor,
    request: S.obj({ sid: S.str, status: S.str, errorCode: S.nullable(S.str) }),
    response: S.done,
    handle: async c => {
      await updateStatus(c.tenant.id, field.str(c.body, 'sid'), field.str(c.body, 'status'), field.strOrNull(c.body, 'errorCode'))
      return ok({ success: true })
    },
  },
]
