// A PARENT'S YES OR NO TO TEXT MESSAGES, WRITTEN: the roster's texts, intake and inbound-text doors call these; the
// readers of texting states (sms-consent.ts) write nothing.
import { and, eq, isNull } from 'drizzle-orm'
import { db } from './db'
import { now } from './host'
import { smsConsents, smsOptOuts } from '../tables'
import { consentText } from './sms-words'
import { schoolWord } from './school-words'

/** The one writer of a yes — the person's own switch, a self-registration inside its own transaction, so a
 *  registration that fails leaves no consent behind, and a START texted from the number, which records its own words. A yes withdraws the same person's opt-out for the same number. */
export async function optIn(tenantId: string, personId: string, phone: string, school: string,
                            tx: Pick<typeof db, 'select' | 'insert' | 'update'> = db, given?: string): Promise<void> {
  const words = given ?? consentText(school, await schoolWord(tenantId, 'texting-topics'))
  await tx.update(smsOptOuts).set({ withdrawnAt: now() })
    .where(and(eq(smsOptOuts.tenantId, tenantId), eq(smsOptOuts.personId, personId), eq(smsOptOuts.phone, phone), isNull(smsOptOuts.withdrawnAt)))
  const [live] = await tx.select({ id: smsConsents.id }).from(smsConsents)
    .where(and(eq(smsConsents.tenantId, tenantId), eq(smsConsents.personId, personId), eq(smsConsents.phone, phone), isNull(smsConsents.optedOutAt)))
  if (live) return
  await tx.insert(smsConsents).values({ tenantId, personId, phone, consentText: words })
}

/** A START texted from `phone`: a yes for the person who holds it, in the words START carries. */
export async function optInByNumber(tenantId: string, personId: string, phone: string, school: string): Promise<void> {
  await optIn(tenantId, personId, phone, school, db, `START — ${consentText(school, await schoolWord(tenantId, 'texting-topics'))}`)
}

/** A STOP texted from `phone`: every live consent for that number ends, whoever's it is. */
export async function optOutByNumber(tenantId: string, phone: string): Promise<void> {
  await db.update(smsConsents).set({ optedOutAt: now(), optedOutVia: 'stop' })
    .where(and(eq(smsConsents.tenantId, tenantId), eq(smsConsents.phone, phone), isNull(smsConsents.optedOutAt)))
}

/** A person's "no" to the invitation to text — an opt-out. It records no consent; the invitation in
 *  their emails stops. */
export async function declineTexts(tenantId: string, personId: string, phone: string): Promise<void> {
  const [live] = await db.select({ id: smsOptOuts.id }).from(smsOptOuts)
    .where(and(eq(smsOptOuts.tenantId, tenantId), eq(smsOptOuts.personId, personId), eq(smsOptOuts.phone, phone), isNull(smsOptOuts.withdrawnAt)))
  if (live) return
  await db.insert(smsOptOuts).values({ tenantId, personId, phone })
}

/** A person's own opt-out at the host's switch, stored under the host's word for that switch. */
export async function optOut(tenantId: string, personId: string): Promise<void> {
  const via = await schoolWord(tenantId, 'opt-out-source')
  await db.update(smsConsents).set({ optedOutAt: now(), optedOutVia: via })
    .where(and(eq(smsConsents.tenantId, tenantId), eq(smsConsents.personId, personId), isNull(smsConsents.optedOutAt)))
}
