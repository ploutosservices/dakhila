// THE PERSONS LIST'S READ: one page of the roster's people with the count of each role
// under the same search.
import { and, asc, eq, ilike, isNull, or, sql } from 'drizzle-orm'
import { db } from './db'
import { persons, rosterFamilies } from '../tables'

/**
 * One page of live persons, by last then first name, and the count per role under the search alone (the role filter
 * does not narrow the counts — they label the filter buttons). `'all'` is the whole roster; `{ familyId }` one
 * family's people (a null familyId, the people with no family). `q` matches first name, last name or address.
 */
export async function personsPage(
  tenantId: string,
  scope: 'all' | { familyId: string | null },
  opts: { q: string; role: string; limit: number; offset: number },
) {
  const baseClause = scope === 'all'
    ? and(eq(persons.tenantId, tenantId), isNull(persons.deletedAt))
    : and(
        eq(persons.tenantId, tenantId),
        isNull(persons.deletedAt),
        scope.familyId ? eq(persons.familyId, scope.familyId) : isNull(persons.familyId),
      )
  const trimmed = opts.q.trim()
  const searchClause = trimmed
    ? and(baseClause, or(
        ilike(persons.firstName, `%${trimmed}%`),
        ilike(persons.lastName, `%${trimmed}%`),
        ilike(persons.email, `%${trimmed}%`),
      ))
    : baseClause
  const fullClause = opts.role ? and(searchClause, eq(persons.role, opts.role)) : searchClause

  const roleCountRows = await db
    .select({ role: persons.role, n: sql<number>`count(*)::int` })
    .from(persons)
    .where(searchClause)
    .groupBy(persons.role)

  const rows = await db
    .select({
      id: persons.id,
      firstName: persons.firstName,
      lastName: persons.lastName,
      role: persons.role,
      email: persons.email,
      phone: persons.phone,
      preferredLanguage: persons.preferredLanguage,
      legacyId: persons.legacyId,
      familyId: persons.familyId,
      legacyFamilyId: rosterFamilies.legacyFamilyId,
    })
    .from(persons)
    .leftJoin(rosterFamilies, eq(rosterFamilies.id, persons.familyId))
    .where(fullClause)
    .orderBy(asc(persons.lastName), asc(persons.firstName))
    .limit(opts.limit)
    .offset(opts.offset)

  return { roleCountRows, rows }
}
