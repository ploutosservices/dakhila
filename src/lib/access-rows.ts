// THE RELATIONSHIPS THE ACCESS RULE READS, FROM THE ROSTER'S ROWS: teacher and family are worked out, never given —
// teaching a class of the school year; mother or father of a live person record — and a caller's own family is their
// live person's, matched by the address they signed in with.
import { eq, and, isNull, sql } from 'drizzle-orm'
import { persons, rosterTeachers, rosterAvailableClasses } from '../tables'
import type { Store } from '../store'
import type { RoleName } from '../access-rule'

/** Teacher and family, from rows: teaching a class of the school year; mother or father of a live person record. The
 *  year is asked for only when the caller teaches some class: a tenant teaching none (a genealogy tenant) holds no
 *  school rules, and its callers are not refused for that. */
export async function derivedFromRows(store: Store, tenantId: string, email: string, schoolYear: () => Promise<number>): Promise<RoleName[]> {
  const [taughtYears, familyRows] = await Promise.all([
    store.selectDistinct({ year: rosterAvailableClasses.year })
      .from(persons)
      .innerJoin(rosterTeachers, eq(rosterTeachers.personId, persons.id))
      .innerJoin(rosterAvailableClasses, eq(rosterAvailableClasses.id, rosterTeachers.classId))
      .where(and(
        eq(persons.tenantId, tenantId),
        sql`lower(${persons.email}) = lower(${email})`,
        isNull(persons.deletedAt),
      )),
    store.select({ role: persons.role })
      .from(persons)
      .where(and(
        eq(persons.tenantId, tenantId),
        sql`lower(${persons.email}) = lower(${email})`,
        isNull(persons.deletedAt),
      ))
      .limit(1),
  ])
  const out: RoleName[] = []
  if (taughtYears.length > 0) {
    const year = await schoolYear()
    if (taughtYears.some(r => r.year === year)) out.push('teacher')
  }
  if (familyRows[0]?.role === 'mother' || familyRows[0]?.role === 'father') out.push('family')
  return out
}

/** The family of the caller's live person in the tenant, matched by the address they signed in with; null if none. */
export async function familyIdOfIn(store: Store, email: string, tenantId: string): Promise<string | null> {
  const [row] = await store.select({ familyId: persons.familyId }).from(persons)
    .where(and(eq(persons.tenantId, tenantId), sql`lower(${persons.email}) = lower(${email})`, isNull(persons.deletedAt)))
    .limit(1)
  return row?.familyId ?? null
}
