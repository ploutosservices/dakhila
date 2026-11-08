// EVENTS — a scheduling thing: an event is scheduled and an audience list is created
// from user input, as opposed to someone typing each email by hand. The coordinator picks classes; their children are the audience; their parents' addresses are
// the list. An event is a record id; its delete removes its classes and audience first.
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { db } from './db'
import { nameOrder } from './rules-context'
import {
  eventClasses, eventPeople, events, persons, rosterAvailableClasses, rosterCourseCatalog, rosterEnrollments, volunteerTasks,
} from '../tables'
import { tenantTimezone } from './tenant'
import { birthId } from './registry-id'
import { academicYearOf } from './year-context'
import { familyRecipients } from './family-recipients'

const fullName = (p: { firstName: string | null; lastName: string | null }) => [p.firstName, p.lastName].filter(Boolean).join(' ')
const classLabel = (c: { shortCode: string | null; section: string | null }) => [c.shortCode, c.section].filter(Boolean).join(' ')
const TIME = /^\d{2}:\d{2}$/

export type EventFields = { title: string; date: string; startTime: string | null; endTime: string | null; place: string | null; notes: string | null
  /** The last day a family pays for it; null = it takes no money. */
  payUntil: string | null }

/** Refuses a field the store must not hold, by name; null when the fields are fine. */
export function eventFieldsRefusal(f: EventFields): string | null {
  if (!f.title.trim()) return 'An event needs a title.'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date)) return 'Pick the date.'
  if (f.startTime && !TIME.test(f.startTime)) return 'A start time is HH:MM.'
  if (f.endTime && !TIME.test(f.endTime)) return 'An end time is HH:MM.'
  if (f.startTime && f.endTime && f.endTime <= f.startTime) return 'The event ends before it starts.'
  if (f.payUntil && !/^\d{4}-\d{2}-\d{2}$/.test(f.payUntil)) return 'The last paying day is a date.'
  return null
}

export type EventRow = { id: string; date: string; time: string; title: string; classes: string; audience: number; came: number }

export async function listEvents(tenantId: string): Promise<EventRow[]> {
  const rows = await db.select({
    id: events.id, date: events.date, startTime: events.startTime, endTime: events.endTime, title: events.title,
    // Qualified by hand: with no join, drizzle writes an outer column bare, which inside a subquery names the
    // subquery's own table.
    classes: sql<string>`coalesce((select string_agg(concat_ws(' ', c.short_code, ac.section), ', ' order by c.department, c.level)
      from event_classes ec join roster_available_classes ac on ac.id = ec.class_id
      left join roster_course_catalog c on c.id = ac.course_id where ec.event_id = "events"."id"), '')`,
    audience: sql<number>`(select count(*) from event_people p where p.event_id = "events"."id")::int`,
    came: sql<number>`(select count(*) from event_people p where p.event_id = "events"."id" and p.came)::int`,
  }).from(events).where(eq(events.tenantId, tenantId)).orderBy(desc(events.date), desc(events.startTime))
  return rows.map(r => ({ ...r, time: [r.startTime, r.endTime].filter(Boolean).join('–') }))
}

// Creating, changing and deleting an event, picking its classes and recording who came are event-writes.ts,
// the roster API's; this file reads.

export type ClassChoice = { id: string; label: string; department: string }

/** This session year's classes, by department then level — what an audience is picked from. */
export async function sessionClasses(tenantId: string): Promise<ClassChoice[]> {
  const year = await academicYearOf(tenantId)
  const rows = await db.select({ id: rosterAvailableClasses.id, shortCode: rosterCourseCatalog.shortCode, section: rosterAvailableClasses.section, department: rosterCourseCatalog.department })
    .from(rosterAvailableClasses).innerJoin(rosterCourseCatalog, eq(rosterCourseCatalog.id, rosterAvailableClasses.courseId))
    .where(and(eq(rosterAvailableClasses.tenantId, tenantId), eq(rosterAvailableClasses.year, year)))
    .orderBy(asc(rosterCourseCatalog.department), asc(rosterCourseCatalog.level), asc(rosterCourseCatalog.shortCode), asc(rosterAvailableClasses.section))
  return rows.map(r => ({ id: r.id, label: classLabel(r), department: r.department }))
}

type Child = { id: string; name: string; classLabel: string; familyId: string | null }

/** The children enrolled in these classes now (not dropped, not removed), by class then name. */
export async function childrenOf(tenantId: string, classIds: string[]): Promise<Child[]> {
  if (!classIds.length) return []
  const rows = await db.select({
    id: persons.id, firstName: persons.firstName, lastName: persons.lastName, familyId: persons.familyId,
    shortCode: rosterCourseCatalog.shortCode, section: rosterAvailableClasses.section,
  }).from(rosterEnrollments)
    .innerJoin(persons, eq(persons.id, rosterEnrollments.studentId))
    .innerJoin(rosterAvailableClasses, eq(rosterAvailableClasses.id, rosterEnrollments.classId))
    .leftJoin(rosterCourseCatalog, eq(rosterCourseCatalog.id, rosterAvailableClasses.courseId))
    .where(and(eq(rosterEnrollments.tenantId, tenantId), inArray(rosterEnrollments.classId, classIds),
      isNull(rosterEnrollments.deletedAt), isNull(rosterEnrollments.droppedOutAt), isNull(persons.deletedAt)))
    .orderBy(asc(rosterCourseCatalog.department), asc(rosterCourseCatalog.level), asc(persons.firstName), asc(persons.lastName))
  const seen = new Set<string>()
  return rows.filter(r => !seen.has(r.id) && seen.add(r.id)).map(r => ({ id: r.id, name: fullName(r), classLabel: classLabel(r), familyId: r.familyId }))
}


