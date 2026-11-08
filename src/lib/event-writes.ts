// EVENTS, WRITTEN, apart from their reads (events.ts): the roster API's event.* acts and the rehearsal's own code call
// these. An event is a record id; its delete removes its classes and audience first.
import { and, eq, sql } from 'drizzle-orm'
import { db } from './db'
import { eventClasses, eventPeople, events } from '../tables'
import { birthId, dropIds } from './registry-id'
import { childrenOf, sessionClasses, type EventFields } from './events'

export async function createEvent(tenantId: string, f: EventFields, createdBy: string): Promise<string> {
  return db.transaction(async tx => {
    const id = await birthId(tx, 'event', tenantId)
    await tx.insert(events).values({ id, tenantId, ...f, createdBy })
    return id
  })
}

export async function updateEvent(tenantId: string, id: string, f: EventFields): Promise<void> {
  await db.update(events).set(f).where(and(eq(events.id, id), eq(events.tenantId, tenantId)))
}

/** The audience and the classes go first, then the event and its record id. */
export async function deleteEvent(tenantId: string, id: string): Promise<void> {
  await db.transaction(async tx => {
    await tx.delete(eventPeople).where(and(eq(eventPeople.eventId, id), eq(eventPeople.tenantId, tenantId)))
    await tx.delete(eventClasses).where(and(eq(eventClasses.eventId, id), eq(eventClasses.tenantId, tenantId)))
    await tx.delete(events).where(and(eq(events.id, id), eq(events.tenantId, tenantId)))
    await dropIds(tx, [id], tenantId)
  })
}

/** The classes picked, replaced. Their children join the audience; a child no longer in any picked class leaves it
 *  unless ticked as came (that happened, and stays). */
export async function setEventClasses(tenantId: string, eventId: string, classIds: string[]): Promise<void> {
  const offered = new Set((await sessionClasses(tenantId)).map(c => c.id))
  if (classIds.some(c => !offered.has(c))) throw new Error('Only this session year\'s classes can be picked.')
  const children = await childrenOf(tenantId, classIds)
  await db.transaction(async tx => {
    await tx.delete(eventClasses).where(and(eq(eventClasses.eventId, eventId), eq(eventClasses.tenantId, tenantId)))
    if (classIds.length) await tx.insert(eventClasses).values(classIds.map(classId => ({ tenantId, eventId, classId })))
    const keep = children.map(c => c.id)
    await tx.delete(eventPeople).where(and(eq(eventPeople.eventId, eventId), eq(eventPeople.tenantId, tenantId), eq(eventPeople.came, false),
      keep.length ? sql`${eventPeople.personId} not in (${sql.join(keep.map(k => sql`${k}`), sql`, `)})` : sql`true`))
    if (children.length) await tx.insert(eventPeople).values(children.map(c => ({ tenantId, eventId, personId: c.id }))).onConflictDoNothing()
  })
}

export async function setCame(tenantId: string, eventId: string, personId: string, came: boolean): Promise<void> {
  await db.update(eventPeople).set({ came })
    .where(and(eq(eventPeople.eventId, eventId), eq(eventPeople.personId, personId), eq(eventPeople.tenantId, tenantId)))
}
