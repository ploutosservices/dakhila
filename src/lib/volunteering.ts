// VOLUNTEERING WORK — the coordinator's lists of tasks and who
// was put on each task on a day: a list of things (maybe hierarchical), and a task is
// assigned to a person for a specific day. A task is a record id; its delete is
// refused while it holds a task or a line names it.
import { and, asc, eq, inArray, isNull, max, sql } from 'drizzle-orm'
import { db } from './db'
import { nameOrder } from './rules-context'
import { byCode } from './zoned'
import { events, persons, volunteerLines, volunteerTasks } from '../tables'
import { tenantTimezone } from './tenant'
import { birthId } from './registry-id'
import { academicYearOf } from './year-context'

const fullName = (p: { firstName: string | null; lastName: string | null }) => [p.firstName, p.lastName].filter(Boolean).join(' ')

// ── Lists and their tasks ───────────────────────────────────────────────────

export type ListRow = { id: string; title: string; tasks: number; days: number; lastDay: string | null }

/** The lists — the tasks with no parent — with how many tasks they hold and on how many days work was put. */
export async function listLists(tenantId: string): Promise<ListRow[]> {
  const rows = (await db.execute(sql`
    with recursive tree as (
      select id as root, id from volunteer_tasks where tenant_id = ${tenantId} and parent_id is null
      union all select tree.root, t.id from volunteer_tasks t join tree on t.parent_id = tree.id)
    select r.id, r.title,
           (select count(*) from tree where tree.root = r.id and tree.id <> r.id)::int as tasks,
           (select count(distinct l.date) from volunteer_lines l join tree on tree.id = l.task_id where tree.root = r.id)::int as days,
           (select max(l.date)::text from volunteer_lines l join tree on tree.id = l.task_id where tree.root = r.id) as last_day
      from volunteer_tasks r where r.tenant_id = ${tenantId} and r.parent_id is null
     order by r.position, r.title`)).rows as { id: string; title: string; tasks: number; days: number; last_day: string | null }[]
  return rows.map(r => ({ id: r.id, title: r.title, tasks: r.tasks, days: r.days, lastDay: r.last_day }))
}

export type TaskNode = { id: string; parentId: string | null; position: number; title: string; url: string | null; notes: string | null; depth: number; number: string; leaf: boolean }

/** A list and every task under it, in reading order, each with its depth and its number ("2.1"). Null when the id is
 *  not one of this tenant's lists. */
export async function getList(tenantId: string, rootId: string): Promise<{ root: TaskNode; tasks: TaskNode[] } | null> {
  const rows = (await db.execute(sql`
    with recursive tree as (
      select id, parent_id, position, title, url, notes, 0 as depth, array[position, 0] as path, ''::text as number
        from volunteer_tasks where id = ${rootId} and tenant_id = ${tenantId} and parent_id is null
      union all
      select t.id, t.parent_id, t.position, t.title, t.url, t.notes, tree.depth + 1, tree.path || array[t.position],
             case when tree.depth = 0 then t.position::text else tree.number || '.' || t.position end
        from volunteer_tasks t join tree on t.parent_id = tree.id)
    select tree.*, not exists (select 1 from volunteer_tasks c where c.parent_id = tree.id) as leaf
      from tree order by path`)).rows as { id: string; parent_id: string | null; position: number; title: string; url: string | null; notes: string | null; depth: number; number: string; leaf: boolean }[]
  if (!rows.length) return null
  const nodes = rows.map(r => ({ id: r.id, parentId: r.parent_id, position: r.position, title: r.title, url: r.url, notes: r.notes, depth: r.depth, number: r.number, leaf: r.leaf }))
  return { root: nodes[0], tasks: nodes.slice(1) }
}

/** The list a task belongs to. */
export async function rootOf(tenantId: string, taskId: string): Promise<string | null> {
  const [row] = (await db.execute(sql`
    with recursive up as (
      select id, parent_id from volunteer_tasks where id = ${taskId} and tenant_id = ${tenantId}
      union all select t.id, t.parent_id from volunteer_tasks t join up on t.id = up.parent_id)
    select id from up where parent_id is null`)).rows as { id: string }[]
  return row?.id ?? null
}

