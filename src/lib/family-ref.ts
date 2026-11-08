// The family identification printed at the bottom of every email addressed to a
// family, and the link it points at.
//
// The family identification goes at the bottom of the email, as a link to the roster.
//
// It lives in one function because an email that names a family has to name it
// the same way every time. Two emails about one family printing different
// things teaches the reader that the line cannot be trusted.
//
// The id is roster_families.id, a uuid, which every family has. legacy_family_id is
// nullable, so a footer built on it could be blank.
//
// The destination is the host's family-edit page (HostPage 'family-edit'), which
// opens a signed-in member's own family and turns anyone else away. It is the
// same address the session read answers as familyDetailsUrl, so every link to a
// family's details points at one place.

import type { FamilyRef } from './email-template'
import type { Tenant } from './tenant'
import { familyDetailsUrl, rosterPublicUrl } from './roster-public-url'
import { hostPage } from './host'

// The address is this environment's: it comes from the tenant's value for this environment, never a constant or an
// environment branch.
export async function familyRef(tenant: Tenant, familyId: string): Promise<FamilyRef> {
  return {
    id: familyId,
    url: await familyDetailsUrl(tenant, familyId),
  }
}

export async function dashboardUrl(tenant: Tenant): Promise<string> {
  return `${await rosterPublicUrl(tenant)}${hostPage('dashboard')}`
}
