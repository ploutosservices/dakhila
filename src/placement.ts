// PLACEMENT: the two standby moves (lib/placement-moves.ts), asked placement.write; and its two reads, the standby
// board and the placement-sync comparison (lib/roster-standby.ts, enrollment-placement-sync.ts), asked placement.read.
import { may } from './access'
import type { PersonCall, Route } from './routes'
import { badRequest, field, ok, refused, result, S } from './op'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
import { moveToRecommendedAct, assignFromStandbyAct } from './lib/placement-moves'
import { departmentsTaughtBy, languageCoursesOfYear, standbyStudents, placementMismatches } from './lib/roster-standby'
import { enrollmentPlacementSync } from './lib/enrollment-placement-sync'

const T = '/v1/tenants/{slug}/roster/placement/students/{id}'
const P = '/v1/tenants/{slug}/roster/placement'

function yearOf(s: string): number | null {
  const y = parseInt(s)
  return Number.isFinite(y) ? y : null
}

export const PLACEMENT_ROUTES: Route[] = [
  {
    method: 'GET', path: `${P}/standby/{year}`, operationId: 'placement.standby',
    summary: "The standby board for a placement year: whether the caller may place; to a caller who may not, the departments they teach in `classYear` and only those departments' standby students; to a placer, the year's language courses and the students placed against their evaluation of `evalYear`.",
    permission: 'placement.read',
    textParams: ['year'],
    query: { classYear: S.str, evalYear: S.str },
    allowed: async c => may(c.caller, 'placement.read'),
    response: S.obj({
      canPlace: S.bool, departments: S.nullable(S.list(S.str)),
      languageCourses: S.list(S.row('a language course of the year (src/lib/roster-standby.ts languageCoursesOfYear)')),
      standby: S.list(S.row('a standby student (src/lib/roster-standby.ts standbyStudents)')),
      mismatches: S.list(S.row('a placement against the evaluation (src/lib/roster-standby.ts placementMismatches)')),
    }),
    handle: async c => {
      const year = yearOf(c.params.year), classYear = yearOf(c.query.classYear ?? ''), evalYear = yearOf(c.query.evalYear ?? '')
      if (year === null || classYear === null || evalYear === null) return badRequest('year, classYear and evalYear must be numbers')
      const caller = (c as PersonCall).caller
      const canPlace = may(caller, 'placement.write')
      const departments = canPlace ? null : await departmentsTaughtBy(c.tenant.id, caller.email, classYear)
      if (departments !== null && departments.length === 0) return ok({ canPlace, departments, languageCourses: [], standby: [], mismatches: [] })
      return ok({
        canPlace, departments,
        languageCourses: canPlace ? await languageCoursesOfYear(c.tenant.id, year) : [],
        standby: await standbyStudents(c.tenant.id, year, departments),
        mismatches: canPlace ? await placementMismatches(c.tenant.id, evalYear, year) : [],
      })
    },
  },
  {
    method: 'GET', path: `${P}/sync/{year}`, operationId: 'placement.sync',
    summary: "The year's enrollments compared with the roster's placements: the families whose enrolled students' language placements are out of step (src/lib/enrollment-placement-sync.ts PlacementSyncResult).",
    permission: 'placement.read',
    textParams: ['year'],
    allowed: async c => may(c.caller, 'placement.read'),
    response: S.row('the comparison (src/lib/enrollment-placement-sync.ts PlacementSyncResult)'),
    handle: async c => {
      const year = yearOf(c.params.year)
      if (year === null) return badRequest('year must be a number')
      return ok(await enrollmentPlacementSync(c.tenant.id, year))
    },
  },
  {
    method: 'POST', path: `${T}/recommended`, operationId: 'placement.moveToRecommended',
    summary: "A student moved out of their next-year language class into the recommended course's class, made when the year has none.",
    permission: 'placement.write',
    allowed: async c => may(c.caller, 'placement.write'),
    textParams: ['id'],
    request: S.obj({ courseId: S.uuid, year: S.num }),
    response: S.obj({}),
    // An id that names no student is the act's own refusal.
    handle: async c => UUID.test(c.params.id)
      ? result(await moveToRecommendedAct(c.tenant.id, c.params.id, field.str(c.body, 'courseId'), field.num(c.body, 'year')))
      : refused('No language enrollment found for next year'),
  },
  {
    method: 'POST', path: `${T}/from-standby`, operationId: 'placement.assignFromStandby',
    summary: "A student moved out of their standby enrollment into the chosen course's class of the year.",
    permission: 'placement.write',
    allowed: async c => may(c.caller, 'placement.write'),
    textParams: ['id'],
    request: S.obj({ courseId: S.uuid, year: S.num }),
    response: S.obj({}),
    handle: async c => UUID.test(c.params.id)
      ? result(await assignFromStandbyAct(c.tenant.id, c.params.id, field.str(c.body, 'courseId'), field.num(c.body, 'year')))
      : refused('No standby enrollment found'),
  },
]
