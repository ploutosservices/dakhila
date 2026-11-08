// A PARENT'S SELF-REGISTRATION. The caller verifies who is registering and reads their request; this takes the verified
// address and answers the status and body.
import { db } from './db'
import { persons, rosterFamilies } from '../tables'
import { eq, and, isNull, or, sql } from 'drizzle-orm'
import { isTeacherDomainAddress } from './teacher-classroom-address'
import { isDuplicatePhoneError, DUPLICATE_PHONE_MESSAGE } from './db-errors'
import { nextLegacyFamilyId } from './roster-families'
import { birthId } from './registry-id'
import { workspaceDomain } from './role-mailbox'
import { optIn } from './sms-consent-writes'
import { e164 } from './phone-e164'
import { phoneRules } from './rules-context'
import { schoolWord } from './school-words'

export type IntakePerson = { firstName: string; lastName: string | null; phone: string; role: 'mother' | 'father'; smsConsent: boolean }
type Tenant = { id: string; longName: string }

export type IntakeAnswer =
  | { status: 201; body: { created: true; personId: string; familyId: string } }
  | { status: 200; body: { created: false; alreadyRegistered: true } }
  | { status: 400; body: { error: string } }

export async function registerIntakePerson(tenant: Tenant, request: IntakePerson, email: string): Promise<IntakeAnswer> {
  // A SCHOOL-ISSUED ADDRESS NEVER REGISTERS A FAMILY. It is a teacher's classroom account, not a family member's
  // personal address. A teacher registering while signed in with it would find no personal email below, and this
  // door would create a second family and a second person holding the classroom address — and the map would lose the
  // teacher's class row. Refused before anything is written.
  const domain = await workspaceDomain(tenant.id)
  if (isTeacherDomainAddress(email, domain)) {
    return { status: 400, body: { error: `Please sign in with your personal ${await schoolWord(tenant.id, 'sign-in-account')} to register. A ${domain} account cannot register a family.` } }
  }

  // An address already in the roster is a fact to state, not an error: the person
  // signed in and IS who the row says. The caller reads this shape and lands them on
  // their family's record.
  const [existing] = await db
    .select({ id: persons.id })
    .from(persons)
    // The address is already someone's if it is their personal email OR their classroom address — one address is
    // one person, whichever field holds it.
    .where(and(
      eq(persons.tenantId, tenant.id), isNull(persons.deletedAt),
      or(sql`lower(trim(${persons.email})) = ${email.trim().toLowerCase()}`, sql`lower(trim(${persons.classroomEmail})) = ${email.trim().toLowerCase()}`),
    ))
    .limit(1)
  if (existing) return { status: 200, body: { created: false, alreadyRegistered: true } }

  // Family first, person born INTO it, parent pointer last. The order is load-
  // bearing twice over: the store refuses a live roster person with no
  // family, and roster_families.mother/father_id
  // reference persons.id — so the family starts parentless and gains its
  // parent after the person exists. One transaction: a failure leaves nothing,
  // not even the record id.
  const legacyFamilyId = await nextLegacyFamilyId(tenant.id)
  // One phone number, one person. A number another family already holds refuses the registration in words —
  // the transaction writes nothing — rather than a 500 from the index.
  try {
    const created = await db.transaction(async (tx) => {
      const person = { id: await birthId(tx, 'person', tenant.id) }
      const [family] = await tx.insert(rosterFamilies).values({
        id: await birthId(tx, 'family', tenant.id),
        tenantId: tenant.id,
        legacyFamilyId,
        motherId: null,
        fatherId: null,
      }).returning({ id: rosterFamilies.id })
      await tx.insert(persons).values({
        id: person.id,
        tenantId: tenant.id,
        firstName: request.firstName,
        lastName: request.lastName,
        email,
        phone: request.phone,
        role: request.role,
        familyId: family.id,
      })
      await tx.update(rosterFamilies)
        .set(request.role === 'mother' ? { motherId: person.id } : { fatherId: person.id })
        .where(eq(rosterFamilies.id, family.id))
      // THE PARENT'S YES TO TEXTS, given with the registration — optional there, so a no registers
      // without one. Recorded for the number in E.164, as the person's own switch writes it, so every reader of
      // texting states reads it as theirs. A number too short to be one carries no consent: there is nothing to text.
      const textable = request.smsConsent ? e164(request.phone, await phoneRules(tenant.id)) : null
      if (textable) await optIn(tenant.id, person.id, textable, tenant.longName, tx)
      // BOTH ids come back, not just the person's: a door that creates two rows and names one of them makes
      // its caller go looking.
      return { personId: person.id, familyId: family.id }
    })
    return { status: 201, body: { created: true, ...created } }
  } catch (e) {
    if (isDuplicatePhoneError(e)) return { status: 400, body: { error: DUPLICATE_PHONE_MESSAGE } }
    throw e
  }
}

/** Whether a live person of the tenant holds this address (lower-cased and trimmed by the door). */
export async function intakeAddressExists(tenantId: string, email: string): Promise<boolean> {
  const [existing] = await db
    .select({ id: persons.id })
    .from(persons)
    .where(and(eq(persons.tenantId, tenantId), eq(persons.email, email), isNull(persons.deletedAt)))
    .limit(1)
  return !!existing
}
