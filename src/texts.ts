// TEXTS AND CALLS: a person's own text-message switch and opt-out, the principal's staff text, unread texts and
// mark-read, and click-to-call. The phone vendor is reached from here; the host keeps the check on a person viewing as
// someone else, and every date and link it writes.
import { may } from './access'
import type { PersonCall, Route } from './routes'
import { field, ok, S } from './op'
import { e164 } from './lib/phone-e164'
import { personFirstNameAndPhone, rosterPersonBySignIn, saidStop } from './lib/sms-consent'
import { declineTexts, optIn, optOut } from './lib/sms-consent-writes'
import { familyTexts, markTextRead, sendText, unreadTexts } from './lib/sms-texts'
import { ports } from './ports'
import { formatPhone } from './lib/format-phone'
import { phoneRules } from './lib/rules-context'
import { requireTenant } from './lib/roster-public-url'
import { schoolWord } from './lib/school-words'

const T = '/v1/tenants/{slug}/texts'
const SELF = 'the signed-in person, for their own number: found by the address they signed in with, never a parameter'
const MESSAGE = S.obj({ 'ok?': S.bool, message: S.str })
const RESULT = S.obj({ 'ok?': S.bool, 'error?': S.str })
const NOT_PRINCIPAL = 'Unread texts are for the principal.'

