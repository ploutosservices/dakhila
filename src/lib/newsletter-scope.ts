// WHOSE POSTINGS A NEWSLETTERS LIST SHOWS, the roster half: one family's or one person's classrooms, whether the viewer
// is that family or one of its people, and the viewer's own classrooms for a single posting. Whose classrooms are whose
// is the three-universes run's answer. The postings themselves are the host's.
import { runThreeUniverses } from './three-universes-load'
import { familyCourseIds, personCourseIds } from './newsletters-store'
import { getFamily, getPersonByEmail, getPersonById } from './roster-families'

export type NewsletterScope = { label: string; courseIds: string[]; authorPersonId: string | null; refused: boolean }
export type ScopeAsk = { family: string | null; person: string | null }

/** One family's or one person's classrooms, as the list's filter; null when there is no such family or person. */
export async function newsletterScope(tenantId: string, ask: ScopeAsk): Promise<NewsletterScope | null> {
  if (ask.family) {
    const family = await getFamily(tenantId, ask.family)
    if (!family) return null
    const rooms = familyCourseIds(await runThreeUniverses(tenantId), family.id)
    return { label: `family ${family.legacyFamilyId ?? ''}`.trim(), courseIds: rooms ?? [], authorPersonId: null, refused: rooms === null }
  }
  if (ask.person) {
    const person = await getPersonById(tenantId, ask.person)
    if (!person) return null
    const rooms = personCourseIds(await runThreeUniverses(tenantId), person.id)
    return {
      label: [person.firstName, person.lastName].filter(Boolean).join(' '),
      courseIds: rooms ?? [], authorPersonId: person.id, refused: rooms === null,
    }
  }
  return null
}

/** Whether the viewer (by the address they signed in with) is the asked family, or the asked person or one of their
 *  family's people. */
export async function ownsScope(tenantId: string, email: string | null, ask: ScopeAsk): Promise<boolean> {
  const viewer = email ? await getPersonByEmail(tenantId, email) : null
  return !!viewer && (
    (!!ask.family && viewer.familyId === ask.family) ||
    (!!ask.person && (viewer.id === ask.person ||
      (!!viewer.familyId && (await getPersonById(tenantId, ask.person))?.familyId === viewer.familyId))))
}

/** The viewer's own person and every classroom of theirs and their family's; null when they are not on the roster. */
export async function myNewsletterRooms(tenantId: string, email: string | null): Promise<{ personId: string; courseIds: string[] } | null> {
  const viewer = email ? await getPersonByEmail(tenantId, email) : null
  if (!viewer) return null
  const run = await runThreeUniverses(tenantId)
  return {
    personId: viewer.id,
    courseIds: [...(viewer.familyId ? familyCourseIds(run, viewer.familyId) ?? [] : []), ...(personCourseIds(run, viewer.id) ?? [])],
  }
}
