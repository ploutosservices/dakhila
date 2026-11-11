// THE ROSTER'S ACCESS RULE, WITH NO STORE: the objects the roster's
// operations ask, the roles whose bundles reach them, their hierarchy, and the one function that turns what a caller
// holds into a yes or a no. Pure. A host whose own rule covers more than the roster holds every role here, for every
// permission here, to its own answer in its tests.

export const OBJECTS = [
  'roster', 'placement', 'enrollment', 'bursar', 'google', 'calendar', 'email', 'household', 'genealogy', 'newsletter',
  'drive', 'volunteer', 'event',
  // The tenant's owner's acts inside a tenant: deleting a family, the event types, a new genealogy person.
  'tenant',
] as const
export const ACTIONS = ['read', 'write', 'delete', 'approve', 'export'] as const

export type ObjectType = typeof OBJECTS[number]
export type Action = typeof ACTIONS[number]
export type Permission = `${ObjectType}.${Action}`

const objectAll = (o: ObjectType): Permission[] => ACTIONS.map(a => `${o}.${a}` as Permission)
const every = (except: ObjectType[] = []): Permission[] => OBJECTS.filter(o => !except.includes(o)).flatMap(objectAll)

/** The roles given at the door per tenant, and the two relationships the roster works out from its rows. */
export const GIVEN_ROLES = ['owner', 'principal', 'accounting', 'office-reader', 'coordinator', 'genealogy-reader', 'genealogy-editor'] as const
export type RoleName = typeof GIVEN_ROLES[number] | 'teacher' | 'family'

export const ROLE_BUNDLES: Record<RoleName, Permission[]> = {
  // Everything in the tenant, the owner's own acts included.
  owner: every(),
  // Everything in the school but the owner's acts.
  principal: every(['tenant']),
  // Money and what it is for: the bursar's work, refunds approved, and families and enrollment read.
  accounting: ['bursar.read', 'bursar.write', 'bursar.approve', 'enrollment.read', 'roster.read'],
  // The back office, read only.
  'office-reader': ['bursar.read'],
  // Volunteering work and events.
  coordinator: ['volunteer.read', 'volunteer.write', 'volunteer.delete', 'event.read', 'event.write', 'event.delete'],
  'genealogy-reader': ['genealogy.read'],
  'genealogy-editor': objectAll('genealogy'),
  // A current teacher: every family read, placement, the Classroom views, every class's postings, the Drive searched.
  teacher: ['roster.read', 'placement.read', 'placement.write', 'google.read', 'newsletter.read', 'drive.read'],
  // Their own household only.
  family: ['household.read'],
}

/** What each role's bundle holds, in plain words for a host to show beside the role.
 *  One line per role; a role with none fails to compile. */
export const ROLE_WORDS: Record<RoleName, string> = {
  owner: 'Everything in the tenant, the owner\'s own acts included.',
  principal: 'Everything in the school but the owner\'s acts.',
  accounting: 'Money and what it is for: the bursar\'s work, refunds approved, and families and enrollment read.',
  'office-reader': 'The back office, read only.',
  coordinator: 'Volunteering work and events.',
  'genealogy-reader': 'The family tree, read.',
  'genealogy-editor': 'The family tree, read and changed.',
  teacher: 'A current teacher: every family read, placement, the Classroom views, every class\'s postings, the Drive searched.',
  family: 'Their own household only.',
}

/** Roles formally include lesser roles. */
export const ROLE_HIERARCHY: Partial<Record<RoleName, RoleName[]>> = {
  principal: ['teacher', 'accounting'],
  accounting: ['office-reader'],
  'genealogy-editor': ['genealogy-reader'],
}

export function expandHierarchy(roles: readonly RoleName[]): RoleName[] {
  const seen = new Set<RoleName>()
  const stack = [...roles]
  let guard = 0
  while (stack.length) {
    if (++guard > 100) throw new Error('access rule: ROLE_HIERARCHY cycle detected')
    const r = stack.pop()!
    if (seen.has(r)) continue
    seen.add(r)
    for (const junior of ROLE_HIERARCHY[r] ?? []) stack.push(junior)
  }
  return [...seen]
}

// A bad edit dies at load, not at a request.
expandHierarchy(Object.keys(ROLE_BUNDLES) as RoleName[])

/** The roles of `given` (`<slug>:<role>`) that are this tenant's, prefix removed. */
export function givenHere(given: readonly string[], slug: string): string[] {
  const prefix = `${slug}:`
  return given.filter(r => r.startsWith(prefix)).map(r => r.slice(prefix.length))
}

/** Every role a caller holds in a tenant: a given role counts only where the tenant offers it (the host's answer); a
 *  string that names no given role is dropped, never guessed; the relationships always count. */
export function heldFrom(given: readonly string[], derived: readonly RoleName[], offered: readonly string[]): RoleName[] {
  const here = new Set(offered)
  const out: RoleName[] = []
  for (const g of given) {
    const r = g.toLowerCase().trim()
    if (!(GIVEN_ROLES as readonly string[]).includes(r) || !here.has(r) || out.includes(r as RoleName)) continue
    out.push(r as RoleName)
  }
  for (const d of derived) if (!out.includes(d)) out.push(d)
  return out
}

/** The held roles narrowed to the picked subset; all held when nothing is picked or nothing picked is still held —
 *  losing a role always shrinks access, never freezes it. */
export function activeFrom(held: RoleName[], picked: string[] | null): RoleName[] {
  if (!picked) return held
  const active = held.filter(r => picked.includes(r))
  return active.length > 0 ? active : held
}

/** THE decision: the union of the active roles' bundles, hierarchy included. No bypass for anyone. */
export function permitted(active: readonly RoleName[], permission: Permission): boolean {
  for (const role of expandHierarchy(active)) if (ROLE_BUNDLES[role].includes(permission)) return true
  return false
}
