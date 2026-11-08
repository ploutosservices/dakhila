// THE TENANT, AS THE ROSTER READS IT: the host's tenant row through its configuration port (ports.ts `tenants`) — its
// id, slug, time zone and long name. A host may hand a wider row; the roster reads these.
import { ports, type TenantRow } from '../ports'

export type Tenant = TenantRow

export async function getTenantById(id: string): Promise<Tenant | null> {
  return ports().tenants.byId(id)
}

export async function getTenantBySlug(slug: string): Promise<Tenant | null> {
  return ports().tenants.bySlug(slug)
}

/** A live tenant's time zone, or null when the host holds no live tenant by that id. */
export async function tenantTimezone(tenantId: string): Promise<string | null> {
  return (await getTenantById(tenantId))?.timezone ?? null
}
