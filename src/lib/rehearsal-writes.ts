// A REHEARSAL'S WRITES, apart from its reads (rehearsal.ts): setting a rehearsal up, what its mails record, and a
// family's withdraw press, whose key is the whole authority.
import type { Actor } from './outward-act'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { db } from './db'
import { eventPeople, events, persons } from '../tables'
import { birthId } from './registry-id'
import { getList } from './volunteering'
import { setEventClasses } from './event-writes'
import { textingStates } from './sms-consent'
import { sendText } from './sms-texts'
import type { Tenant } from './tenant'
import {
  schoolBoardMeet, byKey, invitees, performanceTasks, rehearsal, storeCalendarGuests, when, withdrawView,
  type Rehearsal, type RehearsalFields, type WithdrawView,
} from './rehearsal'
import { syncCalendar } from './rehearsal-calendar'
import { tenantRules } from './rules-context'
import { hostPage, now as hostNow } from './host'
import { schoolWord } from './school-words'

/** A reminder's texts, as the host's mail run reports them: how many were sent, and each number a text was refused
 *  for, with why. */
export type TextReport = { texted?: number; textRefused?: string[] }

/** A rehearsal of this list: an event titled after it, where the school board meets, its audience the ticked classes'
 *  children. Returns the event's id. */
export async function createRehearsal(tenantId: string, listId: string, f: RehearsalFields, classIds: string[], createdBy: string): Promise<string> {
  const list = await getList(tenantId, listId)
  if (!list) throw new Error('That list is not one of this school\'s.')
  if (!classIds.length) throw new Error('Tick the classes to invite.')
  const place = await schoolBoardMeet(tenantId)
  const word = await schoolWord(tenantId, 'rehearsal-word')
  const id = await db.transaction(async tx => {
    const eventId = await birthId(tx, 'event', tenantId)
    await tx.insert(events).values({
      id: eventId, tenantId, title: `${list.root.title} ${word}`, date: f.date, startTime: f.startTime, endTime: f.endTime,
      place, notes: null, createdBy, listId, performanceDate: f.performanceDate,
    })
    return eventId
  })
  await setEventClasses(tenantId, id, classIds)
  return id
}

/** Children's withdraw keys, kept once their family's invitation has gone. */
export async function setWithdrawKeys(eventId: string, keys: { personId: string; key: string }[]): Promise<void> {
  for (const k of keys) {
    await db.update(eventPeople).set({ withdrawKey: k.key }).where(and(eq(eventPeople.eventId, eventId), eq(eventPeople.personId, k.personId)))
  }
}

/** When a rehearsal's mail went. */
export async function markRehearsalSent(eventId: string, which: 'invited' | 'reminded' | 'assignments'): Promise<void> {
  const now = hostNow()
  await db.update(events).set(which === 'invited' ? { invitedAt: now } : which === 'reminded' ? { remindedAt: now } : { assignmentsSentAt: now })
    .where(eq(events.id, eventId))
}

/** The Google calendar event a rehearsal is on. */
export async function setRehearsalGoogleEvent(eventId: string, googleEventId: string): Promise<void> {
  await db.update(events).set({ googleEventId }).where(eq(events.id, eventId))
}

/** The text reminder before a rehearsal — what the email's texting block promises a number whose state is send:
 *  one text to each number of the family's people whose state is send, through the roster's one text sender
 *  (lib/sms-texts.ts), which decides again. Never a group text. A refusal is reported, never thrown: the emails went. */
export async function remindByText(tenant: Tenant, r: Rehearsal, personIds: string[], actor: Actor, report: TextReport): Promise<void> {
  const people = await db.select({ id: persons.id, phone: persons.phone }).from(persons)
    .where(and(eq(persons.tenantId, tenant.id), inArray(persons.id, personIds), isNull(persons.deletedAt)))
  const states = await textingStates(tenant.id, people)
  const body = `${tenant.longName}: reminder — ${r.title}, ${when(r, (await tenantRules(tenant.id)).locale.language)}. Reply STOP to opt out.`
  const sentBy = 'person' in actor ? actor.person.userId : null
  for (const [personId, s] of states) {
    if (s.state !== 'send') continue
    try {
      await sendText(tenant, personId, body, actor, sentBy)
      report.texted = (report.texted ?? 0) + 1
    } catch (e) {
      report.textRefused = [...(report.textRefused ?? []), `…${s.phone.slice(-4)}: ${e instanceof Error ? e.message : String(e)}`]
    }
  }
}

/** The family's press: the child withdraws, and leaves the calendar event's guests (with the parents, when no other
 *  child of theirs is still coming). Pressing twice changes nothing. */
export async function withdrawByKey(key: string): Promise<WithdrawView | null> {
  const row = await byKey(key)
  if (!row) return null
  if (!row.withdrawnAt) {
    await db.update(eventPeople).set({ withdrawnAt: hostNow() })
      .where(and(eq(eventPeople.withdrawKey, key), isNull(eventPeople.withdrawnAt)))
    const r = await rehearsal(row.tenantId, row.eventId)
    if (r.googleEventId) {
      const { tasks } = await performanceTasks(row.tenantId, r.listId)
      // THE KEY IS THE WHOLE AUTHORITY: the act is recorded under the open page and the key it issued,
      // never under whoever happens to be signed in to the host — and so view-as never touches it.
      const actor: Actor = { page: hostPage('withdraw'), event: 'withdraw press', caller: `withdraw key …${key.slice(-4)}` }
      await syncCalendar(r, await storeCalendarGuests(row.tenantId, await invitees(row.tenantId, row.eventId)), tasks, actor, id => setRehearsalGoogleEvent(r.id, id))
    }
  }
  return withdrawView(key)
}
