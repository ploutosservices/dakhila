// THE TENANT'S TEXTS BY KEY, AS THE ROSTER READS AND KEEPS THEM: through the configuration port (ports.ts
// `tenants.text`, `textOrNull`, `setText`), by the roster's key (TENANT_TEXTS), wherever the host keeps them.
import { ports, type TenantText } from '../ports'

export async function catalogValue(tenantId: string, key: TenantText): Promise<string> {
  return ports().tenants.text(tenantId, key)
}

export async function catalogValueOrNull(tenantId: string, key: TenantText): Promise<string | null> {
  return ports().tenants.textOrNull(tenantId, key)
}

export async function setCatalogValue(tenantId: string, key: TenantText, value: string): Promise<void> {
  return ports().tenants.setText(tenantId, key, value)
}