export const TEXT_ROUTES: Route[] = [
  {
    method: 'GET', path: `${T}/families/{id}`, operationId: 'text.family',
    summary: "A family's texts: one thread per person of the family shown to staff (in the map, texts on), oldest first; to a roster writer, also what a send to each would answer.",
    permission: 'roster.read',
    allowed: async c => may(c.caller, 'roster.read'),
    response: S.list(S.row('a family thread (src/lib/sms-texts.ts FamilyThread), `at` as a date-time')),
    handle: async c => ok(await familyTexts(c.tenant.id, c.params.id, may((c as PersonCall).caller, 'roster.write'))),
  },
  {
    method: 'PUT', path: `${T}/mine`, operationId: 'text.setMine',
    summary: "The signed-in person's text messages on or off, for their own number; on is refused with no mobile number or after a STOP.",
    permission: null, alsoAllowed: SELF,
    allowed: async () => true,
    request: S.obj({ on: S.bool }),
    response: RESULT,
    handle: async c => {
      const pc = c as PersonCall
      const on = field.obj(c.body).on === true
      const me = await rosterPersonBySignIn(c.tenant.id, pc.caller.email)
      if (!me) return ok({ error: 'Your sign-in is not on the roster.' })
      if (on) {
        const phone = me.phone ? e164(me.phone, await phoneRules(c.tenant.id)) : null
        if (!phone) return ok({ error: `There is no mobile number on your record. Add it under ${await schoolWord(c.tenant.id, 'edit-button')}, then turn text messages on.` })
        // After a STOP the carriers block every text until START; a yes here would promise texts that cannot arrive.
        if (await saidStop(c.tenant.id, phone)) {
          return ok({ error: `You texted STOP to ${formatPhone(await ports().phone.schoolNumber(), await phoneRules(c.tenant.id))}. Text START to it to turn texts back on.` })
        }
        await optIn(c.tenant.id, me.id, phone, (await requireTenant(c.tenant.id)).longName)
      } else {
        await optOut(c.tenant.id, me.id)
      }
      return ok({ ok: true })
    },
  },
  {
    method: 'POST', path: `${T}/mine/decline`, operationId: 'text.decline',
    summary: "The signed-in person says no to the invitation to text, for their own number: no consent is recorded and their emails stop asking.",
    permission: null, alsoAllowed: SELF,
    allowed: async () => true,
    response: RESULT,
    handle: async c => {
      const pc = c as PersonCall
      const me = await rosterPersonBySignIn(c.tenant.id, pc.caller.email)
      if (!me) return ok({ error: 'Your sign-in is not on the roster.' })
      const phone = me.phone ? e164(me.phone, await phoneRules(c.tenant.id)) : null
      if (!phone) return ok({ error: 'There is no mobile number on your record.' })
      await declineTexts(c.tenant.id, me.id, phone)
      return ok({ ok: true })
    },
  },
  {
    method: 'POST', path: T, operationId: 'text.send',
    summary: "A staff text from the school number to a person on the roster (never a number); the send decides whether it may go. A refusal is its own message.",
    permission: 'roster.write',
    allowed: async () => true,
    request: S.obj({ personId: S.str, body: S.str }),
    response: MESSAGE,
    handle: async c => {
      const pc = c as PersonCall
      if (!may(pc.caller, 'roster.write')) return ok({ message: 'Texting families is for the principal.' })
      try {
        await sendText(await requireTenant(c.tenant.id), field.str(c.body, 'personId'), field.str(c.body, 'body'), pc.actor, pc.caller.userId)
      } catch (e) {
        return ok({ message: e instanceof Error ? e.message : String(e) })
      }
      return ok({ ok: true, message: 'Sent.' })
    },
  },
  {
    method: 'GET', path: `${T}/unread`, operationId: 'text.unread',
    summary: 'The texts staff have not read, newest first: who sent each, from which family, and what it says.',
    permission: 'roster.write',
    allowed: async () => true,
    response: S.obj({ 'rows?': S.list(S.row('an unread text: id, at, personId, name, familyId, body, numMedia, refused')), 'message?': S.str }),
    handle: async c => may((c as PersonCall).caller, 'roster.write')
      ? ok({ rows: await unreadTexts(c.tenant.id) })
      : ok({ message: NOT_PRINCIPAL }),
  },
  {
    method: 'POST', path: `${T}/{id}/read`, operationId: 'text.markRead',
    summary: "A text marked read: the school's one mark, who and when; never a reply.",
    permission: 'roster.write',
    allowed: async () => true,
    response: MESSAGE,
    handle: async c => {
      const pc = c as PersonCall
      if (!may(pc.caller, 'roster.write')) return ok({ message: NOT_PRINCIPAL })
      const marked = await markTextRead(c.tenant.id, c.params.id, pc.caller.userId)
      return ok(marked ? { ok: true, message: 'Marked read.' } : { message: 'Already read, or not a text staff see.' })
    },
  },
  {
    method: 'POST', path: '/v1/tenants/{slug}/calls', operationId: 'call.parent',
    summary: "Click-to-call: the caller's own phone rings, then the parent's, from the school number. Takes the parent's person id, never a number.",
    permission: 'roster.read',
    allowed: async () => true,
    request: S.obj({ personId: S.str }),
    response: MESSAGE,
    handle: async c => {
      const pc = c as PersonCall
      // Whoever may see a parent's phone may call it — phones are shown to roster.read.
      if (!may(pc.caller, 'roster.read')) return ok({ message: 'Calling parents is for the school’s staff.' })
      const parent = await personFirstNameAndPhone(c.tenant.id, field.str(c.body, 'personId'))
      const to = parent?.phone ? e164(parent.phone, await phoneRules(c.tenant.id)) : null
      if (!parent || !to) return ok({ message: 'This parent has no phone number on record.' })
      // The phone that rings first is the caller's own, as the roster holds it.
      const me = await rosterPersonBySignIn(c.tenant.id, pc.caller.email)
      const from = me?.phone ? e164(me.phone, await phoneRules(c.tenant.id)) : null
      if (!from) return ok({ message: 'Your own phone number is not on the roster, so there is no phone to ring first. Add it to your person record.' })
      try {
        const rule = await phoneRules(c.tenant.id)
        const r = await ports().phone.placeCall(c.tenant.id, from, to, parent.firstName, pc.actor)
        return ok(r.dialled === to
          ? { ok: true, message: `Ringing your phone ${formatPhone(from, rule)} — answer it and ${parent.firstName} is dialled from the school number.` }
          : { ok: true, message: `Ringing your phone ${formatPhone(from, rule)} — off production the test number ${formatPhone(r.dialled, rule)} is dialled, not ${parent.firstName}.` })
      } catch (e) {
        return ok({ message: e instanceof Error ? e.message : String(e) })
      }
    },
  },
]
