import { db } from './db'
import { persons, personRelationships } from '../tables'
import { birthId } from './registry-id'
import { eq, and, isNull, or, sql } from 'drizzle-orm'

export type { Person, RelatedPerson } from './genealogy-types'
export { displayName, siblingOrder } from './genealogy-types'
import type { Person, RelatedPerson } from './genealogy-types'

export async function getPersonByEmail(tenantId: string, email: string): Promise<Person | null> {
  const rows = await db
    .select()
    .from(persons)
    .where(and(eq(persons.tenantId, tenantId), sql`lower(${persons.email}) = lower(${email})`, isNull(persons.deletedAt)))
    .limit(1)
  return rows[0] ?? null
}

export async function getPersonsByTenant(tenantId: string): Promise<Person[]> {
  return db
    .select()
    .from(persons)
    .where(and(eq(persons.tenantId, tenantId), isNull(persons.deletedAt)))
    .orderBy(persons.firstName, persons.lastName)
}

export async function getPersonById(id: string): Promise<Person | null> {
  const rows = await db
    .select()
    .from(persons)
    .where(and(eq(persons.id, id), isNull(persons.deletedAt)))
    .limit(1)
  return rows[0] ?? null
}

export type { Relationship } from './genealogy-types'
export { hasActiveSpouse } from './genealogy-types'
import type { Relationship } from './genealogy-types'

export async function getAllRelationshipsByTenant(tenantId: string): Promise<Relationship[]> {
  return db
    .select({
      id: personRelationships.id,
      personAId: personRelationships.personAId,
      personBId: personRelationships.personBId,
      type: personRelationships.type,
      status: personRelationships.status,
      endYear: personRelationships.endYear,
    })
    .from(personRelationships)
    .where(eq(personRelationships.tenantId, tenantId))
}

// Returns the set of person IDs that constitute the direct family of a given person:
// themselves, their spouses, and all descendants (children, grandchildren, …).
// Uses a single relationship fetch + in-memory BFS — safe for trees of a few hundred persons.
export async function getDirectFamily(tenantId: string, personId: string): Promise<Set<string>> {
  const allRels = await getAllRelationshipsByTenant(tenantId)
  const family = new Set<string>([personId])

  for (const rel of allRels) {
    if (rel.type === 'spouse') {
      if (rel.personAId === personId) family.add(rel.personBId)
      if (rel.personBId === personId) family.add(rel.personAId)
    }
  }

  const queue = [personId]
  const visited = new Set<string>()
  while (queue.length > 0) {
    const parentId = queue.shift()!
    if (visited.has(parentId)) continue
    visited.add(parentId)
    for (const rel of allRels) {
      if (rel.type === 'parent-child' && rel.personAId === parentId && !family.has(rel.personBId)) {
        family.add(rel.personBId)
        queue.push(rel.personBId)
      }
    }
  }

  return family
}

export async function getRelationshipsByPerson(personId: string): Promise<RelatedPerson[]> {
  // Get all relationships where this person is either A or B
  const asA = await db
    .select({
      relationshipId: personRelationships.id,
      personId: persons.id,
      firstName: persons.firstName,
      lastName: persons.lastName,
      middleName: persons.middleName,
      gender: persons.gender,
      birthYear: persons.birthYear,
      deathYear: persons.deathYear,
      type: personRelationships.type,
      status: personRelationships.status,
      endYear: personRelationships.endYear,
    })
    .from(personRelationships)
    .innerJoin(persons, eq(personRelationships.personBId, persons.id))
    .where(
      and(
        eq(personRelationships.personAId, personId),
        isNull(persons.deletedAt),
      )
    )

  const asB = await db
    .select({
      relationshipId: personRelationships.id,
      personId: persons.id,
      firstName: persons.firstName,
      lastName: persons.lastName,
      middleName: persons.middleName,
      gender: persons.gender,
      birthYear: persons.birthYear,
      deathYear: persons.deathYear,
      type: personRelationships.type,
      status: personRelationships.status,
      endYear: personRelationships.endYear,
    })
    .from(personRelationships)
    .innerJoin(persons, eq(personRelationships.personAId, persons.id))
    .where(
      and(
        eq(personRelationships.personBId, personId),
        isNull(persons.deletedAt),
      )
    )

  // For parent-child, resolve the label from the focal person's perspective.
  // personA = parent, personB = child: if focal is A, related is child; if focal is B, related is parent.
  const label = (type: string, side: 'A' | 'B') =>
    type === 'parent-child' ? (side === 'A' ? 'child' : 'parent') : type

  return [
    ...asA.map(r => ({ ...r, type: label(r.type, 'A') })),
    ...asB.map(r => ({ ...r, type: label(r.type, 'B') })),
  ]
}

// ── The genealogy actions' writes ─────────────────────────────────────────────

export type GenealogyPersonFields = Omit<typeof persons.$inferInsert, 'id' | 'tenantId'>

/** A new person with its record id, answering the id. */
export async function createGenealogyPerson(tenantId: string, fields: GenealogyPersonFields): Promise<string> {
  const id = await birthId(db, 'person', tenantId)
  await db.insert(persons).values({ id, tenantId, ...fields })
  return id
}

/** An active relationship from A to B ('parent-child' or 'spouse'). */
export async function addRelationship(tenantId: string, personAId: string, personBId: string, type: 'parent-child' | 'spouse'): Promise<void> {
  await db.insert(personRelationships).values({ tenantId, personAId, personBId, type, status: 'active' })
}

/** Whether the person married into the family: the B side of a spouse relationship and in no parent-child one. */
export async function isMarriedIn(tenantId: string, personId: string): Promise<boolean> {
  const parentRels = await db
    .select({ type: personRelationships.type, personBId: personRelationships.personBId })
    .from(personRelationships)
    .where(and(
      eq(personRelationships.tenantId, tenantId),
      or(
        and(eq(personRelationships.personBId, personId), eq(personRelationships.type, 'spouse')),
        and(eq(personRelationships.type, 'parent-child'),
          or(eq(personRelationships.personAId, personId), eq(personRelationships.personBId, personId)))
      )
    ))
  return parentRels.some(r => r.type === 'spouse' && r.personBId === personId)
    && !parentRels.some(r => r.type === 'parent-child')
}

/** A relationship's two people; null when there is none by that id. */
export async function relationshipPeople(relationshipId: string) {
  const [rel] = await db.select({ personAId: personRelationships.personAId, personBId: personRelationships.personBId })
    .from(personRelationships).where(eq(personRelationships.id, relationshipId)).limit(1)
  return rel ?? null
}

/** End a relationship with a status and year. */
export async function endRelationshipRow(relationshipId: string, status: string, endYear: number | null): Promise<void> {
  await db.update(personRelationships).set({ status, endYear }).where(eq(personRelationships.id, relationshipId))
}

/** A person's address as held now; null when there is no such person. */
export async function personEmail(personId: string): Promise<string | null> {
  const [current] = await db.select({ email: persons.email }).from(persons).where(eq(persons.id, personId)).limit(1)
  return current?.email ?? null
}

/** Write the given fields onto a person. */
export async function updateGenealogyPerson(personId: string, fields: GenealogyPersonFields): Promise<void> {
  await db.update(persons).set(fields).where(eq(persons.id, personId))
}

/** Delete a relationship. */
export async function deleteRelationship(relationshipId: string): Promise<void> {
  await db.delete(personRelationships).where(eq(personRelationships.id, relationshipId))
}
