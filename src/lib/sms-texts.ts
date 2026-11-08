// TEXTING IN THE ROSTER — the rules. Twilio's own calls are the host's phone port; here is who may be texted, what an
// incoming text does, and what staff are shown.
//
// The rules: the number is for participants only — a participant is whoever is in the three-universes
// map; a text from anyone else is kept, NEVER shown to staff, and answered by the one fixed reply at most once
// in the school's `autoReplyDays`; staff texts are new texts and need the person's own yes; there is no group text.
import { and, desc, eq, gte, isNull, sql } from 'drizzle-orm'
import { db } from './db'
import { persons, smsConsents, smsMessages } from '../tables'
import { e164 } from './phone-e164'
import { phoneRules, tenantRules } from './rules-context'
import { ports } from '../ports'
import { participants } from './three-universes-words'
import { runThreeUniverses } from './three-universes-load'
import { consentStates, saidStop } from './sms-consent'
import { optInByNumber, optOutByNumber } from './sms-consent-writes'
import { catalogValue } from './message-catalog'
import { dowryValueOrNull } from './dowry'
import { rosterPublicUrl } from './roster-public-url'
import { hostRoute, now } from './host'
import type { Tenant } from './tenant'
import type { Actor } from './outward-act'
import { deliverText, schoolNumber, type DecidedText } from './phone'
import { TEXT_MAX_CHARS } from './texting-limits'

/** A staff text this module refuses to send, and why. */
export class TextRefused extends Error {}


/** Whose number it is: the live person whose phone's last national-number digits (the school's phone rule) are the
 *  number's. At most one; null when none. */
export async function personByNumber(tenantId: string, number: string): Promise<{ id: string; firstName: string; phone: string | null } | null> {
  // The last national-number digits (the school's phone rule) identify the number.
  const digits = (await tenantRules(tenantId)).locale.phone.nationalDigits
  const tail = number.replace(/\D/g, '').slice(-digits)
  const [p] = await db.select({ id: persons.id, firstName: persons.firstName, phone: persons.phone }).from(persons)
    .where(and(eq(persons.tenantId, tenantId), sql`${persons.deletedAt} IS NULL`,
      sql`right(regexp_replace(${persons.phone}, '\\D', '', 'g'), ${digits}) = ${tail}`))
    .limit(1)
  return p ?? null
}

/** In the map? Null when the run refused — a refused run names nobody, and nothing is decided on it. */
async function inMap(tenantId: string, personId: string): Promise<boolean | null> {
  const set = participants(await runThreeUniverses(tenantId))
  return set ? set.has(personId) : null
}

/** The rule for a text staff start, from the facts — pure. */
export function decideNew(f: { name: string; inMap: boolean | null; consentRow: string | null; saidStop: boolean }):
  { ok: true; consentRow: string } | { ok: false; refused: string } {
  if (f.saidStop) return { ok: false, refused: `${f.name} texted STOP` }
  if (f.inMap === null) return { ok: false, refused: 'This year\'s map is refused, so nobody can be texted until it runs clean' }
  if (!f.inMap) return { ok: false, refused: `${f.name} is not in this year's map` }
  if (!f.consentRow) return { ok: false, refused: `${f.name} has not turned on school texts` }
  return { ok: true, consentRow: f.consentRow }
}

/** The live consent row for the person's CURRENT number, or null (consentStates' rule: an old number's yes is not one). */
async function liveConsentRow(tenantId: string, personId: string, phone: string | null): Promise<string | null> {
  const number = phone ? e164(phone, await phoneRules(tenantId)) : null
  if (!number) return null
  const [row] = await db.select({ id: smsConsents.id }).from(smsConsents)
    .where(and(eq(smsConsents.tenantId, tenantId), eq(smsConsents.personId, personId), eq(smsConsents.phone, number), sql`${smsConsents.optedOutAt} IS NULL`))
    .limit(1)
  return row?.id ?? null
}

type Person = { id: string; firstName: string; phone: string | null }

async function personById(tenantId: string, personId: string): Promise<Person | null> {
  const [p] = await db.select({ id: persons.id, firstName: persons.firstName, phone: persons.phone }).from(persons)
    .where(and(eq(persons.id, personId), eq(persons.tenantId, tenantId), sql`${persons.deletedAt} IS NULL`)).limit(1)
  return p ?? null
}

async function decideFor(tenantId: string, p: Person) {
  const number = p.phone ? e164(p.phone, await phoneRules(tenantId)) : null
  if (!number) return { number: null, decision: { ok: false as const, refused: `${p.firstName} has no phone number` } }
  const decision = decideNew({
    name: p.firstName,
    inMap: await inMap(tenantId, p.id),
    consentRow: await liveConsentRow(tenantId, p.id, p.phone),
    saidStop: await saidStop(tenantId, number),
  })
  return { number, decision }
}

