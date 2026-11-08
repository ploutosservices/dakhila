// THE COORDINATOR'S ACTS ON VOLUNTEERING WORK (lib/volunteering-writes.ts, rehearsal.ts), asked volunteer.write —
// volunteer.delete to delete, event.write to set up a rehearsal. A refusal comes back in its own words.
import { may } from './access'
import type { PersonCall, Route } from './routes'
import { field, notFound, ok, refused, S } from './op'
import { daySheet, getList, listDays, listLists, rootOf, volunteerPool } from './lib/volunteering'
import { listRehearsals, performancePool, rehearsalDefaults, rehearsalFor } from './lib/rehearsal'
import { sessionClasses } from './lib/events'
import {
  addLine, createTask, deleteLine, deleteTask, doneAsAssigned, putOnTask, updateTask,
} from './lib/volunteering-writes'
import { rehearsalFieldsRefusal } from './lib/rehearsal'
import { createRehearsal } from './lib/rehearsal-writes'

const T = '/v1/tenants/{slug}/roster/volunteering'
const DATE = /^\d{4}-\d{2}-\d{2}$/
const said = (e: unknown) => refused(e instanceof Error ? e.message : String(e))

export const VOLUNTEERING_ROUTES: Route[] = [
  // The volunteering reads, asked volunteer.read; the day's pool is answered to volunteer.write, the rehearsal set-up to
  // event.write.
  {
    method: 'GET', path: `${T}/lists`, operationId: 'volunteer.lists',
    summary: "The tenant's volunteering lists, one row per list (src/lib/volunteering.ts ListRow).",
    permission: 'volunteer.read',
    allowed: async c => may(c.caller, 'volunteer.read'),
    response: S.list(S.row('a list (src/lib/volunteering.ts ListRow)')),
    handle: async c => ok(await listLists(c.tenant.id)),
  },
  {
    method: 'GET', path: `${T}/lists/{id}`, operationId: 'volunteer.list',
    summary: "The list a task belongs to, in full: its root id, tasks, planned days and rehearsals; for a `date`, that day's sheet, the performance it is (null on an ordinary day) and its rehearsal; the pool to put people from, to volunteer.write on a date; the rehearsal defaults and the session's classes, to event.write when the list has tasks.",
    permission: 'volunteer.read',
    query: { date: S.date },
    allowed: async c => may(c.caller, 'volunteer.read'),
    response: S.obj({
      rootId: S.uuid, list: S.row('the list (src/lib/volunteering.ts getList)'),
      days: S.list(S.row('a planned day (src/lib/volunteering.ts DayRow)')),
      rehearsals: S.list(S.row('a rehearsal (src/lib/rehearsal.ts RehearsalRow)')),
      sheet: S.nullable(S.row('the day sheet (src/lib/volunteering.ts DaySheet)')),
      performance: S.nullable(S.row('the performance pool (src/lib/rehearsal.ts PerformancePool)')),
      rehearsal: S.nullable(S.obj({ id: S.uuid, date: S.date })),
      pool: S.list(S.obj({ id: S.uuid, label: S.str })),
      setup: S.nullable(S.obj({ defaults: S.obj({ date: S.date, performanceDate: S.date }), classes: S.list(S.row('a class of the session (src/lib/events.ts ClassChoice)')) })),
    }),
    handle: async c => {
      const caller = (c as PersonCall).caller
      const rootId = await rootOf(c.tenant.id, c.params.id)
      if (!rootId) return notFound('no such list')
      const list = await getList(c.tenant.id, rootId)
      if (!list) return notFound('no such list')
      const date = c.query.date && DATE.test(c.query.date) ? c.query.date : null
      const [days, rehearsals, sheet, performance, rehearsal] = await Promise.all([
        listDays(c.tenant.id, rootId), listRehearsals(c.tenant.id, rootId),
        date ? daySheet(c.tenant.id, rootId, date) : null,
        date ? performancePool(c.tenant.id, rootId, date) : null,
        date ? rehearsalFor(c.tenant.id, rootId, date) : null,
      ])
      const pool = !date || !may(caller, 'volunteer.write') ? [] : performance ? performance.pool : await volunteerPool(c.tenant.id)
      const setup = may(caller, 'event.write') && list.tasks.length > 0
        ? { defaults: await rehearsalDefaults(c.tenant.id), classes: await sessionClasses(c.tenant.id) }
        : null
      return ok({ rootId, list, days, rehearsals, sheet, performance, rehearsal, pool, setup })
    },
  },
  {
    method: 'POST', path: `${T}/tasks`, operationId: 'volunteer.createTask',
    summary: "A task at the end of its parent's tasks; no parent makes a new list.",
    permission: 'volunteer.write',
    allowed: async c => may(c.caller, 'volunteer.write'),
    request: S.obj({ parentId: S.nullable(S.uuid), title: S.str }),
    response: S.obj({ id: S.uuid }),
    handle: async c => {
      const title = field.str(c.body, 'title')
      if (!title.trim()) return refused('A task needs a title.')
      try { return ok({ id: await createTask(c.tenant.id, field.strOrNull(c.body, 'parentId') || null, title.trim()) }) } catch (e) { return said(e) }
    },
  },
  {
    method: 'PUT', path: `${T}/tasks/{id}`, operationId: 'volunteer.updateTask',
    summary: "A task's title, number, notes and web address.",
    permission: 'volunteer.write',
    allowed: async c => may(c.caller, 'volunteer.write'),
    request: S.obj({ title: S.str, position: S.num, notes: S.str, url: S.str }),
    response: S.obj({}),
    handle: async c => {
      const title = field.str(c.body, 'title'), position = field.num(c.body, 'position')
      if (!title.trim()) return refused('A task needs a title.')
      if (!Number.isInteger(position) || position < 1) return refused('A task\'s number is a whole number from 1.')
      const link = field.str(c.body, 'url').trim() || null
      if (link && !/^https?:\/\/\S+$/.test(link)) return refused('A web address must begin with http or https.')
      await updateTask(c.tenant.id, c.params.id, { title: title.trim(), position, url: link, notes: field.str(c.body, 'notes').trim() || null })
      return ok({})
    },
  },
  {
    method: 'DELETE', path: `${T}/tasks/{id}`, operationId: 'volunteer.deleteTask',
    summary: 'A task removed when it holds no task and no day or rehearsal names it; `wasList` says whether it was a list.',
    permission: 'volunteer.delete',
    allowed: async c => may(c.caller, 'volunteer.delete'),
    response: S.obj({ wasList: S.bool }),
    handle: async c => {
      const root = await rootOf(c.tenant.id, c.params.id)
      const refusal = await deleteTask(c.tenant.id, c.params.id)
      if (refusal) return refused(refusal)
      return ok({ wasList: root === c.params.id })
    },
  },
  {
    method: 'POST', path: `${T}/tasks/{id}/lines`, operationId: 'volunteer.addLine',
    summary: 'Another line on a task for a day — a second person on it.',
    permission: 'volunteer.write',
    allowed: async c => may(c.caller, 'volunteer.write'),
    request: S.obj({ date: S.date }),
    response: S.obj({}),
    handle: async c => {
      const date = field.str(c.body, 'date')
      if (!DATE.test(date)) return refused('Pick the date.')
      try { await addLine(c.tenant.id, c.params.id, date) } catch (e) { return said(e) }
      return ok({})
    },
  },
  {
    method: 'PUT', path: `${T}/tasks/{id}/put-on`, operationId: 'volunteer.putOn',
    summary: "A person put on a task for a day, as assigned or as having done it — on the named line, or on the task's line made for that day.",
    permission: 'volunteer.write',
    allowed: async c => may(c.caller, 'volunteer.write'),
    request: S.obj({ date: S.date, lineId: S.nullable(S.uuid), field: S.str, personId: S.nullable(S.uuid) }),
    response: S.obj({}),
    handle: async c => {
      const date = field.str(c.body, 'date'), which = field.str(c.body, 'field')
      if (!DATE.test(date)) return refused('Pick the day first.')
      if (which !== 'assigned' && which !== 'done') return refused('Not a field of a line.')
      try { await putOnTask(c.tenant.id, c.params.id, date, field.strOrNull(c.body, 'lineId'), which, field.strOrNull(c.body, 'personId') || null) } catch (e) { return said(e) }
      return ok({})
    },
  },
  {
    method: 'DELETE', path: `${T}/lines/{id}`, operationId: 'volunteer.deleteLine',
    summary: 'A line removed.',
    permission: 'volunteer.delete',
    allowed: async c => may(c.caller, 'volunteer.delete'),
    response: S.obj({}),
    handle: async c => {
      await deleteLine(c.tenant.id, c.params.id)
      return ok({})
    },
  },
  {
    method: 'POST', path: `${T}/lists/{id}/done-as-assigned`, operationId: 'volunteer.doneAsAssigned',
    summary: "On a day, every line of the list with no one recorded as doing it, done by whoever it was assigned to.",
    permission: 'volunteer.write',
    allowed: async c => may(c.caller, 'volunteer.write'),
    request: S.obj({ date: S.date }),
    response: S.obj({}),
    handle: async c => {
      const date = field.str(c.body, 'date')
      if (!DATE.test(date)) return refused('Pick the date.')
      await doneAsAssigned(c.tenant.id, c.params.id, date)
      return ok({})
    },
  },
  {
    method: 'POST', path: `${T}/lists/{id}/rehearsals`, operationId: 'volunteer.createRehearsal',
    summary: "A rehearsal of the list: an event naming the list and its performance day, the ticked classes' children its audience.",
    permission: 'event.write',
    allowed: async c => may(c.caller, 'event.write'),
    request: S.obj({ date: S.date, performanceDate: S.date, startTime: S.nullable(S.str), endTime: S.nullable(S.str), classIds: S.list(S.uuid) }),
    response: S.obj({ id: S.uuid }),
    handle: async c => {
      const f = { date: field.str(c.body, 'date'), performanceDate: field.str(c.body, 'performanceDate'), startTime: field.strOrNull(c.body, 'startTime'), endTime: field.strOrNull(c.body, 'endTime') }
      const refusal = rehearsalFieldsRefusal(f)
      if (refusal) return refused(refusal)
      try { return ok({ id: await createRehearsal(c.tenant.id, c.params.id, f, field.strs(c.body, 'classIds'), (c as PersonCall).caller.userId) }) } catch (e) { return said(e) }
    },
  },
]
