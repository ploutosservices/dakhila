// A PARENT'S OWN YES TO TEXT MESSAGES, for their own number: each parent for their number.
// The words (sms-words.ts) are what the carriers are told a parent sees, and what the consent row records verbatim.
import { and, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import { db } from './db'
import { persons, smsConsents, smsMessages, smsOptOuts } from '../tables'
import { e164 } from './phone-e164'
import { phoneRules } from './rules-context'
import { consentText, type TextingState } from './sms-words'

// The words a parent sees live in a file with no store (sms-words.ts), so a reader drawing them reaches no texting table.
export { consentText, confirmationText, type TextingState } from './sms-words'

export type ConsentState = { phone: string | null; since: Date | null }

/** Each person's live consent — on only while it is for the number the roster holds for them today. */
export async function consentStates(tenantId: string, people: { id: string; phone: string | null }[]): Promise<Map<string, ConsentState>> {
  const ids = people.map(p => p.id)
  const rows = ids.length === 0 ? [] : await db.select({ personId: smsConsents.personId, phone: smsConsents.phone, at: smsConsents.optedInAt })
    .from(smsConsents)
    .where(and(eq(smsConsents.tenantId, tenantId), inArray(smsConsents.personId, ids), isNull(smsConsents.optedOutAt)))
  const out = new Map<string, ConsentState>()
  const rule = await phoneRules(tenantId)
  for (const p of people) {
    const phone = p.phone ? e164(p.phone, rule) : null
    const live = rows.find(r => r.personId === p.id && r.phone === phone)
    out.set(p.id, { phone, since: live?.at ?? null })
  }
  return out
}

/** The roster person whose address is the sign-in's (any case), with the phone the roster holds for them. */
export async function rosterPersonBySignIn(tenantId: string, email: string): Promise<{ id: string; phone: string | null } | null> {
  const [me] = await db.select({ id: persons.id, phone: persons.phone }).from(persons)
    .where(and(sql`lower(${persons.email}) = ${email.toLowerCase()}`, eq(persons.tenantId, tenantId), isNull(persons.deletedAt))).limit(1)
  return me ?? null
}

/** A live person's first name and the phone the roster holds for them; null when not the tenant's. */
export async function personFirstNameAndPhone(tenantId: string, personId: string): Promise<{ firstName: string; phone: string | null } | null> {
  const [parent] = await db.select({ firstName: persons.firstName, phone: persons.phone }).from(persons)
    .where(and(eq(persons.id, personId), eq(persons.tenantId, tenantId), isNull(persons.deletedAt))).limit(1)
  return parent ?? null
}

// The consent writes (a yes, a STOP, a no, an opt-out) are sms-consent-writes.ts, which only the roster API's code
// calls, so a reader of texting states reaches no write.

/** The number said STOP: its latest incoming keyword is STOP, with no START after it. Computed, never stored. */
export async function saidStop(tenantId: string, number: string): Promise<boolean> {
  const [last] = await db.select({ t: smsMessages.optOutType }).from(smsMessages)
    .where(and(eq(smsMessages.tenantId, tenantId), eq(smsMessages.direction, 'in'), eq(smsMessages.fromNumber, number),
      isNotNull(smsMessages.optOutType), sql`${smsMessages.optOutType} <> 'HELP'`))
    .orderBy(desc(smsMessages.createdAt)).limit(1)
  return last?.t === 'STOP'
}

/** The three states of a number: send SMS, do not send SMS, ask whether to send or not. */

/** The state from the facts, for the number the roster holds today — pure. */
export function textingState(f: { live: boolean; ended: boolean; optedOut: boolean; stopped: boolean }): TextingState {
  if (f.live) return 'send'
  if (f.optedOut || f.ended || f.stopped) return 'do-not-send'
  return 'ask'
}

/** Each person's state — the one reader every screen and email shares. No number: absent from the map. */
export async function textingStates(tenantId: string, people: { id: string; phone: string | null }[]): Promise<Map<string, { phone: string; state: TextingState }>> {
  const rule = await phoneRules(tenantId)
  const withNumber = people.map(p => ({ id: p.id, phone: p.phone ? e164(p.phone, rule) : null })).filter((p): p is { id: string; phone: string } => !!p.phone)
  const ids = withNumber.map(p => p.id)
  const [consents, optOuts] = ids.length === 0 ? [[], []] : await Promise.all([
    db.select({ personId: smsConsents.personId, phone: smsConsents.phone, out: smsConsents.optedOutAt }).from(smsConsents)
      .where(and(eq(smsConsents.tenantId, tenantId), inArray(smsConsents.personId, ids))),
    db.select({ personId: smsOptOuts.personId, phone: smsOptOuts.phone }).from(smsOptOuts)
      .where(and(eq(smsOptOuts.tenantId, tenantId), inArray(smsOptOuts.personId, ids), isNull(smsOptOuts.withdrawnAt))),
  ])
  const out = new Map<string, { phone: string; state: TextingState }>()
  for (const p of withNumber) {
    const mine = consents.filter(c => c.personId === p.id && c.phone === p.phone)
    out.set(p.id, { phone: p.phone, state: textingState({
      live: mine.some(c => !c.out),
      ended: mine.some(c => !!c.out),
      optedOut: optOuts.some(o => o.personId === p.id && o.phone === p.phone),
      stopped: await saidStop(tenantId, p.phone),
    }) })
  }
  return out
}
