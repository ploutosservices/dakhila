// A PERSON'S FAMILY AND FIRST NAME — persons reads alone (family-classes-load.ts re-exports them), so a caller that
// needs only these reaches none of the classroom table's roster reads.
import { db } from './db'
import { persons } from '../tables'
import { eq } from 'drizzle-orm'

/** The family a person belongs to, or null. */
export async function familyIdOf(personId: string): Promise<string | null> {
  const [p] = await db.select({ familyId: persons.familyId }).from(persons).where(eq(persons.id, personId)).limit(1)
  return p?.familyId ?? null
}

/** A person's first name, for the greeting and subject of a joining email. */
export async function firstNameOf(personId: string): Promise<string> {
  const [p] = await db.select({ firstName: persons.firstName }).from(persons).where(eq(persons.id, personId)).limit(1)
  if (!p) throw new Error('person not found')
  return p.firstName
}
