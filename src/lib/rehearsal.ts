// A REHEARSAL AND ITS PERFORMANCE. A rehearsal is a Google Meet on the school board's classroom on a given day.
// Besides the rehearsal date there is a performance date, typically the class day following it. The students who
// show up for rehearsal are assigned one or more pieces. A student can withdraw from a rehearsal; one who withdraws
// loses their spot on the invitation list.
//
// A rehearsal is an event (events.ts) that names a list and a performance day; the performance is that list's
// day (volunteering.ts). This file holds what joins them: setting one up, the invitation (a Google Calendar
// invitation where the host makes one, an email per family always), the withdraw key, the reminder, the assignments email, and who may be
// put on the performance day.
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { db } from './db'
import { eventPeople, events, persons } from '../tables'
import { academicYearOf } from './year-context'
import { familyRecipientPeople } from './family-recipients'
import { smsPreferenceBlock, type Block } from './sms-preference-block'
import type { Tenant } from './tenant'
import { schoolBoardCourseId, classroomLinks } from './classroom-links'
import { getTenantById } from './tenant'
import { daySheet, getList, type DaySheet, type TaskNode } from './volunteering'
import { rosterOn } from './modules'
import { fullName, nextRehearsalDay, performanceDayAfter, when } from './rehearsal-words'
import { schoolTimezone } from './rehearsal-calendar'
import { calendarRules, nameOrder, tenantRules } from './rules-context'
import { ports } from '../ports'

const DATE = /^\d{4}-\d{2}-\d{2}$/
const TIME = /^\d{2}:\d{2}$/

// The days and their words are rehearsal-words.ts; the calendar write is rehearsal-calendar.ts; the three mails are the
// host's jobs. Re-exported here for the callers that name them from this file.
export { longDate, nextRehearsalDay, performanceDayAfter, when } from './rehearsal-words'
export { syncCalendar } from './rehearsal-calendar'

// ── Setting one up ──────────────────────────────────────────────────────────

export type RehearsalFields = { date: string; performanceDate: string; startTime: string | null; endTime: string | null }

export function rehearsalFieldsRefusal(f: RehearsalFields): string | null {
  if (!DATE.test(f.date)) return 'Pick the rehearsal\'s date.'
  if (!DATE.test(f.performanceDate)) return 'Pick the performance\'s date.'
  if (f.performanceDate <= f.date) return 'The performance is after the rehearsal.'
  if (f.startTime && !TIME.test(f.startTime)) return 'A start time is HH:MM.'
  if (f.endTime && !TIME.test(f.endTime)) return 'An end time is HH:MM.'
  if (f.startTime && f.endTime && f.endTime <= f.startTime) return 'The rehearsal ends before it starts.'
  return null
}

/** What the set-up form starts from: the next rehearsal day, and the class day after it. */
export async function rehearsalDefaults(tenantId: string): Promise<{ date: string; performanceDate: string }> {
  const [calendar, zone] = await Promise.all([calendarRules(tenantId), schoolTimezone(tenantId)])
  const date = nextRehearsalDay(calendar, zone, ports().clock.now())
  return { date, performanceDate: performanceDayAfter(calendar, date) }
}

/** The school board's Meet address, from the tenant's designated board; null when there is none. */
async function schoolBoardMeet(tenantId: string): Promise<string | null> {
  const courseId = await schoolBoardCourseId(tenantId)
  return courseId ? (await classroomLinks(courseId)).meetUrl : null
}

/** The school board's Meet address — where a new rehearsal meets (rehearsal-writes.ts createRehearsal). */
export { schoolBoardMeet }

/** What a rehearsal's mails write to the roster — when each mail went, a child's withdraw key, the calendar event's
 *  id, and the reminder's texts. The mails are the host's jobs; the roster API
 *  makes these writes for them, so they come in from the job. */
export type RehearsalWrites = {
  setWithdrawKeys(keys: { personId: string; key: string }[]): Promise<void>
  markSent(which: 'invited' | 'reminded' | 'assignments'): Promise<void>
  setGoogleEvent(googleEventId: string): Promise<void>
  textReminder(personIds: string[]): Promise<{ texted: number; textRefused: string[] }>
}

