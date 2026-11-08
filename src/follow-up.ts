// THE FOLLOW-UP TRACKER: its reads and its two acts. A roster writer sees and sets every family; anyone else sees their own family and sets it to one of the statuses the school lets a family set
// (SchoolRules.codes.enrollmentStatus.familyMaySet).
import { may, ownFamilyOf } from './access'
import type { PersonCall, Route } from './routes'
import { badRequest, field, ok, refused, S } from './op'
import { enrollmentYearOf } from './lib/year-context'
import { tenantRules } from './lib/rules-context'
import { followUpRows, lastEnrolledYears, tenantFamilyIds } from './lib/enrollment-tracker'
import { batchInsertTrackerRows, getAllFamilyIds, upsertTrackerStatusUpdate } from './lib/roster-families'

const T = '/v1/tenants/{slug}/roster/follow-up'
const OWN = "anyone else: their own family (their live person's family, matched by the address they signed in with)"

export const FOLLOW_UP_ROUTES: Route[] = [
  {
    method: 'GET', path: `${T}/{year}`, operationId: 'followUp.year',
    summary: "The follow-up tracker for a year: every family's row and the tenant's family ids for a roster writer, the caller's own family's row for anyone else; and the last year each family enrolled.",
    permission: 'roster.write', alsoAllowed: OWN,
    textParams: ['year'],
    allowed: async () => true,
    response: S.obj({
      lastEnrolled: S.list(S.obj({ familyId: S.nullable(S.uuid), lastYear: S.nullable(S.num) })),
      familyId: S.nullable(S.uuid),
      rows: S.list(S.row('a follow-up row: trackerId, familyId, legacyFamilyId, the parents\' names, trackerStatus, feeEnrollmentStatus')),
      familyIds: S.list(S.uuid),
    }),
    handle: async c => {
      const pc = c as PersonCall
      const year = parseInt(c.params.year)
      if (!Number.isFinite(year)) return badRequest('year must be a number')
      const lastEnrolled = await lastEnrolledYears(c.tenant.id)
      if (may(pc.caller, 'roster.write')) {
        return ok({ lastEnrolled, familyId: null, rows: await followUpRows(c.tenant.id, year), familyIds: (await tenantFamilyIds(c.tenant.id)).map(f => f.id) })
      }
      const familyId = await ownFamilyOf(c.store, pc.caller)
      return ok({ lastEnrolled, familyId, rows: familyId ? await followUpRows(c.tenant.id, year, familyId) : [], familyIds: [] })
    },
  },
  {
    method: 'PUT', path: `${T}/families/{id}/{year}`, operationId: 'followUp.setStatus',
    summary: "A family's tracker status for a year. Registered is derived from payment and is refused; a family sets its own row only to the statuses the school lets a family set.",
    permission: 'roster.write', alsoAllowed: OWN,
    textParams: ['year'],
    allowed: async c => may(c.caller, 'roster.write') || (await ownFamilyOf(c.store, c.caller)) === c.params.id,
    request: S.obj({ status: S.num }),
    response: S.obj({ ok: S.bool }),
    handle: async c => {
      const pc = c as PersonCall
      const status = field.num(c.body, 'status')
      const codes = (await tenantRules(c.tenant.id)).codes.enrollmentStatus
      if (status === codes.registered) return refused('Registered status is derived from payment and cannot be set manually.')
      if (!may(pc.caller, 'roster.write') && !codes.familyMaySet.includes(status)) return refused('Forbidden')
      await upsertTrackerStatusUpdate(c.tenant.id, c.params.id, Number(c.params.year), status)
      return ok({ ok: true })
    },
  },
  {
    method: 'POST', path: `${T}/backfill`, operationId: 'followUp.backfill',
    summary: "Every family put on next enrollment year's tracker as invited.",
    permission: 'roster.write',
    allowed: async c => may(c.caller, 'roster.write'),
    response: S.obj({ ok: S.bool }),
    handle: async c => {
      const { invited } = (await tenantRules(c.tenant.id)).codes.enrollmentStatus
      await batchInsertTrackerRows(c.tenant.id, await getAllFamilyIds(c.tenant.id), (await enrollmentYearOf(c.tenant.id)) + 1, invited)
      return ok({ ok: true })
    },
  },
]
