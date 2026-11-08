// Which email address represents a student in the CLASSROOM universe.
//
// THE TWO UNIVERSES, because this file is exactly where they meet:
//
//   FAMILY universe    persons.email is whose address it IS. It belongs to one
//                      person, it is theirs, and the family maintains it.
//   CLASSROOM universe needs an address to represent a student for one session.
//                      That is a different question, and its answer may be a
//                      parent's address — borrowed, never copied.
//
// `persons.guardian` is the bridge: a POINTER on the child's record naming which
// parent's address represents them. Nothing is duplicated, so the family universe
// is untouched — which is why this works at all despite persons.email being
// unique per tenant.
//
// A child uses a parent's email address by setting a field on its record whose
// value is mother or father (the `guardian` field); the classroom
// universe picks it up.
//
// So `persons.guardian` is a POINTER, not a copy — 1 = mother, 2 = father, and
// the address stays on the parent's row. That is why a child can use a parent's
// address at all despite persons.email being unique per tenant: nothing is
// duplicated, the student simply resolves through the pointer.
//
// NO TEACHER CONDITION: teacher roles use school-issued addresses only, so a
// teaching parent's personal address is lent like any other. The rule is: the
// student's own address if populated, else the guardian-named parent's if
// populated, else none.
//
// ONE ADDRESS IS NEVER A STUDENT'S: a school-issued one. A teacher's PRIMARY
// address may itself be in the school's directory domain, and children of a teacher
// do not use a school-issued address. Own or borrowed, such an address resolves to
// none, and the map shows the child as having no address.

import { isTeacherDomainAddress } from './teacher-classroom-address'

/** 1 = use the mother's address, 2 = use the father's. Anything else = their own. */
export const GUARDIAN_MOTHER = 1
export const GUARDIAN_FATHER = 2

export type StudentAddressInput = {
  /** The student's own address, if they have one. */
  email: string | null
  guardian: number | null
  motherId: string | null
  fatherId: string | null
  motherEmail: string | null
  fatherEmail: string | null
  /** The tenant's directory domain (workspaceDomain(tenantId)): a student never stands on an address in it. */
  domain: string
}

export type StudentAddress = {
  /** The address that represents this student, or null when none is available. */
  email: string | null
  /** Where it came from — 'own', or the parent lending it. */
  source: 'own' | 'mother' | 'father' | 'none'
}

/**
 * The student's OWN address always wins when they have one: the pointer is a
 * fallback for a child with no address of their own, not an override.
 *
 * Sibling contention is NOT decided here. It is not a property of one student.
 *
 * It is settled at check (4) of the three-universes run — the collision report: every
 * participant standing on a contested address DROPS and is shown, rather than one
 * of them being given the address — runThreeUniverses() in three-universes.ts applies it
 * over a cohort, and getBoard() in classroom-board.ts reads that run. The emission rule is what is read; no table
 * records an allocation.
 */
export function resolveStudentAddress(p: StudentAddressInput): StudentAddress {
  const none: StudentAddress = { email: null, source: 'none' }
  const allowed = (a: string) => !isTeacherDomainAddress(a, p.domain)

  if (p.email?.trim()) {
    const own = p.email.trim().toLowerCase()
    return allowed(own) ? { email: own, source: 'own' } : none
  }

  if (p.guardian === GUARDIAN_MOTHER && p.motherId && p.motherEmail?.trim()) {
    const lent = p.motherEmail.trim().toLowerCase()
    return allowed(lent) ? { email: lent, source: 'mother' } : none
  }

  if (p.guardian === GUARDIAN_FATHER && p.fatherId && p.fatherEmail?.trim()) {
    const lent = p.fatherEmail.trim().toLowerCase()
    return allowed(lent) ? { email: lent, source: 'father' } : none
  }

  return none
}

// Exclusivity across the cohort is not applied at read time here: the answer could move between
// readings and a tie would have no owner to look up. The emission rule and check (4) decide it.