export type EventDetail = EventFields & {
  id: string; classIds: string[]
  people: { personId: string; name: string; classLabel: string; came: boolean; invited: boolean; withdrawnAt: string | null }[]
  /** The audience's addresses, withdrawn children left out — the family's own rule (family-recipients.ts, kind `event`:
   *  the children and the parents). */
  addresses: string[]
  /** A rehearsal: the list rehearsed, its performance day, and when each mail went. Null on an ordinary event. */
  rehearsal: { listId: string; list: string; performanceDate: string; invitedAt: string | null; remindedAt: string | null; assignmentsSentAt: string | null; calendar: string | null } | null
}

export async function getEvent(tenantId: string, id: string): Promise<EventDetail | null> {
  const [e] = await db.select().from(events).where(and(eq(events.id, id), eq(events.tenantId, tenantId)))
  if (!e) return null
  const names = await nameOrder(tenantId)
  const classIds = (await db.select({ id: eventClasses.classId }).from(eventClasses).where(eq(eventClasses.eventId, id))).map(r => r.id)
  const children = await childrenOf(tenantId, classIds)
  const label = new Map(children.map(c => [c.id, c.classLabel]))
  // The audience in the classes' own order (department, level), then by name — childrenOf's order. A child who has left
  // the classes but came stays, after them.
  const order = new Map(children.map((c, i) => [c.id, i]))
  const people = (await db.select({
    personId: eventPeople.personId, came: eventPeople.came, firstName: persons.firstName, lastName: persons.lastName, familyId: persons.familyId,
    key: eventPeople.withdrawKey, withdrawnAt: eventPeople.withdrawnAt,
  }).from(eventPeople).innerJoin(persons, eq(persons.id, eventPeople.personId)).where(eq(eventPeople.eventId, id)))
  const staying = people.filter(p => !p.withdrawnAt)
  const families = [...new Set(staying.map(p => p.familyId).filter((f): f is string => !!f))]
  const seen = new Set<string>()
  const addresses = (await Promise.all(families.map(f => familyRecipients(tenantId, f, 'event', { studentIds: staying.filter(p => p.familyId === f).map(p => p.personId) })))).flat()
    .filter(a => !seen.has(a.toLowerCase()) && seen.add(a.toLowerCase()))
  const iso = (d: Date | null) => d ? d.toISOString() : null
  const [list] = e.listId ? await db.select({ title: volunteerTasks.title }).from(volunteerTasks).where(eq(volunteerTasks.id, e.listId)) : []
  return {
    id: e.id, title: e.title, date: e.date, startTime: e.startTime, endTime: e.endTime, place: e.place, notes: e.notes, payUntil: e.payUntil, classIds,
    people: people.map(p => ({ personId: p.personId, name: fullName(p), classLabel: label.get(p.personId) ?? '', came: p.came, invited: !!p.key, withdrawnAt: iso(p.withdrawnAt) }))
      .sort((a, b) => (order.get(a.personId) ?? Infinity) - (order.get(b.personId) ?? Infinity) || names(a.name, b.name)),
    addresses,
    rehearsal: e.listId && e.performanceDate ? {
      listId: e.listId, list: list?.title ?? '', performanceDate: e.performanceDate,
      invitedAt: iso(e.invitedAt), remindedAt: iso(e.remindedAt), assignmentsSentAt: iso(e.assignmentsSentAt), calendar: e.googleEventId,
    } : null,
  }
}

export type EventHistoryRow = { eventId: string; date: string; title: string; personId: string; person: string; what: string }

/** The events these people were in the audience of, newest first, came or not. */
export async function eventHistory(tenantId: string, personIds: string[]): Promise<EventHistoryRow[]> {
  if (!personIds.length) return []
  const rows = await db.select({
    eventId: events.id, date: events.date, title: events.title, personId: eventPeople.personId,
    firstName: persons.firstName, lastName: persons.lastName, came: eventPeople.came, withdrawnAt: eventPeople.withdrawnAt,
  }).from(eventPeople).innerJoin(events, eq(events.id, eventPeople.eventId)).innerJoin(persons, eq(persons.id, eventPeople.personId))
    .where(and(eq(eventPeople.tenantId, tenantId), inArray(eventPeople.personId, personIds))).orderBy(desc(events.date))
  return rows.map(r => ({ eventId: r.eventId, date: r.date, title: r.title, personId: r.personId, person: fullName(r), what: r.came ? 'came' : r.withdrawnAt ? 'withdrew' : 'invited, did not come' }))
}
