// THE HELP READS: a family's — the caller's own family, its enrollment, children and classes, the next school days, its
// history — and the principal's counts (lib/family-help.ts, family-enrollment.ts, principal-work.ts), each with its
// who-may.
import { may, ownFamilyOf } from './access'
import type { PersonCall, Route } from './routes'
import { notFound, ok, S } from './op'
import { familyWithParentNames, familyEligibleForYear, familyClassesOfYear, nextSchoolDays, familyEnrollmentHistory } from './lib/family-help'
import { getEnrollment } from './lib/family-enrollment'
import { getPrincipalWork, principalHelpCounts } from './lib/principal-work'
import { currentAcademicYear, enrollmentYear, localDateStr } from './lib/years'
import { yearRules } from './lib/year-context'
import { ports } from './ports'

const T = '/v1/tenants/{slug}/roster/help'
const DAY = /^\d{4}-\d{2}-\d{2}$/

export const HELP_ROUTES: Route[] = [
  {
    method: 'GET', path: `${T}/families/mine`, operationId: 'help.familyMine',
    summary: "A family's help page: the caller's own family with its parents' names, this enrollment year's enrollment and eligible children, this academic year's classes, the school days from `today`, and its enrollment history. 404 when the caller belongs to no family.",
    permission: null, alsoAllowed: "the caller's own family: their live person's family in the tenant, matched by the address they signed in with",
    query: { today: S.str },
    allowed: async () => true,
    response: S.obj({
      familyId: S.str, family: S.list(S.row('the family with its parents\' first names')), enrollment: S.nullable(S.row('the enrollment')),
      eligibleKids: S.list(S.row('a child eligible this enrollment year')), enrolledStudents: S.list(S.row("a child's class this academic year")),
      upcomingEvents: S.list(S.row('a school day')), paymentHistory: S.list(S.row('a year and its enrollment status')),
    }),
    handle: async c => {
      const familyId = await ownFamilyOf(c.store, (c as PersonCall).caller)
      if (!familyId) return notFound('the caller belongs to no family')
      const y = await yearRules(c.tenant.id)
      const at = ports().clock.now()
      const today = DAY.test(c.query.today ?? '') ? c.query.today! : localDateStr(y, at)
      const [family, enrollment, eligibleKids, enrolledStudents, upcomingEvents, paymentHistory] = await Promise.all([
        familyWithParentNames(familyId),
        getEnrollment(c.tenant.id, familyId, enrollmentYear(y, at)),
        familyEligibleForYear(c.tenant.id, familyId, enrollmentYear(y, at)),
        familyClassesOfYear(c.tenant.id, familyId, currentAcademicYear(y, at)),
        nextSchoolDays(c.tenant.id, today),
        familyEnrollmentHistory(c.tenant.id, familyId),
      ])
      return ok({ familyId, family, enrollment: enrollment ?? null, eligibleKids, enrolledStudents, upcomingEvents, paymentHistory })
    },
  },
  {
    method: 'GET', path: `${T}/principal`, operationId: 'help.principal',
    summary: "The principal's help: the principal's work and its counts for this enrollment and academic year.",
    permission: 'roster.write',
    allowed: async c => may(c.caller, 'roster.write'),
    response: S.obj({ work: S.row("the principal's work: totals and pending items"), counts: S.row("the page's own counts") }),
    handle: async c => {
      const y = await yearRules(c.tenant.id)
      const at = ports().clock.now()
      return ok({
        work: await getPrincipalWork(c.tenant.id),
        counts: await principalHelpCounts(c.tenant.id, enrollmentYear(y, at), currentAcademicYear(y, at)),
      })
    },
  },
]