// Making, changing and deleting tasks and lines are volunteering-writes.ts, the roster API's; this
// file reads.

// ── Days ────────────────────────────────────────────────────────────────────

/** The tasks work is put on: those holding no task (a list with no tasks is its own one task). */
const workTasks = (list: { root: TaskNode; tasks: TaskNode[] }) => {
  const leaves = list.tasks.filter(t => t.leaf)
  return leaves.length ? leaves : [list.root]
}

export type DayRow = { date: string; who: string; assigned: number; done: number }

/** Every day work was put on this list, newest first, with who is on each task (in the tasks' order) — the one who did
 *  it, "(for …)" when they stood in, else the one assigned. */
export async function listDays(tenantId: string, rootId: string): Promise<DayRow[]> {
  const list = await getList(tenantId, rootId)
  if (!list) return []
  const order = new Map([list.root, ...list.tasks].map((t, i) => [t.id, i]))
  const rows = (await db.execute(sql`
    select l.date::text as date, l.task_id, l.done_person_id is not null as done,
           -- who is on the line: the one who did it, and whom they stood in for; else the one assigned
           case when d.id is not null and a.id is not null and d.id <> a.id
                  then concat_ws(' ', d.first_name, d.last_name) || ' (for ' || concat_ws(' ', a.first_name, a.last_name) || ')'
                when d.id is not null then concat_ws(' ', d.first_name, d.last_name)
                else concat_ws(' ', a.first_name, a.last_name) end as assigned
      from volunteer_lines l left join persons a on a.id = l.assigned_person_id left join persons d on d.id = l.done_person_id
     where l.tenant_id = ${tenantId} and l.task_id in (${sql.join([...order.keys()].map(k => sql`${k}`), sql`, `)})`)).rows as
    { date: string; task_id: string; assigned: string; done: boolean }[]
  const byDate = new Map<string, typeof rows>()
  for (const r of rows) byDate.set(r.date, [...(byDate.get(r.date) ?? []), r])
  return [...byDate].sort(([a], [b]) => byCode(b, a)).map(([date, rs]) => ({
    date,
    who: rs.filter(r => r.assigned).sort((x, y) => (order.get(x.task_id) ?? 0) - (order.get(y.task_id) ?? 0)).map(r => r.assigned).join(', '),
    assigned: rs.filter(r => r.assigned).length,
    done: rs.filter(r => r.done).length,
  }))
}

export type Line = { id: string; taskId: string; assignedId: string | null; assigned: string; doneId: string | null; done: string; notes: string | null }
export type DaySheet = { root: TaskNode; date: string; rows: { task: TaskNode; lines: Line[] }[] }

/** One list on one day: each task work is put on, and its lines. */
export async function daySheet(tenantId: string, rootId: string, date: string): Promise<DaySheet | null> {
  const list = await getList(tenantId, rootId)
  if (!list) return null
  const tasks = workTasks(list)
  const raw = (await db.execute(sql`
    select l.id, l.task_id, l.assigned_person_id, l.done_person_id, l.notes,
           concat_ws(' ', a.first_name, a.last_name) as assigned, concat_ws(' ', d.first_name, d.last_name) as done
      from volunteer_lines l left join persons a on a.id = l.assigned_person_id left join persons d on d.id = l.done_person_id
     where l.tenant_id = ${tenantId} and l.date = ${date}
       and l.task_id in (${sql.join(tasks.map(t => sql`${t.id}`), sql`, `)})
     order by l.created_at`)).rows as { id: string; task_id: string; assigned_person_id: string | null; done_person_id: string | null; notes: string | null; assigned: string; done: string }[]
  const lines = raw.map(r => ({ id: r.id, taskId: r.task_id, assignedId: r.assigned_person_id, assigned: r.assigned, doneId: r.done_person_id, done: r.done, notes: r.notes }))
  return { root: list.root, date, rows: tasks.map(task => ({ task, lines: lines.filter(l => l.taskId === task.id) })) }
}


