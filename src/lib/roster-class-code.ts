// A ROSTER CLASS'S SHORT FORM INCLUDES ITS SECTION — one property, one place.
//
// The short form is a property of the roster class and includes the section: course code X2 with section B is "X2B",
// on every list, dropdown and export alike — never the course code alone, and never "X2-B", "X2 · B" or "X2 (B)".
//
// Pure: no store import, so every reader formats a class the same way.

export type RosterClassCodeParts = { shortCode: string | null; section: string | null }

export function rosterClassCode(c: RosterClassCodeParts): string {
  const code = (c.shortCode ?? '').trim() || '(no course)'
  const section = (c.section ?? '').trim()
  return `${code}${section}`
}

/** Two class codes in level order, numbers read as numbers (X2 before X10), the rest by code point: a code is the
 *  school's identifier, so no language decides its order. */
export function compareClassCodes(a: string, b: string): number {
  const split = (s: string) => s.match(/\d+|\D+/g) ?? []
  const x = split(a), y = split(b)
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const p = x[i], q = y[i]
    const n = /^\d/.test(p) && /^\d/.test(q) ? Number(p) - Number(q) : p < q ? -1 : p > q ? 1 : 0
    if (n !== 0) return n
  }
  return x.length - y.length
}

// Classes in level order by their short form, numbers read as numbers: X1 X2 … X9 X10, Y2A Y2B … Y9 Y11.
export function byRosterClassCode(a: RosterClassCodeParts, b: RosterClassCodeParts): number {
  return compareClassCodes(rosterClassCode(a), rosterClassCode(b))
}
