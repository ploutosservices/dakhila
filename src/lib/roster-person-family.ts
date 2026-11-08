// A PERSON'S FAMILY, WRITTEN — spouse, child, address and the person's own fields. The caller parses the form and
// decides who may; these read and write.
import { and, eq, isNull } from 'drizzle-orm'
import { db } from './db'
import { persons, rosterFamilies } from '../tables'
import { nextLegacyFamilyId } from './roster-families'
import { birthId } from './registry-id'

export type PersonUpdate = Partial<typeof persons.$inferInsert>

/** The live person's address, role and family within the tenant; null when there is none. */
export async function personRoleAndFamily(tenantId: string, personId: string) {
  const [person] = await db
    .select({ email: persons.email, role: persons.role, familyId: persons.familyId })
    .from(persons)
    .where(and(eq(persons.id, personId), eq(persons.tenantId, tenantId), isNull(persons.deletedAt)))
    .limit(1)
  return person ?? null
}

/** The role and family of the live person whose address is exactly `email` (callers lower-case it). */
export async function callerRoleAndFamily(tenantId: string, email: string) {
  const [caller] = await db
    .select({ role: persons.role, familyId: persons.familyId })
    .from(persons)
    .where(and(eq(persons.tenantId, tenantId), eq(persons.email, email), isNull(persons.deletedAt)))
    .limit(1)
  return caller ?? null
}

/** A new family holding the person as mother or father (by role), with the person linked to it. */
export async function createFamilyFor(tenantId: string, personId: string, role: string | null): Promise<string> {
  const legacyFamilyId = await nextLegacyFamilyId(tenantId)
  const [fam] = await db.transaction(async tx => tx.insert(rosterFamilies).values({
    id: await birthId(tx, 'family', tenantId),
    tenantId,
    legacyFamilyId,
    motherId: role === 'mother' ? personId : null,
    fatherId: role === 'father' ? personId : null,
  }).returning({ id: rosterFamilies.id }))

  await db.update(persons).set({ familyId: fam.id }).where(eq(persons.id, personId))
  return fam.id
}

/** The person's family, created (holding them by role) when they have none. */
export async function ensureFamily(tenantId: string, personId: string, role: string | null): Promise<string> {
  const [p] = await db.select({ familyId: persons.familyId }).from(persons).where(eq(persons.id, personId)).limit(1)
  if (p?.familyId) return p.familyId
  return createFamilyFor(tenantId, personId, role)
}

/** The person's id and role within the tenant (deleted rows included). */
export async function personIdAndRole(tenantId: string, personId: string) {
  const [person] = await db
    .select({ id: persons.id, role: persons.role })
    .from(persons)
    .where(and(eq(persons.id, personId), eq(persons.tenantId, tenantId)))
    .limit(1)
  return person ?? null
}

/** A new person in the family — a registry id first, then the row — answering the new id. */
export async function addFamilyPerson(tenantId: string, familyId: string, fields: Omit<typeof persons.$inferInsert, 'id' | 'tenantId' | 'familyId'>): Promise<string> {
  const id = await birthId(db, 'person', tenantId)
  await db.insert(persons).values({ id, tenantId, familyId, ...fields })
  return id
}

/** Seat a person as the family's mother or father. */
export async function setFamilyParent(familyId: string, role: 'mother' | 'father', personId: string): Promise<void> {
  if (role === 'mother') {
    await db.update(rosterFamilies).set({ motherId: personId }).where(eq(rosterFamilies.id, familyId))
  } else {
    await db.update(rosterFamilies).set({ fatherId: personId }).where(eq(rosterFamilies.id, familyId))
  }
}

/** Replace the family's postal address. */
export async function setFamilyAddress(familyId: string, addr: { addr1: string | null; addr2: string | null; city: string | null; state: string | null; zip: string | null }): Promise<void> {
  await db.update(rosterFamilies).set(addr).where(eq(rosterFamilies.id, familyId))
}

/** The birth date on the person's row. */
export async function personBirthDate(personId: string): Promise<string | null> {
  const [existing] = await db.select({ birthDate: persons.birthDate }).from(persons).where(eq(persons.id, personId)).limit(1)
  return existing?.birthDate ?? null
}

/** Write the given fields onto the tenant's person. */
export async function updatePersonFields(tenantId: string, personId: string, updates: PersonUpdate): Promise<void> {
  await db.update(persons).set(updates).where(and(eq(persons.id, personId), eq(persons.tenantId, tenantId)))
}
