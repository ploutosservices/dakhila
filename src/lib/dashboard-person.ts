// THE SIGNED-IN PERSON'S OWN PERSON ROW — a read of persons alone, which role derivation keeps everywhere; apart from
// dashboard.ts, so its importers reach no other table.
import { and, eq, isNull } from 'drizzle-orm'
import { db } from './db'
import { persons } from '../tables'

export async function dashboardPersonId(tenantId: string, email: string): Promise<string | null> {
  const [row] = await db.select({ id: persons.id }).from(persons)
    .where(and(eq(persons.email, email), eq(persons.tenantId, tenantId), isNull(persons.deletedAt))).limit(1)
  return row?.id ?? null
}
