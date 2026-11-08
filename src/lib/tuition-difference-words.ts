// THE TUITION RECONCILIATION'S ROWS, LABELLED, store-free (tuition-differences.ts reads them), so a reader that takes the
// rows from the roster API does not reach its tables by import.
import { labelsOf, type FamilyName } from './family-label'

/** A row as data; its family's display name is built by the reader (family-label.ts). */
export type TuitionDifferenceRow = { familyId: string; status: string; firstPaid: string | null; studentCount: number; fee: number; paid: number }
export type TuitionDifference = TuitionDifferenceRow & { label: string }

/** The rows labelled by their families' names. */
export function differWords(rows: TuitionDifferenceRow[], names: FamilyName[]): TuitionDifference[] {
  const label = labelsOf(names)
  return rows.map(r => ({ ...r, label: label.get(r.familyId) ?? '' }))
}