/** What sendText would do, sending nothing — the screen shows this. */
export async function previewText(tenantId: string, personId: string): Promise<{ ok: true } | { ok: false; refused: string }> {
  const p = await personById(tenantId, personId)
  if (!p) return { ok: false, refused: 'No such person in this school' }
  const { decision } = await decideFor(tenantId, p)
  return decision.ok ? { ok: true } : decision
}

async function statusCallback(tenant: Tenant): Promise<string | null> {
  // Asked for only where the host says the provider can reach this deployment (host.smsCallbacks).
  return ports().host.smsCallbacks() ? `${await rosterPublicUrl(tenant)}${hostRoute('sms-status')}` : null
}

/** A staff text to one person: a new text, decided here — never by the caller. Refused by name. */
export async function sendText(tenant: Tenant, personId: string, body: string, actor: Actor, sentBy: string | null): Promise<void> {
  const text = body.trim()
  if (!text) throw new TextRefused('The text is empty')
  if (text.length > TEXT_MAX_CHARS) throw new TextRefused(`A text is at most ${TEXT_MAX_CHARS} characters`)
  const p = await personById(tenant.id, personId)
  if (!p) throw new TextRefused('No such person in this school')
  const { number, decision } = await decideFor(tenant.id, p)
  if (!decision.ok || !number) throw new TextRefused(decision.ok ? 'No number' : decision.refused)
  const decided: DecidedText = { to: number, kind: 'new', consent: { by: 'texting-consent', whose: p.id, row: decision.consentRow }, statusCallback: await statusCallback(tenant) }
  const { sid, sentTo } = await deliverText(tenant.id, decided, text, actor)
  await recordOut(tenant.id, sid, number, sentTo, text, p.id, 'new', sentBy)
}

async function recordOut(tenantId: string, sid: string, to: string, sentTo: string, body: string, personId: string | null, kind: 'new' | 'auto', sentBy: string | null) {
  await db.insert(smsMessages).values({
    tenantId, direction: 'out', messageSid: sid, fromNumber: await schoolNumber(), toNumber: sentTo,
    intendedTo: sentTo === to ? null : to, body, personId, kind, sentBy, status: 'queued', sentAt: now(),
    shown: kind === 'new',
  })
}

