// FAMILY. family.get: a family's id and its two parent links, read by familyGet below — the one place this read is
// answered.
import { and, eq } from 'drizzle-orm'
import { rosterFamilies } from './tables'
import type { Store } from './store'
import type { Route } from './routes'
import { mayOrOwn, notFound, ok, OWN_FAMILY, S } from './op'

export type FamilyParents = { id: string; motherId: string | null; fatherId: string | null }

/** The family, when it is the tenant's; null otherwise. */
export async function familyGet(store: Store, tenantId: string, familyId: string): Promise<FamilyParents | null> {
  const [family] = await store
    .select({ id: rosterFamilies.id, motherId: rosterFamilies.motherId, fatherId: rosterFamilies.fatherId })
    .from(rosterFamilies)
    .where(and(eq(rosterFamilies.id, familyId), eq(rosterFamilies.tenantId, tenantId)))
    .limit(1)
  return family ?? null
}

export const FAMILY_ROUTES: Route[] = [
  {
    method: 'GET',
    path: '/v1/tenants/{slug}/families/{id}',
    operationId: 'family.get',
    summary: "A family's id and its two parent links.",
    permission: 'roster.read',
    alsoAllowed: OWN_FAMILY,
    allowed: c => mayOrOwn(c, 'roster.read', c.params.id),
    response: { ...S.obj({ id: S.uuid, motherId: S.nullable(S.uuid), fatherId: S.nullable(S.uuid) }), additionalProperties: false },
    handle: async c => {
      const family = await familyGet(c.store, c.tenant.id, c.params.id)
      return family ? ok(family) : notFound('no such family in this tenant')
    },
  },
]
