// WHETHER THE ROSTER RUNS FOR A TENANT: tenant configuration, not permission, through the configuration port
// (ports.ts `tenants.rosterOn`).
import { ports } from '../ports'

export async function rosterOn(tenantId: string): Promise<boolean> {
  return ports().tenants.rosterOn(tenantId)
}
