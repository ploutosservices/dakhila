// THE TENANT'S ROLE ACCOUNTS, AS THE ROSTER READS THEM: a role account's mailbox through the configuration port
// (ports.ts `tenants.role`, ROLE_ACCOUNTS), refused by the host when absent or a person's own; the directory's domain is
// a value the tenant brought.
import { ports, type RoleAccount } from '../ports'
import { dowryValue } from './dowry'

/** The mailbox of the tenant's role account. */
export async function roleMailbox(tenantId: string, account: RoleAccount): Promise<string> {
  return ports().tenants.role(tenantId, account)
}

/** The account the directory and the groups are administered as. */
export async function workspaceAdmin(tenantId: string): Promise<string> {
  return roleMailbox(tenantId, 'directory-admin')
}

/** The tenant's directory domain. */
export async function workspaceDomain(tenantId: string): Promise<string> {
  return dowryValue(tenantId, 'workspace-domain')
}

/** The directory admin an outward act names. Where the act is real the role is required; off production nothing is
 *  made with it, so an environment that lacks the account names its absence. */
export async function workspaceAdminFor(tenantId: string, real: boolean): Promise<string> {
  if (real) return workspaceAdmin(tenantId)
  return workspaceAdmin(tenantId).catch(e => `the directory-admin account (${e instanceof Error ? e.message : String(e)})`)
}
