// WHICH ADDRESS DID THIS PERSON ARRIVE WITH — their own, or the one the school gave them?
//
// A person has a primary address and a classroom address. If a person arrives and the address
// does not match, the answer is: no such account. The classroom address is matched too; when it
// matches, the answer says the person is known and must sign in with their primary address.
//
// THE DESIGN CALL: a classroom address is RECOGNISED and REFUSED, never admitted. It
// is a Google account the school issues to work around a Google policy — it is not a person's
// identity, and letting both addresses in would give one human two ways through the door, each
// resolving to a different set of rows. So this returns `classroom` and the caller says so.
//
// THE INVARIANT: one address, one answer. One store holds a classroom address —
// persons.classroom_email, a teacher's school account, with a unique index on the lowered
// address. A student has no school-issued address: the classroom uses the student's own
// persons.email or a parent's, so a student's classroom address IS a primary address and is
// answered as one. Where the invariant is NOT true is that direction: a student may carry a
// parent's primary address, so that address names two people. That is why primary is asked FIRST and wins — the adult owns
// their own address.

import { db } from './db'
import { persons } from '../tables'
import { and, eq, isNull, sql } from 'drizzle-orm'

export type AddressIdentity =
  /** The address is a person's own. This is the only kind that may sign in. */
  | { kind: 'primary'; personId: string; name: string }
  /** The school's address for this person. Recognised, refused, and told why. */
  | { kind: 'classroom'; personId: string; name: string }
  /** Nobody here. */
  | { kind: 'unknown' }

/** What a caller is told when they arrive with a classroom address. Never prints the primary
 *  address: the door says WHICH address to use, not what it is. */
export const CLASSROOM_ADDRESS_MESSAGE =
  'We know you, but this is your classroom address. Please sign in here with your primary email address.'

const clean = (email: string) => email.trim().toLowerCase()
const nameOf = (p: { firstName: string; lastName: string | null }) =>
  [p.firstName, p.lastName].filter(Boolean).join(' ')

export async function resolveAddressIdentity(tenantId: string, email: string): Promise<AddressIdentity> {
  const addr = clean(email)
  if (!addr) return { kind: 'unknown' }

  // PRIMARY FIRST, always — see the note above about children on a parent's address.
  const [own] = await db
    .select({ id: persons.id, firstName: persons.firstName, lastName: persons.lastName })
    .from(persons)
    .where(and(
      eq(persons.tenantId, tenantId),
      sql`btrim(lower(${persons.email})) = ${addr}`,
      isNull(persons.deletedAt),
    ))
    .limit(1)
  if (own) return { kind: 'primary', personId: own.id, name: nameOf(own) }

  const [teacher] = await db
    .select({ id: persons.id, firstName: persons.firstName, lastName: persons.lastName })
    .from(persons)
    .where(and(
      eq(persons.tenantId, tenantId),
      sql`btrim(lower(${persons.classroomEmail})) = ${addr}`,
      isNull(persons.deletedAt),
    ))
    .limit(1)
  if (teacher) return { kind: 'classroom', personId: teacher.id, name: nameOf(teacher) }

  return { kind: 'unknown' }
}
