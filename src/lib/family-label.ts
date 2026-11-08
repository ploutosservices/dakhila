// A FAMILY'S DISPLAY NAME, AND THE BURSAR'S OTHER CAPTIONS — words, built by the reader from the data the roster API
// answers. Pure: no store, so a reader builds them from the API's rows and host code from its own reads, by one rule.

/** A family's parents' names as the store holds them, and its legacy number for a family with neither. */
export type FamilyName = { id: string; legacyFamilyId: number | null; mother: string | null; father: string | null }

/**
 * WHAT A FAMILY IS CALLED — the family's own property, asked for once (roster-families.ts re-exports it).
 *
 * The father's surname first; the mother's when there is no father; and only when the family has neither does it say
 * so in words rather than with a punctuation mark nobody can read.
 */
export function familySurname(f: { fatherLast?: string | null; motherLast?: string | null }): string {
  return (f.fatherLast ?? '').trim() || (f.motherLast ?? '').trim() || '(unnamed family)'
}

/** "Mother / Father", or "Family <legacy id>" when it has none named. */
export function familyLabel(n: FamilyName | undefined): string {
  if (!n) return ''
  return [n.mother, n.father].filter(Boolean).join(' / ') || `Family ${n.legacyFamilyId}`
}

/** Each family's label by id. */
export function labelsOf(names: FamilyName[]): Map<string, string> {
  return new Map(names.map(n => [n.id, familyLabel(n)]))
}

/** The families as a pick list, labelled, by label in the order handed in (the school's language's collation). */
export function familyOptions(names: FamilyName[], byName: (a: string, b: string) => number): { id: string; label: string }[] {
  return names.map(n => ({ id: n.id, label: familyLabel(n) })).sort((a, b) => byName(a.label, b.label))
}

/** "First Last" of a person's two name parts. */
export function personName(p: { firstName: string; lastName: string | null }): string {
  return `${p.firstName}${p.lastName ? ' ' + p.lastName : ''}`
}
