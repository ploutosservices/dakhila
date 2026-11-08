// A PERSON'S FAMILY ACTS, run by the roster API. Who may is asked inside each act — after the person is found, and for
// the address after a missing family is made — so each takes the questions as functions the API answers: `mayEdit(familyId)` (roster.write, or a
// parent of that family) and `mayRead(familyId)` (family.get's own: roster.read, or the caller's own family).
import { normalizeEmail } from './email-recipients'
import { fieldOf, type FormFields } from './roster-family-acts'
import {
  personRoleAndFamily, callerRoleAndFamily, createFamilyFor, ensureFamily, personIdAndRole, addFamilyPerson,
  setFamilyParent, setFamilyAddress, personBirthDate, updatePersonFields, type PersonUpdate,
} from './roster-person-family'
import { getFamily } from './roster-families'
import { courseRules } from './rules-context'

export type FamilyActionResult = { ok?: boolean; error?: string; personId?: string }
export type Questions = { mayEdit: (familyId: string | null) => Promise<boolean>; mayRead: (familyId: string) => Promise<boolean> }

/** Whether the person at this address is a parent of the family — own-family scope, not a role. */
export async function isParentByRole(tenantId: string, email: string | null, targetFamilyId: string | null): Promise<boolean> {
  if (!email || !targetFamilyId) return false
  const caller = await callerRoleAndFamily(tenantId, email.toLowerCase())
  return (caller?.role === 'mother' || caller?.role === 'father') && caller.familyId === targetFamilyId
}

const trimmed = (f: FormFields, k: string) => fieldOf(f, k)?.trim()

/** The year of a birth date: a date has no zone, so its year is read off the day itself, never through a clock. */
const yearOfDay = (d: string | Date) => typeof d === 'string' ? Number(d.slice(0, 4)) : d.getUTCFullYear()

export async function addSpouseAct(tenantId: string, q: Questions, f: FormFields): Promise<FamilyActionResult> {
  const personId = fieldOf(f, 'personId') as string
  const person = await personRoleAndFamily(tenantId, personId)
  if (!person) return { error: 'Person not found' }
  if (!await q.mayEdit(person.familyId)) return { error: 'Forbidden' }

  const firstName = trimmed(f, 'firstName')
  if (!firstName) return { error: 'First name is required' }

  const spouseRole = person.role === 'mother' ? 'father' : 'mother'
  const familyId = await ensureFamily(tenantId, personId, person.role)
  const spouseId = await addFamilyPerson(tenantId, familyId, {
    firstName,
    lastName:  trimmed(f, 'lastName') || null,
    email:     normalizeEmail(fieldOf(f, 'email') as string),
    phone:     trimmed(f, 'phone') || null,
    role:      spouseRole,
  })
  await setFamilyParent(familyId, spouseRole, spouseId)
  return { ok: true, personId: spouseId }
}

export async function updateFamilyAddressAct(tenantId: string, q: Questions, f: FormFields): Promise<FamilyActionResult> {
  const personId = fieldOf(f, 'personId')
  let familyId = fieldOf(f, 'familyId')

  // No family yet — create one and link this person
  if (!familyId && personId) {
    const person = await personIdAndRole(tenantId, personId)
    if (!person) return { error: 'Person not found' }
    familyId = await createFamilyFor(tenantId, person.id, person.role)
  }
  if (!familyId) return { error: 'Family not found' }

  // family.get's question and answer: 403 is "Forbidden", none is "Family not found".
  if (!await q.mayRead(familyId)) return { error: 'Forbidden' }
  if (!await getFamily(tenantId, familyId)) return { error: 'Family not found' }

  if (!await q.mayEdit(familyId)) return { error: 'Forbidden' }

  await setFamilyAddress(familyId, {
    addr1: trimmed(f, 'addr1') || null,
    addr2: trimmed(f, 'addr2') || null,
    city:  trimmed(f, 'city')  || null,
    state: trimmed(f, 'state') || null,
    zip:   trimmed(f, 'zip')   || null,
  })
  return { ok: true }
}

export async function updatePersonAct(tenantId: string, q: Questions, f: FormFields): Promise<FamilyActionResult> {
  const personId = fieldOf(f, 'personId') as string
  const person = await personRoleAndFamily(tenantId, personId)
  if (!person) return { error: 'Person not found' }
  if (!await q.mayEdit(person.familyId)) return { error: 'Forbidden' }

  const firstName = trimmed(f, 'firstName')
  if (!firstName) return { error: 'First name is required' }

  const updates: PersonUpdate = {
    firstName,
    lastName:          trimmed(f, 'lastName') || null,
    phone:             trimmed(f, 'phone') || null,
    email:             normalizeEmail(fieldOf(f, 'email') as string),
    preferredLanguage: fieldOf(f, 'preferredLanguage') || null,
    birthDate:         fieldOf(f, 'birthDate') || null,
  }

  const rawFirstGradeYear = fieldOf(f, 'firstGradeYear')
  if (rawFirstGradeYear?.trim()) {
    const n = parseInt(rawFirstGradeYear, 10)
    if (!isNaN(n)) {
      // Re-fetch birthDate from DB since we only selected email/role/familyId
      const existingBirthDate = await personBirthDate(personId)
      const birthYear = updates.birthDate ? yearOfDay(updates.birthDate) : existingBirthDate ? yearOfDay(existingBirthDate) : null
      const earliest = birthYear ? birthYear + (await courseRules(tenantId)).earliestFirstGradeAge : null
      if (earliest && n < earliest) return { error: `First grade year must be at least ${earliest}` }
      updates.firstGradeYear = n
    }
  }

  await updatePersonFields(tenantId, personId, updates)
  return { ok: true }
}

export async function addChildAct(tenantId: string, q: Questions, f: FormFields): Promise<FamilyActionResult> {
  const personId = fieldOf(f, 'personId') as string
  const person = await personRoleAndFamily(tenantId, personId)
  if (!person) return { error: 'Person not found' }
  if (!await q.mayEdit(person.familyId)) return { error: 'Forbidden' }

  const firstName = trimmed(f, 'firstName')
  const firstGradeYear = parseInt(fieldOf(f, 'firstGradeYear') as string, 10)
  if (!firstName) return { error: 'First name is required' }
  if (isNaN(firstGradeYear)) return { error: 'First grade year is required' }
  const birthDateVal = fieldOf(f, 'birthDate') || null
  if (!birthDateVal) return { error: 'Date of birth is required' }
  const earliest = yearOfDay(birthDateVal as string) + (await courseRules(tenantId)).earliestFirstGradeAge
  if (firstGradeYear < earliest) return { error: `First grade year must be at least ${earliest}` }

  const familyId = await ensureFamily(tenantId, personId, person.role)

  const gender = fieldOf(f, 'gender') || null
  const childRole = gender === 'girl' ? 'girl' : 'boy'

  const childId = await addFamilyPerson(tenantId, familyId, {
    firstName,
    lastName:          trimmed(f, 'lastName') || null,
    gender:            childRole,
    firstGradeYear,
    birthDate:         fieldOf(f, 'birthDate') || null,
    guardian:          parseInt(fieldOf(f, 'guardian') as string, 10) || 0,
    preferredLanguage: fieldOf(f, 'preferredLanguage') || null,
    role:              childRole,
  })
  return { ok: true, personId: childId }
}
