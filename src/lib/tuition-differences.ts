// THE TUITION RECONCILIATION'S ROWS — every enrollment of the year whose paid differs from what it owes, labelled by
// its parents. One reader for every view of it: no two codes for the same idea. What owed and paid are is tuition-owed-store.ts.
import { enrollmentsOfYear, familiesWithParents } from './enrollment-reads'
import { owedAndPaid } from './tuition-owed-store'
import { paidDiffersFromOwed } from './tuition-owed'
import type { TuitionDifferenceRow } from './tuition-difference-words'
// The rows' type and their labelling live in tuition-difference-words.ts, store-free.
export { differWords, type TuitionDifferenceRow, type TuitionDifference } from './tuition-difference-words'

export async function tuitionDifferences(tenantId: string, year: number): Promise<TuitionDifferenceRow[]> {
  const enrollments = await enrollmentsOfYear(tenantId, year)
  const money = await owedAndPaid(enrollments.map(e => e.id))
  // A family that started and never paid has no moment that sets its rate (people sometimes start enrollment and
  // never pay); it is still pending, with its reminder, not a row here.
  const differing = enrollments.filter(e => {
    const m = money.get(e.id)
    return !!e.familyId && !!m?.firstPaid && paidDiffersFromOwed(m.paid, m.owed)
  })
  const families = await familiesWithParents(tenantId, differing.map(e => e.familyId as string))
  const familyById = new Map(families.map(f => [f.id, f]))
  return differing.flatMap(e => {
    const f = familyById.get(e.familyId as string)
    const m = money.get(e.id)
    if (!f || !m?.firstPaid) return []
    return [{ familyId: f.id, status: e.status ?? '', firstPaid: m.firstPaid.toISOString(), studentCount: m.counted, fee: m.owed, paid: m.paid }]
  }).sort((a, b) => (b.paid - b.fee) - (a.paid - a.fee))
}
