// THE RUN'S SMALL WORDS — the presence predicate, the address normalization, the named gate checks and who the
// participants are — pure (three-universes.ts imports and re-exports them), so a reader of these alone does not reach
// the run's loader, which reads the roster.
import type { RunResult } from './three-universes'

/** Presence predicate — one predicate for every text field tested for presence:
 *  missing = NULL or trimmed empty. NULL and '' are the SAME missing state. */
export function isMissing(v: string | null | undefined): boolean {
  return v == null || v.trim() === ''
}

/** One way to compare two addresses, and one owner for it. Exported because a reader of a family card has to
    ask "is the person reading this the person on this line?" and a second copy of the rule is a
    second answer waiting to disagree with this one. */
export function normEmail(v: string): string {
  return v.trim().toLowerCase()
}

/** Named gate checks. The two closed lists — roster ledger + snapshot asserted
 *  structure — are exactly these; no implementation improvises its own. */
export const CHECK = {
  emailUnique: 'persons.email uniqueness',
  classroomEmailUnique: 'classroom_email uniqueness',
  familyPresent: 'family present and resolving',
  readability: 'named-person readability',
  enrollmentFamily: 'enrollment→family resolution',
  oneIdPerTime: 'one classroomId per (start, end)',
  studentOverlap: 'student time-overlap',
  classTimes: 'class times present and canonical',
  snapshotFields: 'snapshot fields presence',
  snapshotRole: 'snapshot role token',
  snapshotKey: 'snapshot key-uniqueness',
} as const

/** THE PARTICIPANTS — whoever is in the map: every person a projection fact names: a participant
 *  is whoever is in the three-universes map. Null when the run refused — a refused run names nobody. */
export function participants(run: RunResult): Set<string> | null {
  if (!run.accepted) return null
  return new Set(run.projection.flatMap(r => r.facts.map(f => f.personId)))
}