export type RehearsalRow = { id: string; date: string; performanceDate: string; classes: string; audience: number; withdrew: number; came: number; invited: string | null }

/** This list's rehearsals, newest first. */
export async function listRehearsals(tenantId: string, listId: string): Promise<RehearsalRow[]> {
  const rows = (await db.execute(sql`
    select e.id, e.date::text as date, e.performance_date::text as performance_date, e.invited_at,
           coalesce((select string_agg(concat_ws(' ', c.short_code, ac.section), ', ' order by c.department, c.level)
             from event_classes ec join roster_available_classes ac on ac.id = ec.class_id
             left join roster_course_catalog c on c.id = ac.course_id where ec.event_id = e.id), '') as classes,
           (select count(*) from event_people p where p.event_id = e.id)::int as audience,
           (select count(*) from event_people p where p.event_id = e.id and p.withdrawn_at is not null)::int as withdrew,
           (select count(*) from event_people p where p.event_id = e.id and p.came)::int as came
      from events e where e.tenant_id = ${tenantId} and e.list_id = ${listId}
     order by e.date desc`)).rows as { id: string; date: string; performance_date: string; invited_at: Date | string | null; classes: string; audience: number; withdrew: number; came: number }[]
  return rows.map(r => ({
    id: r.id, date: r.date, performanceDate: r.performance_date, classes: r.classes, audience: r.audience, withdrew: r.withdrew, came: r.came,
    invited: r.invited_at ? new Date(r.invited_at).toISOString() : null,
  }))
}

// ── The rehearsal and its people ────────────────────────────────────────────

export type Rehearsal = {
  id: string; tenantId: string; title: string; date: string; startTime: string | null; endTime: string | null; place: string | null
  listId: string; performanceDate: string; googleEventId: string | null
}
/** `withdrawnAt` is a Date from the store and an ISO string through the roster API; only its presence is read. */
export type Invitee = { personId: string; firstName: string | null; lastName: string | null; familyId: string | null; email: string | null; key: string | null; withdrawnAt: Date | string | null; came: boolean }

/** What a rehearsal's mails read of the roster: the rehearsal, its list's performance tasks, its audience, and the
 *  performance day's sheet. */
export type RehearsalFacts = { rehearsal: Rehearsal; list: string; tasks: TaskNode[]; invitees: Invitee[]; sheet: DaySheet | null }

/** One family's share of a mail, as the roster gives it: which of the children asked about are its, its `event`
 *  addresses, whose they are, and the texting block for them. */
export type MailFamily = { familyId: string; childIds: string[]; to: string[]; people: string[]; block: Block | null }

/** What a rehearsal's mails read: the mails are the host's
 *  jobs, and the roster API answers these reads for them, as RehearsalWrites makes their writes. */
export type RehearsalReads = {
  facts(): Promise<RehearsalFacts>
  /** The families of these audience children, in the order given. */
  families(personIds: string[]): Promise<MailFamily[]>
}

/** A rehearsal's facts, from the store (the roster API's rehearsal.facts). */
export async function rehearsalFacts(tenantId: string, eventId: string): Promise<RehearsalFacts> {
  const r = await rehearsal(tenantId, eventId)
  const { list, tasks } = await performanceTasks(tenantId, r.listId)
  return { rehearsal: r, list, tasks, invitees: await invitees(tenantId, eventId), sheet: await daySheet(tenantId, r.listId, r.performanceDate) }
}

/** The families of these audience children, from the store (the roster API's rehearsal.families): each with its texting
 *  block. A child not of the audience is left out. */
export async function mailFamilies(tenantId: string, eventId: string, personIds: string[]): Promise<MailFamily[]> {
  const byId = new Map((await invitees(tenantId, eventId)).map(p => [p.personId, p]))
  const kids = personIds.map(id => byId.get(id)).filter((p): p is Invitee => !!p)
  const tenant = await requireSchool(tenantId)
  const out: MailFamily[] = []
  for (const g of await byFamily(tenantId, kids)) {
    out.push({ familyId: g.familyId, childIds: g.children.map(c => c.personId), to: g.to, people: g.people, block: await smsPreferenceBlock(tenant, g.people) })
  }
  return out
}

