// THE FAMILY ACTS, run by the roster API: each takes the tenant and the form's fields as the door read them, and
// answers its own words on a refusal. Who may is the API's (its route table); the session is the host's.
import { normalizeEmail } from './email-recipients'
import { isDuplicateEmailError, isDuplicatePhoneError, DUPLICATE_PHONE_MESSAGE } from './db-errors'
import {
  createPerson, findEmailOwner, updatePerson, softDeletePersons, getActiveStudents,
  createFamily as createFamilyRow, hardDeleteFamily, FamilyStillReferenced, getFamily,
  updateFamily as updateFamilyRow, setFamilyParents, getPersonByEmail,
} from './roster-families'

import { fieldOf, childMissingFirstGradeYear, type FormFields } from './form-fields'
export { fieldOf, formFields, childMissingFirstGradeYear, type FormFields } from './form-fields'

function str(f: FormFields, key: string): string | null {
  return (fieldOf(f, key) ?? '').trim() || null
}

// Every address that leaves this form goes through one normaliser, so no form writes a
// second casing of an address that already exists.
function emailField(f: FormFields, key: string): string | null {
  return normalizeEmail(fieldOf(f, key) as string)
}

function int(f: FormFields, key: string): number | null {
  const v = (fieldOf(f, key) ?? '').trim()
  const n = parseInt(v, 10)
  return isNaN(n) ? null : n
}

/** Whether the person at this address is a parent (mother or father) of the family: own-family scope, not a role. */
export async function isParentOf(tenantId: string, email: string, familyId: string): Promise<boolean> {
  const caller = await getPersonByEmail(tenantId, email.toLowerCase())
  return (caller?.role === 'mother' || caller?.role === 'father') && caller.familyId === familyId
}

/** Who already holds an address the family form would save, in the words the field and the save both show: inside
 *  the family, the person's name; outside it, only that someone does. */
export async function emailCheck(tenantId: string, familyId: string, email: string, personId: string | null, label: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const owner = await findEmailOwner(tenantId, email, personId)
  if (!owner) return { ok: true }
  const who = `${owner.firstName} ${owner.lastName ?? ''}`.trim()
  return {
    ok: false,
    message: owner.familyId === familyId
      ? `${email} is already on ${who} in this family, and one address can belong to only one person. Clear it from ${who} first, or give ${label} a different address.`
      : `${email} already belongs to someone else in the roster, so it cannot also be ${label}'s. If it is yours, sign in with it; otherwise use a different address.`,
  }
}

const DUPLICATE_EMAIL = "That email is already registered in the system. If it's yours, log in with it instead of adding it here; otherwise use a different email."

/** Remove a family and every person in it; the database decides whether anything still holds it. */
export async function deleteFamilyAct(tenantId: string, familyId: string): Promise<{ error: string } | { persons: number }> {
  const family = await getFamily(tenantId, familyId)
  if (!family) return { error: 'Family not found.' }
  // A real delete, and the database decides. A family with an
  // enrolment or any other history is refused and told what holds it.
  try {
    return await hardDeleteFamily(tenantId, familyId)
  } catch (e) {
    if (e instanceof FamilyStillReferenced) return { error: `Cannot delete: ${(e as FamilyStillReferenced).by} still refers to this family or its people.` }
    throw e
  }
}

