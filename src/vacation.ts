// TEACHER VACATIONS: the principal's and the teacher's own, their reads and their one act (lib/roster-teacher-vacation.ts,
// teacher-vacation-mark.ts). The principal's ask roster.write; the teacher's own ask that the caller be a teacher this
// school year (requireTeacherSelf), found by the address they signed in with, so a mark lands only on their own row.
import { may } from './access'
import type { PersonCall, Route } from './routes'
import { badRequest, field, notFound, ok, refused, result, S } from './op'
import { academicYearOf } from './lib/year-context'
import {
  getSchoolDays, getStandbyTeachers, getTeacherPerson, getTeachersForYear, getTeacherVacations, getVacationCoverage,
} from './lib/roster-teacher-vacation'
import { setTeacherVacation } from './lib/teacher-vacation-mark'

const T = '/v1/tenants/{slug}/roster/vacations'
const SELF = "a teacher this school year: their own row, found by the address they signed in with"
const NOT_A_TEACHER = 'Not a teacher this school year'
const DAYS = S.list(S.obj({ date: S.date, weekNumber: S.nullable(S.num) }))

function yearOf(s: string): number | null {
  const y = parseInt(s)
  return Number.isFinite(y) ? y : null
}

/** The caller's own teacher row this school year, or null. */
async function selfOf(c: PersonCall, year: number) {
  return getTeacherPerson(c.tenant.id, c.caller.email, year)
}

export const VACATION_ROUTES: Route[] = [
  {
    method: 'GET', path: `${T}/{year}`, operationId: 'vacation.principal',
    summary: "The principal's view of a school year's vacation marks: each mark with the classes that teacher covers (and whether any teacher is left for each), the school days, the standby teachers per department, the year's teachers, and — for `teacher`, when a teacher this year — that teacher's marks.",
    permission: 'roster.write',
    textParams: ['year'],
    query: { teacher: S.str },
    allowed: async c => may(c.caller, 'roster.write'),
    response: S.obj({
      rows: S.list(S.row('a coverage row (src/lib/roster-teacher-vacation.ts CoverageRow)')),
      days: DAYS,
      standby: S.list(S.obj({ department: S.str, teachers: S.list(S.str) })),
      teachers: S.list(S.obj({ personId: S.uuid, name: S.str })),
      chosenMarks: S.nullable(S.list(S.date)),
    }),
    handle: async c => {
      const year = yearOf(c.params.year)
      if (year === null) return badRequest('year must be a number')
      const [rows, days, standby, teachers] = await Promise.all([
        getVacationCoverage(c.tenant.id, year),
        getSchoolDays(c.tenant.id, year),
        getStandbyTeachers(c.tenant.id, year),
        getTeachersForYear(c.tenant.id, year),
      ])
      const chosen = teachers.find(t => t.personId === c.query.teacher)
      const chosenMarks = chosen ? (await getTeacherVacations(c.tenant.id, chosen.personId, year)).map(m => m.date) : null
      return ok({ rows, days, standby, teachers, chosenMarks })
    },
  },
  {
    method: 'PUT', path: `${T}/teachers/{id}/{date}`, operationId: 'vacation.setFor',
    summary: "One school day marked away (or not) for a teacher of this school year, by the principal on their behalf.",
    permission: 'roster.write',
    textParams: ['date'],
    allowed: async c => may(c.caller, 'roster.write'),
    request: S.obj({ away: S.bool }),
    response: S.obj({}),
    handle: async c => {
      const away = field.obj(c.body).away
      if (typeof away !== 'boolean') return badRequest('away must be a boolean')
      const teachers = await getTeachersForYear(c.tenant.id, await academicYearOf(c.tenant.id))
      if (!teachers.some(t => t.personId === c.params.id)) return refused(NOT_A_TEACHER)
      return result(await setTeacherVacation(c.tenant.id, c.params.id, c.params.date, away) ?? {})
    },
  },
  {
    method: 'GET', path: `${T}/{year}/mine`, operationId: 'vacation.mine',
    summary: "The caller's own vacation marks for a school year and the year's school days. 404 when the caller is not a teacher this year.",
    permission: null, alsoAllowed: SELF,
    textParams: ['year'],
    allowed: async () => true,
    response: S.obj({ days: DAYS, marks: S.list(S.date) }),
    handle: async c => {
      const year = yearOf(c.params.year)
      if (year === null) return badRequest('year must be a number')
      const me = await selfOf(c as PersonCall, year)
      if (!me) return notFound(NOT_A_TEACHER)
      const [days, marks] = await Promise.all([getSchoolDays(c.tenant.id, year), getTeacherVacations(c.tenant.id, me.personId, year)])
      return ok({ days, marks: marks.map(m => m.date) })
    },
  },
  {
    method: 'PUT', path: `${T}/mine/{date}`, operationId: 'vacation.setMine',
    summary: "One school day marked away (or not) for the caller, a teacher this school year.",
    permission: null, alsoAllowed: SELF,
    textParams: ['date'],
    allowed: async () => true,
    request: S.obj({ away: S.bool }),
    response: S.obj({}),
    handle: async c => {
      const away = field.obj(c.body).away
      if (typeof away !== 'boolean') return badRequest('away must be a boolean')
      const me = await selfOf(c as PersonCall, await academicYearOf(c.tenant.id))
      if (!me) return refused(NOT_A_TEACHER)
      return result(await setTeacherVacation(c.tenant.id, me.personId, c.params.date, away) ?? {})
    },
  },
]
