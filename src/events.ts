// THE COORDINATOR'S ACTS ON EVENTS (lib/event-writes.ts), asked event.write — event.delete to delete. A field refusal
// comes back in its own words.
import { may } from './access'
import type { PersonCall, Route } from './routes'
import { field, notFound, ok, refused, S } from './op'
import { eventFieldsRefusal, getEvent, listEvents, sessionClasses, type EventFields } from './lib/events'
import { paymentsForEvent } from './lib/event-payments'
import { familyNames } from './lib/enrollment-reads'
import { createEvent, deleteEvent, setCame, setEventClasses, updateEvent } from './lib/event-writes'
import { mailFamilies, rehearsal, rehearsalFacts, withdrawView } from './lib/rehearsal'
import { markRehearsalSent, remindByText, setRehearsalGoogleEvent, setWithdrawKeys, withdrawByKey } from './lib/rehearsal-writes'
import { requireTenant } from './lib/roster-public-url'

const T = '/v1/tenants/{slug}/roster/events'
const FIELDS = S.obj({ title: S.str, date: S.date, startTime: S.nullable(S.str), endTime: S.nullable(S.str), place: S.nullable(S.str), notes: S.nullable(S.str), payUntil: S.nullable(S.date) })

function fieldsOf(b: unknown): EventFields {
  return {
    title: field.str(b, 'title'), date: field.str(b, 'date'), startTime: field.strOrNull(b, 'startTime'), endTime: field.strOrNull(b, 'endTime'),
    place: field.strOrNull(b, 'place'), notes: field.strOrNull(b, 'notes'), payUntil: field.strOrNull(b, 'payUntil'),
  }
}

const P = '/v1/tenants/{slug}/public/withdraw'
/** MARKED public-door: the withdraw link's key is the whole authority. */
const publicDoor = { permission: null, publicDoor: true as const, allowed: async () => false }
const VIEW = S.nullable(S.obj({ child: S.str, title: S.str, when: S.str, withdrawnAt: S.nullable(S.dateTime) }))

