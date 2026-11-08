// WHAT THE TENANT BROUGHT, AS THE ROSTER READS IT: a value by the roster's key (TENANT_VALUES) through the
// configuration port (ports.ts `tenants.dowry`; the dowry is the configuration a tenant brings before the roster runs
// for it). The host refuses a value the tenant has not brought in this environment; it never falls back.
import { ports, type TenantValue } from '../ports'

export async function dowryValue(tenantId: string, key: TenantValue): Promise<string> {
  return ports().tenants.dowry(tenantId, key)
}

/** The same read for a surface that must still render: null means "not brought in this environment", and the caller says
 *  so — it never substitutes a literal. */
export async function dowryValueOrNull(tenantId: string, key: TenantValue): Promise<string | null> {
  try {
    return await dowryValue(tenantId, key)
  } catch {
    return null
  }
}