/** A new family from the new-family form: its parents, the family row and its children, linked. */
export async function createFamilyAct(tenantId: string, f: FormFields): Promise<{ error: string } | { familyId: string }> {
  const motherFirst = str(f, 'motherFirstName')
  const fatherFirst = str(f, 'fatherFirstName')
  if (!motherFirst && !fatherFirst) return { error: 'At least one parent is required.' }
  const noYear = childMissingFirstGradeYear(f)
  if (noYear) return { error: `Please enter ${noYear}'s 1st grade year — the year they start (or started) first grade.` }

  const motherPhone = str(f, 'motherPhone')
  const motherEmail = emailField(f, 'motherEmail')
  const fatherPhone = str(f, 'fatherPhone')
  const fatherEmail = emailField(f, 'fatherEmail')

  if (!motherPhone && !fatherPhone) return { error: 'At least one parent phone number is required.' }
  if (!motherEmail && !fatherEmail) return { error: 'At least one parent email is required.' }

  const studentCount = int(f, 'studentCount') ?? 0
  for (let i = 0; i < studentCount; i++) {
    const firstName = str(f, `student_${i}_firstName`)
    if (!firstName) continue
    if (!str(f, `student_${i}_birthDate`)) return { error: `Date of birth is required for ${firstName}` }
  }

  // The family is made first and every person is born into it: the store refuses a roster person without a
  // family, so a person made first would be refused. A refused person removes the
  // family and whoever was already in it.
  let motherId: string | null = null
  let fatherId: string | null = null
  const familyId = await createFamilyRow(tenantId, {
    addr1: str(f, 'addr1'), addr2: str(f, 'addr2'), city: str(f, 'city'), state: str(f, 'state'), zip: str(f, 'zip'),
  })
  try {
    if (motherFirst) {
      motherId = await createPerson(tenantId, {
        firstName: motherFirst, lastName: str(f, 'motherLastName'), role: 'mother', gender: 'female', phone: motherPhone, email: motherEmail, familyId,
      })
    }
    if (fatherFirst) {
      fatherId = await createPerson(tenantId, {
        firstName: fatherFirst, lastName: str(f, 'fatherLastName'), role: 'father', gender: 'male', phone: fatherPhone, email: fatherEmail, familyId,
      })
    }
    await setFamilyParents(tenantId, familyId, motherId, fatherId)
    const count = int(f, 'studentCount') ?? 0
    for (let i = 0; i < count; i++) {
      const firstName = str(f, `student_${i}_firstName`)
      if (!firstName) continue
      const gender = str(f, `student_${i}_gender`) === 'girl' ? 'girl' : 'boy'
      await createPerson(tenantId, {
        firstName,
        lastName: str(f, `student_${i}_lastName`),
        role: gender,
        gender,
        birthDate: str(f, `student_${i}_birthDate`),
        firstGradeYear: int(f, `student_${i}_firstGradeYear`),
        preferredLanguage: str(f, `student_${i}_language`),
        email: emailField(f, `student_${i}_email`),
        guardian: int(f, `student_${i}_guardian`) ?? 0,
        familyId,
      })
    }
  } catch (err) {
    await hardDeleteFamily(tenantId, familyId)
    if (isDuplicateEmailError(err)) return { error: DUPLICATE_EMAIL }
    if (isDuplicatePhoneError(err)) return { error: DUPLICATE_PHONE_MESSAGE }
    throw err
  }
  return { familyId }
}

/** The family edit form saved: its parents, address and children; a child left off the form is removed. `editorId`
 *  is who edited, carried to every write so the history names them. */
