// WHO THE CALLER IS, AND WHAT THEY MAY, IN THE TENANT OF THE PATH. The decision is the roster's own (access-rule.ts): given roles from the verified token's
// roster roles (where the host's Identity.roleClaims says the door puts them), counted where the tenant offers them (the host's answer); teacher and family from the
// roster's rows; the picked subset from the host. The verified address must be the host's user: a verified address
// with no user is refused, and nothing is created.
import { academicYearOf } from './lib/year-context'
import { type Permission, type RoleName, givenHere, heldFrom, activeFrom, permitted } from './access-rule'
import { derivedFromRows, familyIdOfIn } from './lib/access-rows'
import { ports } from './ports'
import type { Store } from './store'
import type { Verified } from './token'

export type Caller = { userId: string; email: string; tenantId: string; slug: string; active: RoleName[] }

/** The host's user behind a verified address, with the name an act records, or null. */
export async function userOf(email: string): Promise<{ id: string; name: string | null } | null> {
  return ports().records.userByAddress(email)
}

/** The caller's active roles in a tenant. */
export async function callerIn(store: Store, v: Verified, userId: string | null, tenant: { id: string; slug: string }): Promise<Caller> {
  // No host user (an address-only read): no roles picked, so every held role is active; userId ''.
  const [derived, offered, picked] = await Promise.all([
    derivedFromRows(store, tenant.id, v.email, () => academicYearOf(tenant.id)),
    ports().tenants.offeredRoles(tenant.id),
    userId ? ports().records.pickedRoles(userId, tenant.id) : Promise.resolve(null),
  ])
  const held = heldFrom(givenHere(v.roles, tenant.slug), derived, offered)
  return { userId: userId ?? '', email: v.email, tenantId: tenant.id, slug: tenant.slug, active: activeFrom(held, picked) }
}

export function may(c: Caller, permission: Permission): boolean {
  return permitted(c.active, permission)
}

/** The caller's own family in the tenant: their live person's family, matched by address (no role asked). */
export async function ownFamilyOf(store: Store, c: Caller): Promise<string | null> {
  return familyIdOfIn(store, c.email, c.tenantId)
}
