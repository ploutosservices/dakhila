// Google API config — the school tenant
// Service account: the one the tenant declares for the roster's Google calls
// Key: the host's (the Google port's serviceAccountKey)
// DWD: Google Workspace Admin → Security → API Controls → Domain-wide Delegation
// What it can do (scopes granted, APIs enabled, plan) is measured against Google, never recalled.

import { dowryValue } from './dowry'

/**
 * The lead teacher's address: the account that owns every Google Classroom and the school
 * calendar, and the reply-to of classroom mail. The TENANT brings it (the tenant value
 * `lead-teacher-email`); it is written nowhere in the code.
 */
export function leadTeacherEmail(tenantId: string): Promise<string> {
  return dowryValue(tenantId, 'lead-teacher-email')
}

// The owner an outward act NAMES. Where the act is real the value is required; off production nothing is made with
// it, so an environment that does not hold it names its absence instead of refusing a write that answers with a
// stand-in.
export async function leadTeacherFor(tenantId: string, real: boolean): Promise<string> {
  if (real) return leadTeacherEmail(tenantId)
  return leadTeacherEmail(tenantId).catch(() => 'the lead teacher (lead-teacher-email is not set in this environment)')
}

// The tenant's ONE sending identity is the host's — the mail port resolves it. Google Classroom is administered
// as the lead teacher (lead-teacher-email); the Directory and the groups as the tenant's directory-admin
// role (role-mailbox.ts); no person's mailbox is written here.