export async function updateFamilyAct(tenantId: string, familyId: string, editorId: string | null, f: FormFields): Promise<{ error: string } | { familyId: string }> {
  const family = await getFamily(tenantId, familyId)
  if (!family) return { error: 'Family not found.' }

  const motherFirst = str(f, 'motherFirstName')
  const fatherFirst = str(f, 'fatherFirstName')
  if (!motherFirst && !fatherFirst) return { error: 'At least one parent is required.' }

  const motherPhone = str(f, 'motherPhone')
  const motherEmail = emailField(f, 'motherEmail')
  const fatherPhone = str(f, 'fatherPhone')
  const fatherEmail = emailField(f, 'fatherEmail')

  if (!motherPhone && !fatherPhone) return { error: 'At least one parent phone number is required.' }
  if (!motherEmail && !fatherEmail) return { error: 'At least one parent email is required.' }

  const studentCount = int(f, 'studentCount') ?? 0
  for (let i = 0; i < studentCount; i++) {
    const firstName = str(f, `student_${i}_firstName`)
    if (!firstName) continue
    if (!str(f, `student_${i}_birthDate`)) return { error: `Date of birth is required for ${firstName}` }
  }

  // ONE ADDRESS PER PERSON, CHECKED BEFORE ANYTHING IS WRITTEN — and the refusal says
  // WHERE the address already is, so a parent can tell when it is on another record of the very family being edited.
  //
  // It runs BEFORE the writes for a second reason: these updates are not in a
  // transaction, so a 23505 raised half way through leaves the parents saved and the
  // students not. Catching it here means the whole form is refused or none of it is.
  const submitted: { email: string; personId: string | null; label: string }[] = []
  if (motherFirst && motherEmail) submitted.push({ email: motherEmail, personId: family.motherId, label: 'the mother' })
  if (fatherFirst && fatherEmail) submitted.push({ email: fatherEmail, personId: family.fatherId, label: 'the father' })
  for (let i = 0; i < studentCount; i++) {
    const email = emailField(f, `student_${i}_email`)
    const first = str(f, `student_${i}_firstName`)
    if (email && first) submitted.push({ email, personId: str(f, `student_${i}_id`) || null, label: first })
  }
  for (const { email, personId, label } of submitted) {
    const check = await emailCheck(tenantId, familyId, email, personId, label)
    if (!check.ok) return { error: check.message }
  }

  let motherId: string | null = family.motherId
  let fatherId: string | null = family.fatherId
  const submittedIds: string[] = []
  try {
    if (motherFirst) {
      if (motherId) {
        await updatePerson(tenantId, motherId, { firstName: motherFirst, lastName: str(f, 'motherLastName'), phone: motherPhone, email: motherEmail }, editorId)
      } else {
        motherId = await createPerson(tenantId, {
          firstName: motherFirst, lastName: str(f, 'motherLastName'), role: 'mother', gender: 'female', phone: motherPhone, email: motherEmail, familyId,
        })
      }
    }
    if (fatherFirst) {
      if (fatherId) {
        await updatePerson(tenantId, fatherId, { firstName: fatherFirst, lastName: str(f, 'fatherLastName'), phone: fatherPhone, email: fatherEmail }, editorId)
      } else {
        fatherId = await createPerson(tenantId, {
          firstName: fatherFirst, lastName: str(f, 'fatherLastName'), role: 'father', gender: 'male', phone: fatherPhone, email: fatherEmail, familyId,
        })
      }
    }
    await updateFamilyRow(tenantId, familyId, {
      motherId, fatherId,
      addr1: str(f, 'addr1'), addr2: str(f, 'addr2'), city: str(f, 'city'), state: str(f, 'state'), zip: str(f, 'zip'),
    }, editorId)

    const count = int(f, 'studentCount') ?? 0
    for (let i = 0; i < count; i++) {
      const firstName = str(f, `student_${i}_firstName`)
      const existingId = str(f, `student_${i}_id`)
      if (existingId) {
        submittedIds.push(existingId)
        const gender = str(f, `student_${i}_gender`) === 'girl' ? 'girl' : 'boy'
        await updatePerson(tenantId, existingId, {
          firstName: firstName || '',
          lastName: str(f, `student_${i}_lastName`),
          role: gender,
          gender,
          birthDate: str(f, `student_${i}_birthDate`),
          firstGradeYear: int(f, `student_${i}_firstGradeYear`),
          preferredLanguage: str(f, `student_${i}_language`),
          email: emailField(f, `student_${i}_email`),
          guardian: int(f, `student_${i}_guardian`) ?? 0,
        })
      } else if (firstName) {
        const gender = str(f, `student_${i}_gender`) === 'girl' ? 'girl' : 'boy'
        const id = await createPerson(tenantId, {
          firstName,
          lastName: str(f, `student_${i}_lastName`),
          role: gender,
          gender,
          birthDate: str(f, `student_${i}_birthDate`),
          firstGradeYear: int(f, `student_${i}_firstGradeYear`),
          preferredLanguage: str(f, `student_${i}_language`),
          email: emailField(f, `student_${i}_email`),
          guardian: int(f, `student_${i}_guardian`) ?? 0,
          familyId,
        })
        submittedIds.push(id)
      }
    }
  } catch (err) {
    if (isDuplicateEmailError(err)) return { error: DUPLICATE_EMAIL }
    if (isDuplicatePhoneError(err)) return { error: DUPLICATE_PHONE_MESSAGE }
    throw err
  }

  const existing = await getActiveStudents(tenantId, familyId)
  const removedIds = existing.map(s => s.id).filter(id => !submittedIds.includes(id))
  await softDeletePersons(tenantId, removedIds)
  return { familyId }
}
