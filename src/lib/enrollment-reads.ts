// THE ENROLLMENT READS — the year's list and one family's enrollment. A caller receives plain rows.
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { db } from './db'
import { cashEnrollmentPayments, persons, rosterFamilies, rosterFamilyTracker, familyEnrollments } from '../tables'
import { personNames } from './person-names'
import { type FamilyName, labelsOf, personName } from './family-label'

/** The year's tracker rows whose status is one of `statuses`, with the registration date. */
export function trackerRowsWithStatus(tenantId: string, year: number, statuses: number[]) {
  return db
    .select({ familyId: rosterFamilyTracker.familyId, enrollmentStatus: rosterFamilyTracker.enrollmentStatus, registrationDate: rosterFamilyTracker.registrationDate })
    .from(rosterFamilyTracker)
    .where(and(
      eq(rosterFamilyTracker.tenantId, tenantId),
      eq(rosterFamilyTracker.year, year),
      inArray(rosterFamilyTracker.enrollmentStatus, statuses),
    ))
}

/** Every enrollment of the year: its id, family, status, and the day it was first made (the fee's rate, tuition-owed.ts). */
export function enrollmentsOfYear(tenantId: string, year: number) {
  return db
    .select({
      id: familyEnrollments.id,
      familyId: familyEnrollments.familyId,
      status: familyEnrollments.status,
      createdAt: familyEnrollments.createdAt,
    })
    .from(familyEnrollments)
    .where(and(
      eq(familyEnrollments.tenantId, tenantId),
      eq(familyEnrollments.year, year),
    ))
}

/** The tenant's families among `familyIds`, with their parents' ids. */
export async function familiesWithParents(tenantId: string, familyIds: string[]) {
  if (!familyIds.length) return []
  return db
    .select({
      id: rosterFamilies.id,
      legacyFamilyId: rosterFamilies.legacyFamilyId,
      motherId: rosterFamilies.motherId,
      fatherId: rosterFamilies.fatherId,
    })
    .from(rosterFamilies)
    .where(and(
      eq(rosterFamilies.tenantId, tenantId),
      inArray(rosterFamilies.id, familyIds),
    ))
}

/** The given families' parents' names — the data a family's display name is built from (family-label.ts). */
export async function familyNames(tenantId: string, familyIds: string[]): Promise<FamilyName[]> {
  const families = await familiesWithParents(tenantId, [...new Set(familyIds)])
  const parents = await personNames([...new Set(families.flatMap(f => [f.motherId, f.fatherId].filter(Boolean) as string[]))])
  const nameOf = new Map(parents.map(p => [p.id, personName(p)]))
  return families.map(f => ({
    id: f.id, legacyFamilyId: f.legacyFamilyId,
    mother: f.motherId ? nameOf.get(f.motherId) ?? null : null, father: f.fatherId ? nameOf.get(f.fatherId) ?? null : null,
  }))
}

/** Each family named by its parents ("Mother / Father"), or "Family <legacy id>" when it has none named. */
export async function familyLabels(tenantId: string, familyIds: string[]): Promise<Map<string, string>> {
  return labelsOf(await familyNames(tenantId, familyIds))
}

/** Every family of the tenant's names — the list a bursar chooses from when a payment is matched to an event,
 * labelled and sorted by familyOptions. roster_families keeps no deleted rows. */
export async function tenantFamilyNames(tenantId: string): Promise<FamilyName[]> {
  const ids = (await db.select({ id: rosterFamilies.id }).from(rosterFamilies).where(eq(rosterFamilies.tenantId, tenantId))).map(r => r.id)
  return familyNames(tenantId, ids)
}

/** For each given address, the one family that holds a live person with it; an address two families hold, or none,
 *  is absent (the list is preselected only then). Compared without case. */
export async function soleFamilyOfAddresses(tenantId: string, addresses: string[]): Promise<Map<string, string>> {
  const wanted = [...new Set(addresses.map(a => a.trim().toLowerCase()).filter(Boolean))]
  if (!wanted.length) return new Map()
  const rows = await db.select({ email: sql<string>`lower(${persons.email})`, familyId: persons.familyId })
    .from(persons)
    .where(and(eq(persons.tenantId, tenantId), isNull(persons.deletedAt), inArray(sql`lower(${persons.email})`, wanted)))
  const families = new Map<string, Set<string>>()
  for (const r of rows) if (r.familyId) families.set(r.email, (families.get(r.email) ?? new Set()).add(r.familyId))
  return new Map([...families].filter(([, f]) => f.size === 1).map(([e, f]) => [e, [...f][0]]))
}

/** Money received toward each of the given enrollments, summed. */
export async function paymentTotalsByEnrollment(enrollmentIds: string[]): Promise<{ enrollmentId: string; total: number }[]> {
  if (!enrollmentIds.length) return []
  return (await db
    .select({
      enrollmentId: cashEnrollmentPayments.enrollmentId,
      total: sql<string>`coalesce(sum(amount), 0)`,
    })
    .from(cashEnrollmentPayments)
    .where(inArray(cashEnrollmentPayments.enrollmentId, enrollmentIds))
    .groupBy(cashEnrollmentPayments.enrollmentId)
  ).map(r => ({ enrollmentId: r.enrollmentId, total: parseFloat(r.total as unknown as string) }))
}

/** The tenant's family row, whole; null when it is not the tenant's. */
export async function tenantFamilyRow(tenantId: string, familyId: string) {
  const [family] = await db
    .select()
    .from(rosterFamilies)
    .where(and(eq(rosterFamilies.id, familyId), eq(rosterFamilies.tenantId, tenantId)))
    .limit(1)
  return family ?? null
}

/** The given parents, in the order given (mother, then father), with name and role. */
export async function parentsInOrder(parentIds: string[]) {
  const out: { id: string; firstName: string; lastName: string | null; role: string | null }[] = []
  for (const id of parentIds.slice(0, 2)) {
    out.push(...await db.select({ id: persons.id, firstName: persons.firstName, lastName: persons.lastName, role: persons.role })
      .from(persons).where(eq(persons.id, id)))
  }
  return out
}

/** The family's live children (boys and girls), by first name. */
export function familyChildrenByName(tenantId: string, familyId: string) {
  return db
    .select({ id: persons.id, firstName: persons.firstName, lastName: persons.lastName, firstGradeYear: persons.firstGradeYear })
    .from(persons)
    .where(and(
      eq(persons.tenantId, tenantId),
      eq(persons.familyId, familyId),
      inArray(persons.role, ['boy', 'girl']),
      isNull(persons.deletedAt),
    ))
    .orderBy(persons.firstName)
}

/** The payments received toward one enrollment, oldest first. */
export function enrollmentPayments(enrollmentId: string) {
  return db
    .select({
      id: cashEnrollmentPayments.id,
      amount: cashEnrollmentPayments.amount,
      method: cashEnrollmentPayments.method,
      paypalOrderId: cashEnrollmentPayments.paypalOrderId,
      notes: cashEnrollmentPayments.notes,
      processingFee: cashEnrollmentPayments.processingFee,
      paidAt: cashEnrollmentPayments.paidAt,
      referenceId: cashEnrollmentPayments.referenceId,
      createdAt: cashEnrollmentPayments.createdAt,
    })
    .from(cashEnrollmentPayments)
    .where(eq(cashEnrollmentPayments.enrollmentId, enrollmentId))
    .orderBy(cashEnrollmentPayments.createdAt)
}
