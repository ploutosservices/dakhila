// THE SESSION READ: the caller's own family's session — its students' classes and what each still needs
// (lib/session-view.ts) — for the family found by the address the caller signed in with.
import { ownFamilyOf } from './access'
import type { PersonCall, Route } from './routes'
import { notFound, ok, S } from './op'
import { getSessionView } from './lib/session-view'
import { academicYearOf, enrollmentYearOf, todayOf } from './lib/year-context'
import { personOfAddress } from './lib/roster-roles'
import { getFamilySchedule } from './lib/roster-classes'
import { isSchoolDate } from './lib/calendar'

export const SESSION_ROUTES: Route[] = [
  {
    method: 'GET', path: '/v1/tenants/{slug}/roster/schedule/mine', operationId: 'schedule.mine',
    summary: "The caller's schedule: whether the caller's address is a live person of the tenant, every student of their family with this year's classes, and whether today is a school day.",
    permission: null, alsoAllowed: "the caller's own family: the person whose address is the one they signed in with, and that person's family",
    allowed: async () => true,
    response: S.obj({ linked: S.bool, students: S.list(S.row("a student's schedule (src/lib/roster-classes.ts FamilyStudentSchedule)")), isSchoolDay: S.bool }),
    handle: async c => {
      const person = await personOfAddress(c.tenant.id, (c as PersonCall).caller.email)
      const [students, isSchoolDay] = await Promise.all([
        person?.familyId ? academicYearOf(c.tenant.id).then(year => getFamilySchedule(c.tenant.id, person.familyId!, year)) : Promise.resolve([]),
        todayOf(c.tenant.id).then(today => isSchoolDate(c.tenant.id, today)),
      ])
      return ok({ linked: person !== null, students, isSchoolDay })
    },
  },
  {
    method: 'GET', path: '/v1/tenants/{slug}/roster/session/mine', operationId: 'session.mine',
    summary: "The caller's own family and its session for this enrollment year: each student's classes and what each still needs. 404 when the caller belongs to no family.",
    permission: null, alsoAllowed: "the caller's own family: their live person's family in the tenant, matched by the address they signed in with",
    addressOnly: true,
    allowed: async () => true,
    response: S.row("the family's id and its session view: classes, gaps and their owners (src/lib/session-view.ts SessionView)"),
    handle: async c => {
      const familyId = await ownFamilyOf(c.store, (c as PersonCall).caller)
      if (!familyId) return notFound('the caller belongs to no family')
      return ok({ familyId, ...await getSessionView(c.tenant.id, familyId, await enrollmentYearOf(c.tenant.id)) })
    },
  },
]
