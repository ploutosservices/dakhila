// THE STUDENTS LIST'S READ.
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import { db } from './db'
import { persons, rosterFamilies } from '../tables'

/**
 * The tenant's live students (boys and girls) with their family's legacy id, by last then first name — every one
 * for `'all'`, or one family's (`{ familyId }`; a null familyId lists the students with no family).
 */
export function studentsForList(tenantId: string, scope: 'all' | { familyId: string | null }) {
  const base = and(eq(persons.tenantId, tenantId), inArray(persons.role, ['boy', 'girl']), isNull(persons.deletedAt))
  const whereClause = scope === 'all'
    ? base
    : and(base, scope.familyId ? eq(persons.familyId, scope.familyId) : isNull(persons.familyId))
  return db
    .select({
      id: persons.id,
      firstName: persons.firstName,
      lastName: persons.lastName,
      birthDate: persons.birthDate,
      firstGradeYear: persons.firstGradeYear,
      preferredLanguage: persons.preferredLanguage,
      familyId: persons.familyId,
      legacyFamilyId: rosterFamilies.legacyFamilyId,
    })
    .from(persons)
    .leftJoin(rosterFamilies, eq(rosterFamilies.id, persons.familyId))
    .where(whereClause)
    .orderBy(asc(persons.lastName), asc(persons.firstName))
}
