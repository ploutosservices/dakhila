// THE FAMILY SCREENS' READS — the families list, a family's dashboard and its edit form. The pages call these and receives plain rows.
import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import { db } from './db'
import { persons, rosterFamilies, rosterFamilyTracker, familyEnrollments } from '../tables'
import { enrollmentStatusGroups } from './roster-enrollment-status'
import { tenantRules } from './rules-context'

/**
 * The families holding a status in a year. "enrolled" is derived from family_enrollments.status — not stored in
 * tracker: current-year registered = fee enrollment marked 'enrolled'; historical = a tracker status the school counts as
 * enrolled (SchoolRules.codes.enrollmentStatus.enrolled). Any other
 * status reads the tracker ("pending", "declined", or every tracker row of the year).
 */
export async function familyIdsWithStatus(tenantId: string, year: number, status: string): Promise<Set<string>> {
  const { enrolled: ENROLLED, pending: PENDING, declined: DECLINED } = enrollmentStatusGroups((await tenantRules(tenantId)).codes)
  if (status === 'enrolled') {
    const [feeEnrolled, legacyEnrolled] = await Promise.all([
      db.select({ familyId: familyEnrollments.familyId })
        .from(familyEnrollments)
        .where(and(
          eq(familyEnrollments.tenantId, tenantId),
          eq(familyEnrollments.year, year),
          eq(familyEnrollments.status, 'enrolled'),
        )),
      db.select({ familyId: rosterFamilyTracker.familyId })
        .from(rosterFamilyTracker)
        .where(and(
          eq(rosterFamilyTracker.tenantId, tenantId),
          eq(rosterFamilyTracker.year, year),
          inArray(rosterFamilyTracker.enrollmentStatus, ENROLLED),
        )),
    ])
    return new Set([...feeEnrolled, ...legacyEnrolled].map(r => r.familyId))
  }
  const statuses = status === 'pending' ? PENDING
    : status === 'declined' ? DECLINED
    : null
  const trackerRows = await db
    .select({ familyId: rosterFamilyTracker.familyId })
    .from(rosterFamilyTracker)
    .where(and(
      eq(rosterFamilyTracker.tenantId, tenantId),
      eq(rosterFamilyTracker.year, year),
      statuses ? inArray(rosterFamilyTracker.enrollmentStatus, statuses) : undefined,
    ))
  return new Set(trackerRows.map(r => r.familyId))
}

/**
 * The tenant's families, newest legacy id first — `'all'` for a reader, or `{ familyId }` for a parent looking at
 * their own record, where a null familyId is a parent with no family, who sees none. A deleted family is
 * GONE, so nothing here filters for it.
 */
export function familiesForList(tenantId: string, scope: 'all' | { familyId: string | null }) {
  const where = scope === 'all'
    ? eq(rosterFamilies.tenantId, tenantId)
    : and(eq(rosterFamilies.tenantId, tenantId), scope.familyId ? eq(rosterFamilies.id, scope.familyId) : isNull(rosterFamilies.id))
  return db
    .select({
      id: rosterFamilies.id,
      legacyFamilyId: rosterFamilies.legacyFamilyId,
      city: rosterFamilies.city,
      state: rosterFamilies.state,
      motherId: rosterFamilies.motherId,
      fatherId: rosterFamilies.fatherId,
    })
    .from(rosterFamilies)
    .where(where)
    .orderBy(desc(rosterFamilies.legacyFamilyId))
}

/** Every live person of the tenant: name, family and address. */
export function tenantPersonsBrief(tenantId: string) {
  return db
    .select({ id: persons.id, firstName: persons.firstName, lastName: persons.lastName, familyId: persons.familyId, email: persons.email })
    .from(persons)
    .where(and(eq(persons.tenantId, tenantId), isNull(persons.deletedAt)))
}

/** A family's row and its live members, whole — what the family form edits; null when not the tenant's. */
export async function familyForEdit(tenantId: string, familyId: string) {
  const [family] = await db
    .select()
    .from(rosterFamilies)
    .where(and(eq(rosterFamilies.id, familyId), eq(rosterFamilies.tenantId, tenantId)))
    .limit(1)
  if (!family) return null
  const members = await db
    .select()
    .from(persons)
    .where(and(eq(persons.familyId, familyId), eq(persons.tenantId, tenantId), isNull(persons.deletedAt)))
  return { family, members }
}

