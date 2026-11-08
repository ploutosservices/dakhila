// THE CURRENT SESSION, store-free (three-universes.ts re-exports it): the academic year in session (years.ts), at an
// instant, in the school's zone.
import { currentAcademicYear, type YearRules } from './years'

/** The current session: the one boundary rule (the school's first day) at an instant in the tenant's zone. */
export function currentSessionYear(y: YearRules, at: Date): number {
  return currentAcademicYear(y, at)
}
