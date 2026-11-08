import type { persons } from '../tables'

export type Person = typeof persons.$inferSelect

export type Relationship = {
  id: string
  personAId: string
  personBId: string
  type: string
  status: string
  endYear: number | null
}

// Returns true if this person has at least one active spouse relationship
export function hasActiveSpouse(personId: string, relationships: Relationship[]): boolean {
  return relationships.some(r =>
    r.type === 'spouse' &&
    r.status === 'active' &&
    (r.personAId === personId || r.personBId === personId)
  )
}

export type RelatedPerson = {
  relationshipId: string
  personId: string
  firstName: string
  lastName: string | null
  middleName: string | null
  gender: string | null
  birthYear: number | null
  deathYear: number | null
  type: string
  status: string
  endYear: number | null
}

export function displayName(p: Pick<Person, 'firstName' | 'middleName' | 'lastName'>): string {
  return [p.firstName, p.middleName, p.lastName].filter(Boolean).join(' ')
}

/**
 * What a relationship is CALLED on screen, given the related person's gender.
 *
 * When the related person's gender is known, the word is mother/father or son/daughter rather
 * than parent or child: `getRelationshipsByPerson()` (genealogy.ts) selects `gender` on both sides of every row. Both
 * halves of the rule come from this one place.
 *
 * `type` STAYS the machine field — 'parent', 'child', 'spouse' — because readers branch on it (a spouse row can be
 * ended). This decides the WORD, nothing else.
 *
 * WHAT IT CANNOT DO: a parent row holding `gender = 'child'` names no sex; it is what a person saved without an
 * explicit choice of gender holds. Those rows keep reading "parent" until somebody sets a sex, and that is the honest
 * answer rather than a guess from the name.
 *
 * 'boy'/'girl' are accepted alongside 'male'/'female' because the persons table's gender column may hold them — one
 * meaning for one column.
 */
export function relationshipLabel(type: string, gender: string | null | undefined): string {
  const g = (gender ?? '').toLowerCase()
  const male = g === 'male' || g === 'boy'
  const female = g === 'female' || g === 'girl'
  if (type === 'parent') return male ? 'father' : female ? 'mother' : 'parent'
  if (type === 'child') return male ? 'son' : female ? 'daughter' : 'child'
  return type
}

/**
 * The one order siblings are ever shown in — eldest first.
 *
 * `birthOrder` before `birthYear`: a birth order can be recorded where no year is. Falling back to
 * the name last means the order is at least STABLE when neither is known, never insertion
 * order, which changes whenever the data is reloaded.
 *
 * Anyone carrying a rank or a year sorts above anyone carrying neither, so partial
 * knowledge is used rather than discarded. Names compare in the order the caller hands in (its language's collation).
 */
type SiblingFields = Pick<Person, 'birthOrder' | 'birthYear' | 'firstName' | 'middleName' | 'lastName'>
export function siblingOrder(byName: (a: string, b: string) => number): (a: SiblingFields, b: SiblingFields) => number {
  return (a, b) => {
    if (a.birthOrder != null && b.birthOrder != null) return a.birthOrder - b.birthOrder
    if (a.birthOrder != null) return -1
    if (b.birthOrder != null) return 1
    if (a.birthYear != null && b.birthYear != null) return a.birthYear - b.birthYear
    if (a.birthYear != null) return -1
    if (b.birthYear != null) return 1
    return byName(displayName(a), displayName(b))
  }
}
