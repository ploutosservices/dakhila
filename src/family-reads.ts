// THE ROSTER'S FAMILY READS: the families list, a family's fields for editing, the enrollment tracker and the
// principal's enrollment summary, each with its who-may. The reader keeps its words and its layout.
import { may, ownFamilyOf } from './access'
import type { PersonCall, Route } from './routes'
import { badRequest, notFound, ok, S } from './op'
import { familyRecipients, schoolYearRecipientsForPerson } from './lib/family-recipients'
import { familiesForList, familyIdsWithStatus, familyForEdit, tenantPersonsBrief } from './lib/roster-families-list'
import { enrolledStudentsOfFamilies, membersOfFamilies, trackerFamiliesForYear, trackerStatusesForYears } from './lib/enrollment-tracker'

const T = '/v1/tenants/{slug}/roster'
const OWN = "a caller without roster.read: their own family only (their live person's family, matched by the address they signed in with)"

const FAMILY_ROW = S.obj({ id: S.uuid, legacyFamilyId: S.nullable(S.num), city: S.nullable(S.str), state: S.nullable(S.str), motherId: S.nullable(S.uuid), fatherId: S.nullable(S.uuid) })
const LIST = S.obj({
  families: S.list(FAMILY_ROW),
  persons: S.list(S.obj({ id: S.uuid, firstName: S.str, lastName: S.nullable(S.str), familyId: S.nullable(S.uuid), email: S.nullable(S.str) })),
})

/** The list: every family for a reader, else the caller's own; filtered to the tracker's year and status when both
 *  are asked (a reader's filter only). */
async function list(c: PersonCall, year: number | null, status: string | null) {
  const reader = may(c.caller, 'roster.read')
  let families = await familiesForList(c.tenant.id, reader ? 'all' : { familyId: await ownFamilyOf(c.store, c.caller) })
  if (reader && year && status) {
    const ids = await familyIdsWithStatus(c.tenant.id, year, status)
    families = families.filter(f => ids.has(f.id))
  }
  return ok({ families, persons: await tenantPersonsBrief(c.tenant.id) })
}

const YEARS = (n: number) => Array.from({ length: n })

export const FAMILY_READ_ROUTES: Route[] = [
  // WHO A SCHOOL-YEAR LETTER GOES TO: a classroom mail asks the family's list, by the family or by one of its people.
  // The callers that send them hold google.write, so it is admitted beside roster.read.
  {
    method: 'GET', path: `${T}/families/{id}/school-year-recipients`, operationId: 'family.schoolYearRecipients',
    summary: "The family's school-year list: its students enrolled this session and the parents, with any member who teaches this session — personal addresses only, once each, in this order: the students, the mother, the father, then the members who teach.",
    permission: 'roster.read', alsoAllowed: 'google.write: the callers that write to a family in Google',
    allowed: async c => may(c.caller, 'roster.read') || may(c.caller, 'google.write'),
    response: S.list(S.str),
    handle: async c => ok(await familyRecipients(c.tenant.id, c.params.id, 'school-year')),
  },
  {
    method: 'GET', path: `${T}/persons/{id}/school-year-recipients`, operationId: 'person.schoolYearRecipients',
    summary: "The school-year list of the family the person belongs to (empty when they have none) — for a letter about one student or teacher.",
    permission: 'roster.read', alsoAllowed: 'google.write: the callers that write to a family in Google',
    allowed: async c => may(c.caller, 'roster.read') || may(c.caller, 'google.write'),
    response: S.list(S.str),
    handle: async c => ok(await schoolYearRecipientsForPerson(c.tenant.id, c.params.id)),
  },
  {
    method: 'GET', path: `${T}/families`, operationId: 'family.list',
    summary: "The families list: the tenant's families newest first, and every live person's name, family and address — for a reader; a caller without roster.read gets their own family only.",
    permission: 'roster.read', alsoAllowed: OWN,
    allowed: async () => true,
    response: LIST,
    handle: c => list(c as PersonCall, null, null),
  },
  {
    method: 'GET', path: `${T}/families/tracker-status/{year}/{status}`, operationId: 'family.listByTrackerStatus',
    summary: "The families list filtered to the families whose tracker row for the year holds the status (enrolled, pending, declined or a number); a caller without roster.read gets their own family, unfiltered.",
    permission: 'roster.read', alsoAllowed: OWN,
    textParams: ['year', 'status'],
    allowed: async () => true,
    response: LIST,
    handle: c => {
      const year = parseInt(c.params.year)
      if (!Number.isFinite(year)) return Promise.resolve(badRequest('year must be a number'))
      return list(c as PersonCall, year, c.params.status)
    },
  },
  {
    method: 'GET', path: `${T}/families/{id}/edit`, operationId: 'family.forEdit',
    summary: "A family's row and its live members, whole: what family.update saves back.",
    permission: 'roster.write', alsoAllowed: "the caller's own family",
    allowed: async c => may(c.caller, 'roster.write') || (await ownFamilyOf(c.store, c.caller)) === c.params.id,
    response: S.obj({ family: S.row('the roster_families row'), members: S.list(S.row('a live persons row of the family')) }),
    handle: async c => {
      const loaded = await familyForEdit(c.tenant.id, c.params.id)
      return loaded ? ok(loaded) : notFound('no such family in this tenant')
    },
  },
  {
    method: 'GET', path: `${T}/tracker/{year}`, operationId: 'tracker.year',
    summary: "One year's enrollment tracker: each family's tracker row with its parents and fee enrollment status, the families' live members (what the eligible-kids rule reads), and the students each enrolled family registered.",
    permission: 'roster.write',
    textParams: ['year'],
    allowed: async c => may(c.caller, 'roster.write'),
    response: S.obj({
      rows: S.list(S.row('a tracker row: familyId, legacyFamilyId, enrollmentStatus, feeEnrollmentStatus, registrationDate, the parents\' first names, addresses and phones')),
      members: S.list(S.obj({ familyId: S.nullable(S.uuid), firstName: S.str, role: S.nullable(S.str), firstGradeYear: S.nullable(S.num) })),
      registered: S.list(S.obj({ familyId: S.nullable(S.uuid), firstName: S.str, firstGradeYear: S.nullable(S.num) })),
    }),
    handle: async c => {
      const year = parseInt(c.params.year)
      if (!Number.isFinite(year)) return badRequest('year must be a number')
      const rows = await trackerFamiliesForYear(c.tenant.id, year)
      const familyIds = [...new Set(rows.map(r => r.familyId))]
      return ok({
        rows,
        members: await membersOfFamilies(familyIds),
        registered: await enrolledStudentsOfFamilies(c.tenant.id, year, familyIds),
      })
    },
  },
  {
    method: 'GET', path: `${T}/tracker/statuses/{fromYear}/{years}`, operationId: 'tracker.statuses',
    summary: "The tracker's rows for `years` years from `fromYear` back, each with its fee enrollment's status: the principal's enrollment summary.",
    permission: 'roster.write',
    textParams: ['fromYear', 'years'],
    allowed: async c => may(c.caller, 'roster.write'),
    response: S.list(S.obj({ year: S.num, enrollmentStatus: S.nullable(S.num), feeEnrollmentStatus: S.nullable(S.str) })),
    handle: async c => {
      const from = parseInt(c.params.fromYear), n = parseInt(c.params.years)
      if (!Number.isFinite(from) || !Number.isFinite(n) || n < 1 || n > 20) return badRequest('fromYear and years (1 to 20) must be numbers')
      return ok(await trackerStatusesForYears(c.tenant.id, YEARS(n).map((_, i) => from - i)))
    },
  },
]
