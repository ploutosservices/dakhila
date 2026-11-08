// THE SCHOOL'S INTAKE FALLBACK, an operation the host calls after a sign-in. If no person of
// the tenant holds this address, it matches by display name among persons created within the school's
// `intakeClaimDays` whose
// address no user account holds (never logged in), and sets that person's address to this sign-in's.
import { db } from './db'
import { persons } from '../tables'
import { getTenantBySlug } from './tenant'
import { ports } from '../ports'
import { tenantRules } from './rules-context'
import { eq, and, isNull, sql, isNotNull, gte } from 'drizzle-orm'

export async function reconcileIntakeAddress(email: string, slug: string, displayName?: string | null): Promise<void> {
  // Which tenants use the fallback is the host's to decide: it asks only for those.
  if (!displayName) return
  const tenant = await getTenantBySlug(slug)
  if (!tenant) return

  const [person] = await db.select({ id: persons.id }).from(persons)
    .where(and(eq(persons.tenantId, tenant.id), sql`lower(${persons.email}) = lower(${email})`))
    .limit(1)
  if (person) return

  // A person created in the school's `intakeClaimDays` may be claimed by name.
  const days = (await tenantRules(tenant.id)).codes.intakeClaimDays
  const since = new Date(ports().clock.now().getTime() - days * 24 * 60 * 60 * 1000)
  const candidates = await db
    .select({ id: persons.id, email: persons.email })
    .from(persons)
    .where(and(
      eq(persons.tenantId, tenant.id),
      isNotNull(persons.email),
      gte(persons.createdAt, since),
      sql`lower(${persons.firstName} || ' ' || coalesce(${persons.lastName}, '')) = lower(${displayName})`,
    ))
  if (candidates.length !== 1) return
  const candidate = candidates[0]
  if (candidate.email && (await ports().records.userByAddress(candidate.email))) return
  console.warn(`[intake] email mismatch reconciled for person ${candidate.id}`)
  await db.update(persons).set({ email }).where(eq(persons.id, candidate.id))
}
