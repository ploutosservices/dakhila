// VOLUNTEERING WORK, WRITTEN, apart from the reads (volunteering.ts); the roster API's volunteer.* acts call these. A
// task is a record id; its delete is refused while it holds a task or a line names it.
import { and, asc, eq, inArray, isNull, max, sql } from 'drizzle-orm'
import { db } from './db'
import { events, persons, volunteerLines, volunteerTasks } from '../tables'
import { birthId, dropIds } from './registry-id'
import { daySheet } from './volunteering'

/** A new task at the end of its parent's tasks; no parent makes a new list. */
export async function createTask(tenantId: string, parentId: string | null, title: string): Promise<string> {
  if (parentId) {
    const [own] = await db.select({ id: volunteerTasks.id }).from(volunteerTasks)
      .where(and(eq(volunteerTasks.id, parentId), eq(volunteerTasks.tenantId, tenantId)))
    if (!own) throw new Error('That task is not one of this school\'s.')
  }
  return db.transaction(async tx => {
    const [{ last }] = await tx.select({ last: max(volunteerTasks.position) }).from(volunteerTasks)
      .where(and(eq(volunteerTasks.tenantId, tenantId), parentId ? eq(volunteerTasks.parentId, parentId) : isNull(volunteerTasks.parentId)))
    const id = await birthId(tx, 'volunteer_task', tenantId)
    await tx.insert(volunteerTasks).values({ id, tenantId, parentId, position: (last ?? 0) + 1, title })
    return id
  })
}

export async function updateTask(tenantId: string, id: string, fields: { title: string; position: number; url: string | null; notes: string | null }): Promise<void> {
  await db.update(volunteerTasks).set(fields).where(and(eq(volunteerTasks.id, id), eq(volunteerTasks.tenantId, tenantId)))
}

/** A task goes only when it holds no task and no day names it; then its record id. Answers the refusal, or null. */
export async function deleteTask(tenantId: string, id: string): Promise<string | null> {
  const [held] = await db.select({ n: sql<number>`count(*)::int` }).from(volunteerTasks).where(eq(volunteerTasks.parentId, id))
  if (held.n) return `This task holds ${held.n} task${held.n === 1 ? '' : 's'}; delete ${held.n === 1 ? 'it' : 'them'} first.`
  const days = await db.selectDistinct({ date: volunteerLines.date }).from(volunteerLines)
    .where(and(eq(volunteerLines.taskId, id), eq(volunteerLines.tenantId, tenantId))).orderBy(asc(volunteerLines.date))
  if (days.length) return `This task cannot be deleted: work was put on it on ${days.map(d => d.date).join(', ')}.`
  const rehearsed = await db.select({ date: events.date }).from(events).where(and(eq(events.listId, id), eq(events.tenantId, tenantId))).orderBy(asc(events.date))
  if (rehearsed.length) return `This list cannot be deleted: it was rehearsed on ${rehearsed.map(r => r.date).join(', ')}.`
  await db.transaction(async tx => {
    await tx.delete(volunteerTasks).where(and(eq(volunteerTasks.id, id), eq(volunteerTasks.tenantId, tenantId)))
    await dropIds(tx, [id], tenantId)
  })
  return null
}

/** Put a person on a task for a day — the line is made on first use, so there is no step to prepare a day. `lineId`
 *  names an existing line (a second person, or a change); null makes the task's line for that day. */
export async function putOnTask(tenantId: string, taskId: string, date: string, lineId: string | null, field: 'assigned' | 'done', personId: string | null): Promise<void> {
  if (lineId) return setLine(tenantId, lineId, field, personId)
  if (!personId) return
  const [own] = await db.select({ id: volunteerTasks.id }).from(volunteerTasks).where(and(eq(volunteerTasks.id, taskId), eq(volunteerTasks.tenantId, tenantId)))
  if (!own) throw new Error('That task is not one of this school\'s.')
  const [person] = await db.select({ id: persons.id }).from(persons).where(and(eq(persons.id, personId), eq(persons.tenantId, tenantId)))
  if (!person) throw new Error('That person is not one of this school\'s.')
  await db.insert(volunteerLines).values({ tenantId, taskId, date, ...(field === 'assigned' ? { assignedPersonId: personId } : { donePersonId: personId }) })
}

/** Another line on a task that day — a second person on it. */
export async function addLine(tenantId: string, taskId: string, date: string): Promise<void> {
  const [own] = await db.select({ id: volunteerTasks.id }).from(volunteerTasks).where(and(eq(volunteerTasks.id, taskId), eq(volunteerTasks.tenantId, tenantId)))
  if (!own) throw new Error('That task is not one of this school\'s.')
  await db.insert(volunteerLines).values({ tenantId, taskId, date })
}

/** Who a line is assigned to, or who did it; null clears. A stand-in is a change of `done` alone. */
export async function setLine(tenantId: string, lineId: string, field: 'assigned' | 'done', personId: string | null): Promise<void> {
  if (personId) {
    const [own] = await db.select({ id: persons.id }).from(persons).where(and(eq(persons.id, personId), eq(persons.tenantId, tenantId)))
    if (!own) throw new Error('That person is not one of this school\'s.')
  }
  await db.update(volunteerLines).set(field === 'assigned' ? { assignedPersonId: personId } : { donePersonId: personId })
    .where(and(eq(volunteerLines.id, lineId), eq(volunteerLines.tenantId, tenantId)))
}

export async function deleteLine(tenantId: string, lineId: string): Promise<void> {
  await db.delete(volunteerLines).where(and(eq(volunteerLines.id, lineId), eq(volunteerLines.tenantId, tenantId)))
}

/** On the day: every line with no one recorded as doing it is done by whoever it was assigned to — the usual day, in
 *  one press; the stand-ins are then changed one by one. */
export async function doneAsAssigned(tenantId: string, rootId: string, date: string): Promise<void> {
  const sheet = await daySheet(tenantId, rootId, date)
  if (!sheet) return
  const ids = sheet.rows.flatMap(r => r.lines).filter(l => l.assignedId && !l.doneId).map(l => l.id)
  if (ids.length) await db.update(volunteerLines).set({ donePersonId: sql`${volunteerLines.assignedPersonId}` })
    .where(and(eq(volunteerLines.tenantId, tenantId), inArray(volunteerLines.id, ids)))
}
