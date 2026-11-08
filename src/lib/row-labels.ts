// The two row labels of a family card and a family's classroom table, store-free (course-display.ts re-exports them),
// so a reader that only labels rows does not reach the roster's tables by import.
import { rosterClassCode } from './roster-class-code'
import type { ClassRow, PersonRow } from './three-universes'

// Short codes in tables, never fullName.
export function classLabel(c: ClassRow): string {
  return rosterClassCode(c)
}

export function personLabel(p: PersonRow): string {
  return p.lastName ? `${p.firstName} ${p.lastName}` : p.firstName
}