/** The calendar event's guests from the store — the withdraw press's (rehearsal-writes.ts). */
export async function storeCalendarGuests(tenantId: string, people: Invitee[]): Promise<string[]> {
  return calendarGuests(tenantId, people)
}

export async function rehearsal(tenantId: string, eventId: string): Promise<Rehearsal> {
  const [e] = await db.select().from(events).where(and(eq(events.id, eventId), eq(events.tenantId, tenantId)))
  if (!e) throw new Error('That event is not one of this school\'s.')
  if (!e.listId || !e.performanceDate) throw new Error('This event is not a rehearsal: it names no list.')
  return { id: e.id, tenantId, title: e.title, date: e.date, startTime: e.startTime, endTime: e.endTime, place: e.place, listId: e.listId, performanceDate: e.performanceDate, googleEventId: e.googleEventId }
}

export async function invitees(tenantId: string, eventId: string): Promise<Invitee[]> {
  return db.select({
    personId: eventPeople.personId, firstName: persons.firstName, lastName: persons.lastName, familyId: persons.familyId, email: persons.email,
    key: eventPeople.withdrawKey, withdrawnAt: eventPeople.withdrawnAt, came: eventPeople.came,
  }).from(eventPeople).innerJoin(persons, eq(persons.id, eventPeople.personId))
    .where(and(eq(eventPeople.eventId, eventId), eq(eventPeople.tenantId, tenantId)))
    .orderBy(asc(persons.firstName), asc(persons.lastName))
}

/** One family's share of a mail: its children in it, and the family's `event` list for them. */
// `people`: whose addresses `to` holds, in the same order — the texting block speaks about them.
type FamilyGroup = { familyId: string; children: Invitee[]; to: string[]; people: string[] }

// EVERY CHILD HERE HAS A FAMILY, and this mailer asserts it rather than handling its absence. The persons table is
// shared with the genealogy, whose persons have no family, so the column is nullable; but for a tenant running the
// roster the store refuses a live person without one. The assertion below is that guarantee's precondition: the roster
// is on. A child with no family after it is a store defect to repair, not a case to mail around.
async function byFamily(tenantId: string, kids: Invitee[]): Promise<FamilyGroup[]> {
  if (!(await rosterOn(tenantId))) {
    throw new Error('This mail is the roster module\'s: it is sent only for a school that has it.')
  }
  const groups = new Map<string, Invitee[]>()
  for (const k of kids) {
    if (!k.familyId) {
      throw new Error(`Person ${k.personId} has no family. The database forbids that for a roster person; repair the row before sending.`)
    }
    groups.set(k.familyId, [...(groups.get(k.familyId) ?? []), k])
  }
  const out: FamilyGroup[] = []
  for (const [familyId, children] of groups) {
    const rs = await familyRecipientPeople(tenantId, familyId, 'event', { studentIds: children.map(c => c.personId) })
    out.push({ familyId, children, to: rs.map(r => r.email), people: rs.map(r => r.personId) })
  }
  return out
}

/** The calendar event's guests: every invited child who has not withdrawn, and their parents. */
async function calendarGuests(tenantId: string, people: Invitee[]): Promise<string[]> {
  const staying = people.filter(p => p.key && !p.withdrawnAt)
  const seen = new Set<string>()
  return (await byFamily(tenantId, staying)).flatMap(g => g.to).filter(a => !seen.has(a.toLowerCase()) && seen.add(a.toLowerCase()))
}

// ── What the mails read (the host's jobs send them) ──────────────────────────

/** The tasks the performance gives out: those holding no task. */
export async function performanceTasks(tenantId: string, listId: string): Promise<{ list: string; tasks: TaskNode[] }> {
  const list = await getList(tenantId, listId)
  if (!list) throw new Error('The rehearsal\'s list is gone.')
  const leaves = list.tasks.filter(t => t.leaf)
  return { list: list.root.title, tasks: leaves.length ? leaves : [list.root] }
}

async function requireSchool(tenantId: string): Promise<Tenant> {
  const tenant = await getTenantById(tenantId)
  if (!tenant) throw new Error('No such school.')
  return tenant
}

