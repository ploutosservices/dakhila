// THE THREE-UNIVERSES RUN: the run lib/three-universes.ts makes from the roster and the Google snapshot, answered to
// whom it may be shown. google.read sees the whole run; household.read sees only its own family's card. Each answer
// carries the family facts (the session's first school day, each projected class's department), so a reader builds a
// family's classroom table without reading the roster itself.
import { and, eq, isNull } from 'drizzle-orm'
import { may, ownFamilyOf } from './access'
import type { PersonCall, Route } from './routes'
import { mayOrOwn, ok, OWN_FAMILY, S } from './op'
import { persons } from './tables'
import { joinedIndex, joinedRecord } from './lib/student-joined'
import type { RunResult } from './lib/three-universes'
import { runThreeUniverses } from './lib/three-universes-load'
import { namesForRejections } from './lib/rejection-names'
import { familyFactsFor } from './lib/family-classes-load'
import { cardClassIds } from './lib/family-classes-build'

const T = '/v1/tenants/{slug}/roster/universe'

/** A run as JSON: its one Map, whose address each student is shown by, as an object. */
export function runAsJson(run: RunResult): unknown {
  return run.accepted ? { ...run, addressSource: Object.fromEntries(run.addressSource) } : run
}

export const UNIVERSE_ROUTES: Route[] = [
  {
    method: 'GET', path: `${T}/families/{id}`, operationId: 'universe.family',
    summary: "A family's view of the current run: the year, its card (null when it has none or the run refused), the card's family facts, and whether each of the family's people joined each Classroom of the session (joined marks keyed studentId:classId, unknown pairs left out).",
    permission: 'roster.read', alsoAllowed: OWN_FAMILY,
    allowed: async c => mayOrOwn(c, 'roster.read', c.params.id),
    response: S.obj({
      accepted: S.bool, year: S.num,
      card: S.nullable(S.row('a family card (src/lib/three-universes.ts FamilyCard)')),
      familyFacts: S.obj({ schoolStart: S.nullable(S.date), departments: S.row('class id to department') }),
      joined: S.row('studentId:classId to a joined state (src/lib/student-joined.ts JoinedRecord)'),
    }),
    handle: async c => {
      const run = await runThreeUniverses(c.tenant.id)
      const card = run.accepted ? run.familyCards.find(k => k.familyId === c.params.id) ?? null : null
      const members = await c.store.select({ id: persons.id }).from(persons)
        .where(and(eq(persons.tenantId, c.tenant.id), eq(persons.familyId, c.params.id), isNull(persons.deletedAt)))
      const classIds = run.accepted ? run.roster.classes.map(k => k.id) : []
      const pairs = members.flatMap(m => classIds.map(classId => ({ studentId: m.id, classId })))
      const joined = joinedRecord(await joinedIndex(c.tenant.id, run), pairs)
      return ok({ accepted: run.accepted, year: run.year, card, familyFacts: await familyFactsFor(c.tenant.id, run.year, card ? cardClassIds(card) : []), joined })
    },
  },
  {
    method: 'GET', path: `${T}/session-classrooms`, operationId: 'universe.sessionClassrooms',
    summary: "The Google classrooms the current session uses — every roster class's classroom and every projected room — or null when the run refuses.",
    permission: 'drive.read',
    allowed: async c => may(c.caller, 'drive.read'),
    response: S.obj({ classrooms: S.nullable(S.list(S.str)) }),
    handle: async c => {
      const run = await runThreeUniverses(c.tenant.id)
      if (!run.accepted) return ok({ classrooms: null })
      return ok({ classrooms: [...new Set([
        ...run.roster.classes.map(k => k.classroomCourseId).filter((x): x is string => !!x),
        ...run.projection.map(p => p.courseId),
      ])] })
    },
  },
  {
    method: 'GET', path: T, operationId: 'universe.run',
    summary: "The current session's three-universes run — the roster, its projection into Google Classroom and the Google snapshot, or the data-quality gate's refusal with the names it names — and the family facts for every family card.",
    permission: 'google.read',
    allowed: async c => may(c.caller, 'google.read'),
    response: S.obj({
      run: S.row("the run (src/lib/three-universes.ts RunResult), `addressSource` as an object"),
      rejectionNames: S.row('person id to name, for a refused run'),
      familyFacts: S.obj({ schoolStart: S.nullable(S.date), departments: S.row('class id to department') }),
    }),
    handle: async c => {
      const run = await runThreeUniverses(c.tenant.id)
      const classIds = run.accepted ? [...new Set(run.familyCards.flatMap(cardClassIds))] : []
      return ok({
        run: runAsJson(run),
        rejectionNames: run.accepted ? {} : await namesForRejections(c.tenant.id, run.rejections),
        familyFacts: await familyFactsFor(c.tenant.id, run.year, classIds),
      })
    },
  },
  {
    method: 'GET', path: `${T}/mine`, operationId: 'universe.mine',
    summary: "The caller's own family's card from the current run, with its family facts; `accepted` false when the run was refused (a family is never shown the refusal's rows), `card` null when the family has none.",
    permission: 'household.read', alsoAllowed: "only the caller's own family's card: their live person's family, by the address they signed in with",
    allowed: async c => may(c.caller, 'household.read'),
    response: S.obj({ accepted: S.bool, year: S.num, card: S.nullable(S.row('a family card (src/lib/three-universes.ts FamilyCard)')), familyFacts: S.obj({ schoolStart: S.nullable(S.date), departments: S.row('class id to department') }) }),
    handle: async c => {
      const run = await runThreeUniverses(c.tenant.id)
      const familyId = await ownFamilyOf(c.store, (c as PersonCall).caller)
      const card = run.accepted && familyId ? run.familyCards.find(k => k.familyId === familyId) ?? null : null
      return ok({ accepted: run.accepted, year: run.year, card, familyFacts: await familyFactsFor(c.tenant.id, run.year, card ? cardClassIds(card) : []) })
    },
  },
]
