// THE DASHBOARD READS: a family's record, children, members and parents' texting states with the viewer's own name and
// addresses (lib/dashboard-family.ts), and the principal's counts (lib/dashboard.ts principalCounts). Who may:
// roster.read or the caller's own family; roster.write for the principal's counts.
import { may, ownFamilyOf } from './access'
import type { PersonCall, Route } from './routes'
import { ok, S } from './op'
import { dashboardFamily } from './lib/dashboard-family'
import { dashboardPersonId, principalCounts } from './lib/dashboard'
import { academicYearOf, enrollmentYearOf } from './lib/year-context'

const T = '/v1/tenants/{slug}/roster/dashboard'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const DASHBOARD_ROUTES: Route[] = [
  {
    method: 'GET', path: `${T}/family`, operationId: 'dashboard.family',
    summary: "A dashboard's family reads for `family` (absent: none): its record (with the activity log for roster.write), children, members' ids, parents with each number's texting state, whether a child has a submitted evaluation this academic year, and its members' volunteering work and events; with `me=1` the caller's own name and addresses and the classes they learn and teach this academic year; and the next school days.",
    permission: 'roster.read', alsoAllowed: "the caller's own family: their live person's family in the tenant, matched by the address they signed in with",
    query: { family: S.str, me: S.str },
    allowed: async c => !c.query.family || may(c.caller, 'roster.read') || (await ownFamilyOf(c.store, c.caller)) === c.query.family,
    response: S.obj({
      record: S.nullable(S.row('the family record (src/lib/roster-family-record.ts FamilyRecord)')),
      familyKids: S.list(S.row('a child: id, firstName, role, firstGradeYear')), memberIds: S.list(S.str),
      parents: S.nullable(S.list(S.row('a parent: id, firstName, lastName, phone, texting state'))),
      me: S.nullable(S.row("the caller's own firstName, lastName, email, classroomEmail")),
      myClasses: S.list(S.row("a class the caller learns in (src/lib/roster-classes.ts getStudentSchedule)")),
      teachingClasses: S.list(S.row("a class the caller teaches (src/lib/dashboard.ts teachingClassesOf)")),
      upcomingEvents: S.list(S.obj({ date: S.str, description: S.nullable(S.str) })),
      completedEvals: S.list(S.obj({ id: S.uuid })),
      volunteerWork: S.list(S.row('a volunteering line (src/lib/volunteering.ts VolunteerHistoryRow)')),
      eventHistory: S.list(S.row('an event a member was in (src/lib/events.ts EventHistoryRow)')),
    }),
    handle: async c => {
      const pc = c as PersonCall
      const family = c.query.family && UUID.test(c.query.family) ? c.query.family : null
      const me = c.query.me === '1' ? await dashboardPersonId(c.tenant.id, pc.caller.email) : null
      return ok(await dashboardFamily(c.tenant.id, family, me, may(pc.caller, 'roster.write')))
    },
  },
  {
    method: 'GET', path: `${T}/principal`, operationId: 'dashboard.principal',
    summary: "The principal's counts for this enrollment and academic year: tracker states, classes and their teachers, standby seats, recommendations awaiting approval, evaluations.",
    permission: 'roster.write',
    allowed: async c => may(c.caller, 'roster.write'),
    response: S.row("the principal's counts (src/lib/dashboard.ts principalCounts)"),
    handle: async c => ok(await principalCounts(c.tenant.id, await enrollmentYearOf(c.tenant.id), await academicYearOf(c.tenant.id))),
  },
]