// ── Withdraw — the public door; the key is the whole authority ──────────────────────────────────────────────────────

const KEY = /^[A-Za-z0-9_-]{32}$/

export type WithdrawView = { child: string; title: string; when: string; withdrawnAt: string | null }

export async function byKey(key: string) {
  if (!KEY.test(key)) return null
  const [row] = await db.select({
    tenantId: eventPeople.tenantId, eventId: eventPeople.eventId, personId: eventPeople.personId, withdrawnAt: eventPeople.withdrawnAt,
    firstName: persons.firstName, lastName: persons.lastName,
  }).from(eventPeople).innerJoin(persons, eq(persons.id, eventPeople.personId)).where(eq(eventPeople.withdrawKey, key))
  return row ?? null
}

/** What a withdraw link names; null for a key that is not one. Opening it changes nothing. */
export async function withdrawView(key: string): Promise<WithdrawView | null> {
  const row = await byKey(key)
  if (!row) return null
  const r = await rehearsal(row.tenantId, row.eventId)
  const { language } = (await tenantRules(row.tenantId)).locale
  return { child: row.firstName ?? fullName(row), title: r.title, when: when(r, language), withdrawnAt: row.withdrawnAt ? row.withdrawnAt.toISOString() : null }
}

// The family's press (withdrawByKey) is rehearsal-writes.ts, run by the roster API's public withdraw door.

// ── Who may be put on the performance day ───────────────────────────────────

export type PerformancePool = { pool: { id: string; label: string }[]; rehearsals: number; came: number }

/** On a day some rehearsal of this list performs: the children who came to it, and every current teacher (a teacher of
 *  a class this session year). Null on any other day (the ordinary pool applies). */
export async function performancePool(tenantId: string, listId: string, date: string): Promise<PerformancePool | null> {
  const rehearsals = await db.select({ id: events.id }).from(events)
    .where(and(eq(events.tenantId, tenantId), eq(events.listId, listId), eq(events.performanceDate, date)))
  if (!rehearsals.length) return null
  const year = await academicYearOf(tenantId)
  const came = await db.selectDistinct({ id: persons.id, firstName: persons.firstName, lastName: persons.lastName }).from(eventPeople)
    .innerJoin(persons, eq(persons.id, eventPeople.personId))
    .where(and(eq(eventPeople.tenantId, tenantId), inArray(eventPeople.eventId, rehearsals.map(r => r.id)), eq(eventPeople.came, true), isNull(persons.deletedAt)))
  const teachers = (await db.execute(sql`
    select distinct p.id, p.first_name, p.last_name
      from roster_teachers t join roster_available_classes ac on ac.id = t.class_id join persons p on p.id = t.person_id
     where t.tenant_id = ${tenantId} and ac.year = ${year} and p.deleted_at is null`)).rows as { id: string; first_name: string | null; last_name: string | null }[]
  const seen = new Set<string>()
  const pool = [
    ...came.map(c => ({ id: c.id, label: `${fullName(c)} — came to the rehearsal` })),
    ...teachers.map(t => ({ id: t.id, label: `${fullName({ firstName: t.first_name, lastName: t.last_name })} — teacher` })),
  ].filter(p => !seen.has(p.id) && seen.add(p.id))
  const names = await nameOrder(tenantId)
  pool.sort((a, b) => names(a.label, b.label))
  // A picked label must name one person: a second "A. Name — teacher" is numbered (as the ordinary pool does).
  const count = new Map<string, number>()
  return {
    pool: pool.map(v => { const n = (count.get(v.label) ?? 0) + 1; count.set(v.label, n); return n === 1 ? v : { ...v, label: `${v.label} (${n})` } }),
    rehearsals: rehearsals.length, came: came.length,
  }
}

/** The rehearsal a list's day performs, if any — for a link back to it from the list. */
export async function rehearsalFor(tenantId: string, listId: string, date: string): Promise<{ id: string; date: string } | null> {
  const [e] = await db.select({ id: events.id, date: events.date }).from(events)
    .where(and(eq(events.tenantId, tenantId), eq(events.listId, listId), eq(events.performanceDate, date))).limit(1)
  return e ?? null
}
