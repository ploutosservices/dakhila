// THE FAMILY AN ENROLLMENT BELONGS TO — the family id an enrollment's record id leads to, answered by the roster
// API's public door `record.enrollmentFamily`, so a caller resolving a record id reads no roster table.
import { eq } from 'drizzle-orm'
import { db } from './db'
import { familyEnrollments } from '../tables'

/** The enrollment's family id, or null when there is no such enrollment. */
export async function enrollmentFamilyId(id: string): Promise<string | null> {
  const [row] = await db.select({ familyId: familyEnrollments.familyId }).from(familyEnrollments)
    .where(eq(familyEnrollments.id, id)).limit(1)
  return row?.familyId ?? null
}