// ── Who may be put on a task ────────────────────────────────────────────────

export type Volunteer = { id: string; label: string }

/** A child in a class this session year (their class beside the name), or a parent in a family of such a child. */
export async function volunteerPool(tenantId: string): Promise<Volunteer[]> {
  const year = await academicYearOf(tenantId)
  const names = await nameOrder(tenantId)
  const rows = (await db.execute(sql`
    with kids as (
      select distinct on (p.id) p.id, p.first_name, p.last_name, p.family_id, c.short_code, ac.section
        from roster_enrollments e join roster_available_classes ac on ac.id = e.class_id
        join persons p on p.id = e.student_id left join roster_course_catalog c on c.id = ac.course_id
       where e.tenant_id = ${tenantId} and ac.year = ${year} and e.deleted_at is null and e.dropped_out_at is null and p.deleted_at is null
       order by p.id, c.level)
    select id, first_name, last_name, concat_ws(' ', short_code, section) as what from kids
    union all
    select p.id, p.first_name, p.last_name, 'parent'
      from persons p join roster_families f on p.id in (f.mother_id, f.father_id)
     where f.id in (select family_id from kids) and p.deleted_at is null`)).rows as { id: string; first_name: string | null; last_name: string | null; what: string }[]
  const seen = new Set<string>()
  const list = rows.filter(r => !seen.has(r.id) && seen.add(r.id))
    .map(r => ({ id: r.id, label: `${fullName({ firstName: r.first_name, lastName: r.last_name })} — ${r.what}` }))
    .sort((a, b) => names(a.label, b.label))
  // A picked label must name one person: a second "A. Name — parent" is numbered.
  const count = new Map<string, number>()
  return list.map(v => { const n = (count.get(v.label) ?? 0) + 1; count.set(v.label, n); return n === 1 ? v : { ...v, label: `${v.label} (${n})` } })
}

// ── A person's history ──────────────────────────────────────────────────────

export type VolunteerHistoryRow = { date: string; list: string; task: string; taskUrl: string | null; personId: string; person: string; what: string }

/** The work these people were put on, newest first: assigned, did it, or stood in for someone. */
export async function volunteerHistory(tenantId: string, personIds: string[]): Promise<VolunteerHistoryRow[]> {
  if (!personIds.length) return []
  const ids = sql.join(personIds.map(p => sql`${p}`), sql`, `)
  const rows = (await db.execute(sql`
    with recursive up as (
      select id as task, id, parent_id from volunteer_tasks where tenant_id = ${tenantId}
      union all select up.task, t.id, t.parent_id from volunteer_tasks t join up on t.id = up.parent_id),
    roots as (select up.task, r.title from up join volunteer_tasks r on r.id = up.id where up.parent_id is null),
    x as (
      select l.date, l.task_id, l.assigned_person_id as person_id,
             case when l.done_person_id is null then 'assigned'
                  when l.done_person_id = l.assigned_person_id then 'did it'
                  else 'assigned; someone else did it' end as what
        from volunteer_lines l where l.tenant_id = ${tenantId} and l.assigned_person_id in (${ids})
      union all
      select l.date, l.task_id, l.done_person_id, case when l.assigned_person_id is null then 'did it' else 'did it, standing in' end
        from volunteer_lines l where l.tenant_id = ${tenantId} and l.done_person_id in (${ids})
         and l.done_person_id is distinct from l.assigned_person_id)
    select x.date::text as date, roots.title as list, t.title as task, t.url as task_url, x.person_id, concat_ws(' ', p.first_name, p.last_name) as person, x.what
      from x join volunteer_tasks t on t.id = x.task_id join roots on roots.task = x.task_id join persons p on p.id = x.person_id
     order by x.date desc, person, task`)).rows as { date: string; list: string; task: string; task_url: string | null; person_id: string; person: string; what: string }[]
  return rows.map(r => ({ date: r.date, list: r.list, task: r.task, taskUrl: r.task_url, personId: r.person_id, person: r.person, what: r.what }))
}
