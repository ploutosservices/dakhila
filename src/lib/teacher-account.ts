/**
 * Provisioning a teacher's school Google account, for Google Classroom.
 *
 * Given a roster person it picks an in-domain address, creates the account in the school's
 * directory, and records the address in persons.classroom_email. It never emails — the welcome
 * email is a separate step.
 *
 * Uses the school's service account with the admin.directory.user scope (delegated to it).
 * Idempotent at the caller's level: a person who already has a classroom_email is skipped by the
 * caller, not re-provisioned here.
 */
import { google, jwtClient } from './google'
import { workspaceAdmin, workspaceAdminFor, workspaceDomain } from './role-mailbox'
import { isProduction } from './host'
import { outwardAct, type Actor } from './outward-act'
import { notMade, type NotMade } from './not-made'
import { DIRECTORY_USER_SCOPES } from './google-scopes'
import { ports } from '../ports'
import { schoolWord } from './school-words'


// Off production this module makes NO Google call at all: account creation returns NotMade —
// the statement of the account it did not make, and no password — and the directory is not read.
// The welcome email off production reaches the tenant's own address (the host's mail port) and
// says the account was not made, so the whole flow stays testable end to end without touching the
// school's directory.

// As the tenant's directory-admin role.
async function directory(tenantId: string) {
  const key = JSON.parse(await ports().google.serviceAccountKey())
  const auth = jwtClient({
    email: key.client_email, key: key.private_key, scopes: DIRECTORY_USER_SCOPES, subject: await workspaceAdmin(tenantId),
  })
  return google.admin({ version: 'directory_v1', auth })
}

/** Slug a name part to the local part of an address: lowercase, letters only. */
function slug(s: string): string {
  return (s || '').toLowerCase().normalize('NFD').replace(/[^a-z]/g, '')
}

/** A pattern's local part for a name: `{first}`, `{last}` and `{l}` (the last name's initial) filled; null when the
 *  pattern names a part the name lacks. */
function fillPattern(pattern: string, f: string, l: string): string | null {
  if ((pattern.includes('{first}') && !f) || ((pattern.includes('{last}') || pattern.includes('{l}')) && !l)) return null
  return pattern.replace(/\{first\}/g, f).replace(/\{last\}/g, l).replace(/\{l\}/g, l.charAt(0))
}

/**
 * Choose an in-domain address for a teacher, avoiding collisions with addresses
 * already taken (existing directory accounts AND classroom_email values already
 * assigned). The rule is the school's (SchoolRules.codes.teacherAddresses): its patterns in order, the first one free.
 * Nothing is reserved.
 */
export function chooseAddress(patterns: readonly string[], firstName: string, lastName: string, taken: ReadonlySet<string>, domain: string): string {
  const DOMAIN = domain.trim().toLowerCase()
  const f = slug(firstName), l = slug(lastName)
  const locals = patterns.map(p => fillPattern(p, f, l)).filter((x): x is string => !!x)
  for (const local of locals) if (!taken.has(`${local}@${DOMAIN}`)) return `${local}@${DOMAIN}`
  // Exhausted the rule — append a numeric suffix to the last pattern the name fills rather than fail or collide.
  const base = locals.at(-1) ?? 'teacher'
  for (let i = 2; i < 50; i++) {
    const c = `${base}${i}@${DOMAIN}`
    if (!taken.has(c.toLowerCase())) return c
  }
  throw new Error(`could not choose an address for ${firstName} ${lastName}`)
}

/** Every address in the tenant's directory domain currently in use — directory accounts, lowercased. */
export async function takenAddresses(tenantId: string): Promise<Set<string>> {
  // Off-prod: no directory read. Callers still add DB-assigned classroom_email
  // values on top, so simulated address choice stays collision-free locally.
  if (!isProduction()) return new Set()
  const admin = await directory(tenantId)
  const domain = await workspaceDomain(tenantId)
  const out = new Set<string>()
  let pageToken: string | undefined
  do {
    const res = await admin.users.list({ domain, maxResults: 500, pageToken })
    for (const u of res.data.users ?? []) if (u.primaryEmail) out.add(u.primaryEmail.toLowerCase())
    pageToken = res.data.nextPageToken ?? undefined
  } while (pageToken)
  return out
}

/** A random 16-char password. Dead on first use — changePasswordAtNextLogin is set. */
export function tempPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%'
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, b => alphabet[b % alphabet.length]).join('')
}

/**
 * Create the Google account. Returns the temp password (needed for the welcome email), or off production NotMade
 * naming the address it would have had. Throws if the account already exists — the caller must not double-provision.
 */
// An outward act: recorded under `actor`, refused under view-as. The record names the address made,
// never the password.
export async function createGoogleAccount(
  tenantId: string, address: string, firstName: string, lastName: string, actor: Actor,
): Promise<{ address: string; password: string } | NotMade> {
  const real = isProduction()
  return outwardAct<{ address: string; password: string } | NotMade>(
    { tenantId, kind: 'account', actor, role: await workspaceAdminFor(tenantId, real), destination: `a Workspace account ${address}`, delivery: real ? 'real' : 'stand-in' },
    async () => {
      // Off production: before any secret read or Google call — no account, no password, and nothing stored that names one.
      if (!real) return { value: notMade(`the Google Workspace account ${address} for ${firstName} ${lastName}`.trim(), [address]) }
      const admin = await directory(tenantId)
      const password = tempPassword()
      const r = await admin.users.insert({
        requestBody: {
          primaryEmail: address,
          name: { givenName: firstName || 'Teacher', familyName: lastName || await schoolWord(tenantId, 'name') },
          password,
          changePasswordAtNextLogin: true,
        },
      })
      return { value: { address, password }, vendorRef: r.data.id ?? null }
    },
  )
}
