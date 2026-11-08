// The roster's own public address, PER ENVIRONMENT — read from the tenant's configuration, never written down here.
//
// The rule: no address in the code. This file holds the rule instead of the address. A link one environment composes
// names that environment, so no environment's mail or page sends a reader into another environment's roster.
//
// There is no default and no literal: an environment with no value THROWS, because a link into the wrong environment
// is worse than an error that names what is missing.
import { getTenantById, type Tenant } from './tenant'
import { dowryValueOrNull } from './dowry'
import { environmentName, hostPage } from './host'

export class RosterUrlUnknown extends Error {}

// READ FROM THE TENANT'S CONFIGURATION, keyed to THIS ENVIRONMENT: one value per environment, and an environment with
// no value REFUSES. No environment is enumerated, and none falls back to another's address.
export async function rosterPublicUrl(tenant: Tenant): Promise<string> {
  const url = await dowryValueOrNull(tenant.id, 'roster-address')
  if (!url) {
    throw new RosterUrlUnknown(
      `tenant ${tenant.slug} has no roster-address for the '${environmentName()}' environment. The host's configuration ` +
      `owes it — this environment will not borrow another environment's address.`,
    )
  }
  return url
}

export async function familyDetailsUrl(tenant: Tenant, familyId: string): Promise<string> {
  return `${await rosterPublicUrl(tenant)}${hostPage('family-edit', familyId)}`
}

// The evaluations screen a teacher is sent to. Same rule as every other link: the environment names itself.
export async function evaluationsUrl(tenant: Tenant): Promise<string> {
  return `${await rosterPublicUrl(tenant)}${hostPage('evaluations')}`
}

// The enrolment screen a family is sent to, and the account help page a teacher is sent
// to. Same rule, same reason: whichever host composes the mail names ITSELF.
export async function enrollmentUrl(tenant: Tenant, familyId: string): Promise<string> {
  return `${await rosterPublicUrl(tenant)}${hostPage('family-enrollment', familyId)}`
}

export async function teacherAccountHelpUrl(tenant: Tenant): Promise<string> {
  return `${await rosterPublicUrl(tenant)}${hostPage('teacher-account')}`
}

// The tenant row, or a refusal that names the tenant rather than a null deref. A caller
// that has only a tenantId — every email sender does — needs one line, not four.
export async function requireTenant(tenantId: string): Promise<Tenant> {
  const tenant = await getTenantById(tenantId)
  if (!tenant) throw new RosterUrlUnknown(`no tenant row for ${tenantId} — the roster cannot name its own address for it`)
  return tenant
}