export const EVENT_ROUTES: Route[] = [
  // The events reads, asked event.read; the payments and the classes to pick from are answered only to event.write.
  {
    method: 'GET', path: T, operationId: 'event.list',
    summary: "The tenant's events, as a list (src/lib/events.ts EventRow).",
    permission: 'event.read',
    allowed: async c => may(c.caller, 'event.read'),
    response: S.list(S.row('an event (src/lib/events.ts EventRow)')),
    handle: async c => ok(await listEvents(c.tenant.id)),
  },
  {
    method: 'GET', path: `${T}/{id}`, operationId: 'event.get',
    summary: "One event in full (src/lib/events.ts EventDetail); to an event.write caller also its paid payments with their families' names and the session's classes to pick from, else null.",
    permission: 'event.read',
    allowed: async c => may(c.caller, 'event.read'),
    response: S.obj({
      event: S.row('the event (src/lib/events.ts EventDetail)'),
      payments: S.nullable(S.list(S.row('a paid payment (src/lib/event-payments.ts EventPaymentData)'))),
      families: S.list(S.row("a paying family's names (src/lib/family-label.ts FamilyName)")),
      classes: S.nullable(S.list(S.row('a class of the session (src/lib/events.ts ClassChoice)'))),
    }),
    handle: async c => {
      const event = await getEvent(c.tenant.id, c.params.id)
      if (!event) return notFound('no such event')
      const canWrite = may((c as PersonCall).caller, 'event.write')
      const payments = canWrite ? await paymentsForEvent(c.tenant.id, event.id) : null
      return ok({
        event, payments,
        families: payments ? await familyNames(c.tenant.id, payments.map(r => r.familyId)) : [],
        classes: canWrite ? await sessionClasses(c.tenant.id) : null,
      })
    },
  },
  // The rehearsal mail runs' reads: the run asks as the person who pressed, with event.write.
  {
    method: 'GET', path: `${T}/{id}/rehearsal`, operationId: 'rehearsal.facts',
    summary: "What a rehearsal's mails read: the rehearsal, its list's name and performance tasks, its audience with each child's withdraw key and whether they withdrew or came, and the performance day's sheet (src/lib/rehearsal.ts RehearsalFacts); refused in its words when the event is not a rehearsal.",
    permission: 'event.write',
    allowed: async c => may(c.caller, 'event.write'),
    response: S.row("the rehearsal's facts (src/lib/rehearsal.ts RehearsalFacts)"),
    handle: async c => {
      try { return ok(await rehearsalFacts(c.tenant.id, c.params.id)) } catch (e) { return refused(e instanceof Error ? e.message : String(e)) }
    },
  },
  {
    method: 'POST', path: `${T}/{id}/mail-families`, operationId: 'rehearsal.families',
    summary: "The families of these audience children, in the order given: each family's children among them, its addresses for an event mail and whose they are, and its texting block (src/lib/rehearsal.ts MailFamily); a child not of the audience is left out; refused in its words for a child with no family or a school without the roster module. Reads only.",
    permission: 'event.write',
    allowed: async c => may(c.caller, 'event.write'),
    request: S.obj({ personIds: S.list(S.uuid) }),
    response: S.list(S.row("a family's share of the mail (src/lib/rehearsal.ts MailFamily)")),
    handle: async c => {
      const ids = field.obj(c.body).personIds
      const personIds = Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : []
      try { return ok(await mailFamilies(c.tenant.id, c.params.id, personIds)) } catch (e) { return refused(e instanceof Error ? e.message : String(e)) }
    },
  },
  {
    method: 'POST', path: `${P}/view`, operationId: 'withdraw.view',
    summary: 'What a rehearsal withdraw link names — the child, the rehearsal and when, and whether they withdrew; null for a key that is not one. Opening it changes nothing.',
    ...publicDoor,
    request: S.obj({ key: S.str }),
    response: VIEW,
    handle: async c => ok(await withdrawView(field.str(c.body, 'key'))),
  },
  {
    method: 'POST', path: P, operationId: 'withdraw.press',
    summary: "A family's withdraw press: the child withdraws and leaves the calendar event's guests; pressing twice changes nothing. Null for a key that is not one.",
    ...publicDoor,
    request: S.obj({ key: S.str }),
    response: VIEW,
    handle: async c => ok(await withdrawByKey(field.str(c.body, 'key'))),
  },
  {
    method: 'PUT', path: `${T}/{id}/withdraw-keys`, operationId: 'rehearsal.setWithdrawKeys',
    summary: "Children's withdraw keys, kept once their family's invitation has gone (written by the caller that sends the invitations).",
    permission: 'event.write',
    allowed: async c => may(c.caller, 'event.write'),
    request: S.obj({ keys: S.list(S.obj({ personId: S.uuid, key: S.str })) }),
    response: S.obj({}),
    handle: async c => {
      const keys = field.obj(c.body).keys
      if (!Array.isArray(keys)) return refused('keys must be a list')
      await setWithdrawKeys(c.params.id, keys.map(k => ({ personId: field.str(k, 'personId'), key: field.str(k, 'key') })))
      return ok({})
    },
  },
  {
    method: 'PUT', path: `${T}/{id}/sent`, operationId: 'rehearsal.markSent',
    summary: "When a rehearsal's mail went: `which` invited, reminded or assignments.",
    permission: 'event.write',
    allowed: async c => may(c.caller, 'event.write'),
    request: S.obj({ which: S.str }),
    response: S.obj({}),
    handle: async c => {
      const which = field.str(c.body, 'which')
      if (which !== 'invited' && which !== 'reminded' && which !== 'assignments') return refused('which is invited, reminded or assignments')
      await markRehearsalSent(c.params.id, which)
      return ok({})
    },
  },
  {
    method: 'PUT', path: `${T}/{id}/google-event`, operationId: 'rehearsal.setGoogleEvent',
    summary: 'The Google calendar event a rehearsal is on, once the caller sending the invitations made it.',
    permission: 'event.write',
    allowed: async c => may(c.caller, 'event.write'),
    request: S.obj({ googleEventId: S.str }),
    response: S.obj({}),
    handle: async c => {
      await setRehearsalGoogleEvent(c.params.id, field.str(c.body, 'googleEventId'))
      return ok({})
    },
  },
  {
    method: 'POST', path: `${T}/{id}/reminder-texts`, operationId: 'rehearsal.textReminder',
    summary: "The rehearsal's SMS reminder to each number of these people whose texting state is send — one text each through the host's text sender; each refusal reported, with why.",
    permission: 'event.write',
    allowed: async c => may(c.caller, 'event.write'),
    request: S.obj({ personIds: S.list(S.uuid) }),
    response: S.obj({ texted: S.num, textRefused: S.list(S.str) }),
    handle: async c => {
      const report: { texted?: number; textRefused?: string[] } = {}
      await remindByText(await requireTenant(c.tenant.id), await rehearsal(c.tenant.id, c.params.id), field.strs(c.body, 'personIds'), (c as PersonCall).actor, report)
      return ok({ texted: report.texted ?? 0, textRefused: report.textRefused ?? [] })
    },
  },
  {
    method: 'POST', path: T, operationId: 'event.create',
    summary: 'An event scheduled — a record id with its title, date, times, place, notes and last paying day.',
    permission: 'event.write',
    allowed: async c => may(c.caller, 'event.write'),
    request: FIELDS,
    response: S.obj({ id: S.uuid }),
    handle: async c => {
      const f = fieldsOf(c.body)
      const refusal = eventFieldsRefusal(f)
      if (refusal) return refused(refusal)
      return ok({ id: await createEvent(c.tenant.id, f, (c as PersonCall).caller.userId) })
    },
  },
  {
    method: 'PUT', path: `${T}/{id}`, operationId: 'event.update',
    summary: "An event's fields changed.",
    permission: 'event.write',
    allowed: async c => may(c.caller, 'event.write'),
    request: FIELDS,
    response: S.obj({}),
    handle: async c => {
      const f = fieldsOf(c.body)
      const refusal = eventFieldsRefusal(f)
      if (refusal) return refused(refusal)
      await updateEvent(c.tenant.id, c.params.id, f)
      return ok({})
    },
  },
  {
    method: 'DELETE', path: `${T}/{id}`, operationId: 'event.delete',
    summary: 'An event removed, its audience and classes first, then its record id.',
    permission: 'event.delete',
    allowed: async c => may(c.caller, 'event.delete'),
    response: S.obj({}),
    handle: async c => {
      await deleteEvent(c.tenant.id, c.params.id)
      return ok({})
    },
  },
  {
    method: 'PUT', path: `${T}/{id}/classes`, operationId: 'event.pickClasses',
    summary: "An event's classes replaced — this session year's only; their children join the audience, and one no longer in a picked class leaves it unless marked as came.",
    permission: 'event.write',
    allowed: async c => may(c.caller, 'event.write'),
    request: S.obj({ classIds: S.list(S.uuid) }),
    response: S.obj({}),
    handle: async c => {
      try { await setEventClasses(c.tenant.id, c.params.id, field.strs(c.body, 'classIds')) } catch (e) { return refused(e instanceof Error ? e.message : String(e)) }
      return ok({})
    },
  },
  {
    method: 'PUT', path: `${T}/{id}/people/{personId}/came`, operationId: 'event.markCame',
    summary: 'Whether one of the audience came.',
    permission: 'event.write',
    allowed: async c => may(c.caller, 'event.write'),
    request: S.obj({ came: S.bool }),
    response: S.obj({}),
    handle: async c => {
      const came = field.obj(c.body).came
      await setCame(c.tenant.id, c.params.id, c.params.personId, came === true)
      return ok({})
    },
  },
]