/** The one fixed reply: <School> and <website> filled from the tenant; the website without its scheme. */
export async function autoReplyText(tenant: Tenant): Promise<string> {
  const template = await catalogValue(tenant.id, 'sms-auto-reply')
  const website = await dowryValueOrNull(tenant.id, 'website')
  if (!website) throw new Error("The tenant's configuration has no website value, which the automatic reply names")
  return template.replaceAll('<School>', tenant.longName).replaceAll('<website>', website.replace(/^https?:\/\//, '').replace(/\/$/, ''))
}

/** Did this number get the reply within the school's `autoReplyDays`? Off production the reply went to the host's test recipient; its intended number counts. */
async function repliedLately(tenantId: string, number: string): Promise<boolean> {
  // At most one automatic reply to a number in the school's `autoReplyDays`.
  const days = (await tenantRules(tenantId)).codes.autoReplyDays
  const since = new Date(ports().clock.now().getTime() - days * 86_400_000)
  const [row] = await db.select({ id: smsMessages.id }).from(smsMessages)
    .where(and(eq(smsMessages.tenantId, tenantId), eq(smsMessages.direction, 'out'), eq(smsMessages.kind, 'auto'),
      sql`coalesce(${smsMessages.intendedTo}, ${smsMessages.toNumber}) = ${number}`, gte(smsMessages.sentAt, since)))
    .limit(1)
  return !!row
}

async function autoReply(tenant: Tenant, number: string): Promise<void> {
  if (await repliedLately(tenant.id, number)) return
  const body = await autoReplyText(tenant)
  const actor: Actor = { page: hostRoute('sms-inbound'), event: 'unconsented text', caller: `…${number.slice(-4)}` }
  const decided: DecidedText = { to: number, kind: 'auto', consent: { by: 'implied', whose: `…${number.slice(-4)}` }, statusCallback: await statusCallback(tenant) }
  const { sid, sentTo } = await deliverText(tenant.id, decided, body, actor)
  await recordOut(tenant.id, sid, number, sentTo, body, null, 'auto', null)
}

export type InboundAct = 'end-consent' | 'nothing' | 'record-consent' | 'reply' | 'show'

/** What an incoming text does, from the facts; pure. `mapped` null = the map refused. */
export function inboundAct(f: { keyword: 'STOP' | 'START' | 'HELP' | null; person: boolean; mapped: boolean | null; consented: boolean }): InboundAct {
  if (f.keyword === 'STOP') return 'end-consent'        // Twilio has confirmed; nothing is sent
  if (f.keyword === 'HELP') return 'nothing'            // Twilio has answered
  if (f.mapped === null) return 'nothing'               // the map is refused: kept, shown to no one, no reply
  const participant = f.person && f.mapped
  if (f.keyword === 'START') return participant ? 'record-consent' : 'reply'
  return participant && f.consented ? 'show' : 'reply'
}

/** Kept rows that staff see: a participant's own text while their texts are on, and the STOP that ends it. */
export function shownOnArrival(f: { keyword: 'STOP' | 'START' | 'HELP' | null; consented: boolean }): boolean {
  return f.consented && (f.keyword === null || f.keyword === 'STOP')
}

/** What an incoming text does (inboundAct). Every text is kept; a retry writes nothing. */
export async function receiveText(tenant: Tenant, p: Record<string, string>): Promise<void> {
  const from = p.From ?? ''
  const keyword = (['STOP', 'START', 'HELP'] as const).find(k => k === p.OptOutType) ?? null
  const person = from ? await personByNumber(tenant.id, from) : null
  const mapped = person ? await inMap(tenant.id, person.id) : false
  const on = person && mapped ? (await consentStates(tenant.id, [person])).get(person.id) : undefined
  const consented = !!on?.since && on.phone === from
  const kept = await db.insert(smsMessages).values({
    tenantId: tenant.id, direction: 'in', messageSid: p.MessageSid, fromNumber: from, toNumber: p.To ?? '',
    body: p.Body ?? '', numMedia: Number(p.NumMedia ?? 0) || 0, optOutType: keyword, personId: person?.id ?? null,
    receivedAt: now(),
    shown: shownOnArrival({ keyword, consented }),
  }).onConflictDoNothing().returning({ id: smsMessages.id })
  if (kept.length === 0) return   // a retry of a text already kept

  switch (inboundAct({ keyword, person: !!person, mapped, consented })) {
    case 'end-consent': await optOutByNumber(tenant.id, from); return
    case 'record-consent': await optInByNumber(tenant.id, person!.id, from, tenant.longName); return
    case 'reply': await autoReply(tenant, from); return
    case 'show': case 'nothing': return
  }
}

const RANK: Record<string, number> = { accepted: 0, scheduled: 0, queued: 0, sending: 1, sent: 2, delivered: 3, failed: 4, undelivered: 4 }

/** Does Twilio's status move the text forward? Final statuses never move; an unknown one never does. Pure. */
export function statusMoves(now: string | null, next: string): boolean {
  const a = RANK[now ?? ''] ?? -1
  const b = RANK[next] ?? -1
  return a < 4 && b > a
}

/** Twilio's word on a text it sent — forward only, so a late 'sent' cannot undo a 'delivered'. */
export async function updateStatus(tenantId: string, sid: string, status: string, errorCode: string | null): Promise<void> {
  const [row] = await db.select({ id: smsMessages.id, status: smsMessages.status }).from(smsMessages)
    .where(and(eq(smsMessages.tenantId, tenantId), eq(smsMessages.messageSid, sid))).limit(1)
  if (!row || !statusMoves(row.status, status)) return
  await db.update(smsMessages).set({ status, errorCode }).where(eq(smsMessages.id, row.id))
}

export type ThreadRow = { id: string; direction: 'in' | 'out'; body: string; numMedia: number; at: Date; status: string | null; errorCode: string | null; intendedTo: string | null }

/** A participant's thread, oldest first — shown to staff only while they are in the map with texts on (shownToStaff). */
export async function thread(tenantId: string, personId: string): Promise<ThreadRow[]> {
  const rows = await db.select({
    id: smsMessages.id, direction: smsMessages.direction, body: smsMessages.body, numMedia: smsMessages.numMedia,
    receivedAt: smsMessages.receivedAt, sentAt: smsMessages.sentAt, createdAt: smsMessages.createdAt,
    status: smsMessages.status, errorCode: smsMessages.errorCode, intendedTo: smsMessages.intendedTo,
  }).from(smsMessages)
    .where(and(eq(smsMessages.tenantId, tenantId), eq(smsMessages.personId, personId), eq(smsMessages.shown, true)))
    .orderBy(smsMessages.createdAt)
  return rows.map(r => ({ id: r.id, direction: r.direction, body: r.body, numMedia: r.numMedia, at: r.receivedAt ?? r.sentAt ?? r.createdAt,
    status: r.status, errorCode: r.errorCode, intendedTo: r.intendedTo }))
}

/** Shown to staff: in the map, and texts on for the number the roster holds today. */
export async function shownToStaff(tenantId: string, person: { id: string; phone: string | null }): Promise<boolean> {
  if (!(await inMap(tenantId, person.id))) return false
  return !!(await liveConsentRow(tenantId, person.id, person.phone))
}

export type FamilyThread = { personId: string; name: string; phone: string | null; rows: ThreadRow[]; refused: string | null }

/** A family's texts: one thread per person of the family shown to staff, with what a send would answer. */
export async function familyTexts(tenantId: string, familyId: string, canSend: boolean): Promise<FamilyThread[]> {
  const people = await db.select({ id: persons.id, firstName: persons.firstName, lastName: persons.lastName, phone: persons.phone })
    .from(persons).where(and(eq(persons.tenantId, tenantId), eq(persons.familyId, familyId), sql`${persons.deletedAt} IS NULL`))
  const out: FamilyThread[] = []
  for (const p of people) {
    if (!(await shownToStaff(tenantId, p))) continue
    const preview = canSend ? await previewText(tenantId, p.id) : null
    out.push({ personId: p.id, name: [p.firstName, p.lastName].filter(Boolean).join(' '), phone: p.phone,
      rows: await thread(tenantId, p.id), refused: preview && !preview.ok ? preview.refused : null })
  }
  return out
}

// ── Unread texts for the principal ────────────────────────────────────────────────────────────────────
// The principal sees every unread text, to mark read or respond to from
// there. The read mark is the school's — one per text, whoever handled it. Unread is read by the SAME reader as a
// family's texts: a kept, shown, unmarked incoming text whose sender is shown to staff today (in the map, texts on), so
// a sender who since turned texts off leaves this list as they leave the family's.

/** The rule — pure. `senderShown` is shownToStaff()'s answer for the sender today. */
export function isUnread(r: { direction: 'in' | 'out'; shown: boolean; readAt: Date | null; senderShown: boolean }): boolean {
  return r.direction === 'in' && r.shown && r.readAt === null && r.senderShown
}

export type UnreadText = {
  id: string; at: Date; personId: string; name: string; familyId: string | null; body: string; numMedia: number
  /** Why a reply would be refused (decideNew's words — "<name> texted STOP" for the STOP that ends a consent); null = may reply. */
  refused: string | null
}

/** Every unread text, newest first. The three universes run ONCE for the listing; consent and STOP are read once per sender. */
export async function unreadTexts(tenantId: string): Promise<UnreadText[]> {
  const rows = await db.select({
    id: smsMessages.id, body: smsMessages.body, numMedia: smsMessages.numMedia, receivedAt: smsMessages.receivedAt,
    createdAt: smsMessages.createdAt, personId: persons.id, firstName: persons.firstName, lastName: persons.lastName,
    phone: persons.phone, familyId: persons.familyId,
  }).from(smsMessages).innerJoin(persons, eq(persons.id, smsMessages.personId))
    .where(and(eq(smsMessages.tenantId, tenantId), eq(smsMessages.direction, 'in'), eq(smsMessages.shown, true),
      isNull(smsMessages.readAt), sql`${persons.deletedAt} IS NULL`))
    .orderBy(desc(smsMessages.createdAt))
  if (rows.length === 0) return []

  const set = participants(await runThreeUniverses(tenantId))
  const facts = new Map<string, { consentRow: string | null; saidStop: boolean }>()
  const out: UnreadText[] = []
  for (const r of rows) {
    let f = facts.get(r.personId)
    if (!f) {
      const number = r.phone ? e164(r.phone, await phoneRules(tenantId)) : null
      f = { consentRow: await liveConsentRow(tenantId, r.personId, r.phone), saidStop: number ? await saidStop(tenantId, number) : false }
      facts.set(r.personId, f)
    }
    const senderShown = !!set?.has(r.personId) && f.consentRow !== null
    if (!isUnread({ direction: 'in', shown: true, readAt: null, senderShown })) continue
    const decision = decideNew({ name: r.firstName, inMap: set ? set.has(r.personId) : null, consentRow: f.consentRow, saidStop: f.saidStop })
    out.push({ id: r.id, at: r.receivedAt ?? r.createdAt, personId: r.personId, name: [r.firstName, r.lastName].filter(Boolean).join(' '),
      familyId: r.familyId, body: r.body, numMedia: r.numMedia, refused: decision.ok ? null : decision.refused })
  }
  return out
}

/** The school's read mark: set once, on an incoming shown text not yet marked. False when no such row — already read, or not a text staff see. */
export async function markTextRead(tenantId: string, id: string, userId: string): Promise<boolean> {
  const marked = await db.update(smsMessages).set({ readAt: now(), readBy: userId })
    .where(and(eq(smsMessages.tenantId, tenantId), eq(smsMessages.id, id), eq(smsMessages.direction, 'in'),
      eq(smsMessages.shown, true), isNull(smsMessages.readAt)))
    .returning({ id: smsMessages.id })
  return marked.length > 0
}
