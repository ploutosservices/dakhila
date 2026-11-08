// A family's classroom table for an email: the store reads. family-classes-build.ts builds the table from a family
// card and its FamilyFacts; the universe answers carry the facts, and code without them reads them here.

import { db } from './db'
import { persons, rosterAvailableClasses, rosterCourseCatalog } from '../tables'
import { eq, inArray } from 'drizzle-orm'
import { academicYearOf } from './year-context'
import type { FamilyCard } from './three-universes'
import { runThreeUniverses } from './three-universes-load'
import { getSchoolDays } from './roster-teacher-vacation'
import { getTenantById, type Tenant } from './tenant'
import type { FamilyGrid } from './family-grid'
import { cardClassIds, emailGridFromCard, type FamilyFacts } from './family-classes-build'

export { familyIdOf, firstNameOf } from './person-family'

/** The family facts for these classes in a school year, read from the store. */
export async function familyFactsFor(tenantId: string, year: number, classIds: string[]): Promise<FamilyFacts> {
  const schoolStart = (await getSchoolDays(tenantId, year))[0]?.date ?? null
  const deptRows = classIds.length
    ? await db.select({ id: rosterAvailableClasses.id, department: rosterCourseCatalog.department })
        .from(rosterAvailableClasses)
        .leftJoin(rosterCourseCatalog, eq(rosterCourseCatalog.id, rosterAvailableClasses.courseId))
        .where(inArray(rosterAvailableClasses.id, classIds))
    : []
  return { schoolStart, departments: Object.fromEntries(deptRows.map(r => [r.id, r.department])) }
}

/** A card's email table, its facts read from the store. */
async function emailGridFromStore(tenant: Tenant, card: FamilyCard): Promise<FamilyGrid> {
  return emailGridFromCard(tenant, card, await familyFactsFor(tenant.id, await academicYearOf(tenant.id), cardClassIds(card)))
}

/**
 * The grid of the family a person belongs to. Refuses rather than sending a joining email with no
 * grid: a run refused at the data-quality gate has no cards, and a person with no family has none.
 */
export async function familyGridForPerson(tenantId: string, personId: string): Promise<FamilyGrid> {
  const [p] = await db.select({ familyId: persons.familyId }).from(persons).where(eq(persons.id, personId)).limit(1)
  if (!p?.familyId) throw new Error('this person belongs to no family, so there is no classroom grid to send')
  const tenant = await getTenantById(tenantId)
  if (!tenant) throw new Error('tenant not found')
  const run = await runThreeUniverses(tenantId)
  if (!run.accepted) throw new Error('the family map run was refused at the data-quality gate — no grid, so no email')
  const card = run.familyCards.find(c => c.familyId === p.familyId)
  if (!card) throw new Error('the family has no card in the current family map run — no grid, so no email')
  const grid = await emailGridFromStore(tenant, card)
  if (grid.recipients.length === 0) throw new Error('the family map holds no address for this family — nobody to send to')
  return grid
}
