// THE FAMILY'S OWN VIEW OF THE FAMILY MAP — served to BOTH seam answers: the
// family-card and the family-context.
//
// The map is the three-universes run: for each of a
// family's people, which Google Classroom the roster expects their address in, and whether
// Google already has them there. It is the one thing that answers "how do I get into my
// classroom" for a REAL person rather than in general — "you are all set" or "this one is
// still to join, here is the link", which is exactly what the family's classroom mail says in
// words and what the family card carries.
//
// ONE RUN, THREE PRESENTATIONS. The card, the email and this all read `FamilyCard` off the
// same `runThreeUniverses` result. Nothing here recomputes a match, decides a precedence or
// fills a gap — if the run did not say it, it is not here.
//
// NAMES YES, ADDRESSES NO. A row that names nobody — "someone in your family is not in this
// classroom" — is not an answer a parent can act on. The token gives the address, the address
// gives the person, the person gives the family, the family gives the map. The reader is the
// family, signed in, reading about its own people, and the family's map mail carries the same
// rows to the same parents. So the name is not a disclosure; the address is the part that stays
// behind, because the chatbot copy of this lands in a model's context window where an address is
// a liability and a first name is not. `personKey` stays alongside so two people who share a
// first name cannot merge.
//
// COST: runThreeUniverses is a whole-tenant run per request. It is the price of not keeping a
// second, drifting copy of the answer.

// The course-name and join-link lookup is injected by the caller, which keeps this module's imports
// free of the caller's and makes buildFamilyMap a pure function with no store behind it.
import type { FamilyCard } from './three-universes'
import { runThreeUniverses } from './three-universes-load'
import { teacherClassroomAddress } from './teacher-classroom-address'

// The map row a family may be told about itself. `personKey` is a person UUID — opaque,
// stable, carries no personal data; it lines up with `students[].key` in the same payload.
export type FamilyMapRow = {
  className: string
  personKey: string | null      // null when the run's address matches nobody in the family
  // WHO THE ROW IS ABOUT, in words: the name is the point, not a disclosure. The ADDRESS does
  // not travel; see the header.
  personName: string | null
  role: string
  // When the class actually meets. An array because a combined Google course carries more
  // than one roster class; empty when the course has no roster class behind it at all.
  classes: { classId: string; shortCode: string | null; section: string | null; startTime: string | null; endTime: string | null }[]
  matched: boolean              // Google already has them in that classroom
  joinUrl: string | null        // the ?cjc link, when the course publishes one
  enrollmentCode: string | null // spoken as the fallback when there is no link
}

export type FamilyMap = {
  year: number
  // `allSet` is stated outright rather than left to be derived from empty arrays, because
  // "nothing to do" and "we have no data for you" must not look identical in a prompt.
  allSet: boolean
  rows: FamilyMapRow[]
  // Family members the roster holds no address for at all — they cannot be in any classroom
  // until that is fixed, which is a different sentence from "not joined yet". Named, for the
  // same reason the rows are: "someone has no address" is not something a parent can act on.
  noAddress: { personKey: string; personName: string | null }[]
}

// A refused run carries ONLY its rejections — no projection, no gaps, no cards — and that is
// correct behaviour, not a failure. The chatbot is told nothing rather
// than told a stale or invented answer, so null here means "no answer", never "all set".
export async function loadFamilyCardForContext(
  tenantId: string,
  familyId: string,
): Promise<FamilyCard | null> {
  const run = await runThreeUniverses(tenantId)
  if (!run.accepted) return null
  return run.familyCards.find(c => c.familyId === familyId) ?? null
}

// The course ids a family's rows name, deduplicated — what the caller hands to its
// course-display lookup before calling buildFamilyMap.
export function courseIdsOf(card: FamilyCard): string[] {
  return [...new Set(card.gapRows.map(g => g.courseId.trim()))]
}

// Pure, so the shaping is testable without a database or a run.
export function buildFamilyMap(
  card: FamilyCard,
  year: number,
  // Structurally typed, not imported: the caller's lookup may leave enrollmentCode out, and
  // accepting the wider shape keeps this module free of the caller's imports.
  display: {
    courseName: (id: string) => string | null
    courseLinks: (id: string) => { joinUrl: string | null; enrollmentCode?: string | null }
    courseClasses: (id: string) => { classId: string; shortCode: string | null; section: string | null; startTime: string | null; endTime: string | null }[]
  },
  /** The tenant's directory domain — the tenant value `workspace-domain`. */
  domain: string,
): FamilyMap {
  // Address -> person, within THIS family only. The run keys a gap row by the address it
  // expects; the payload may not carry that address, so it is resolved to the person here
  // and dropped. Compared the way the roster compares addresses elsewhere: trimmed, lowered.
  const byAddress = new Map<string, { id: string; name: string | null }>()
  for (const p of [...card.roster.persons, ...card.parents]) {
    const name = [p.firstName, p.lastName].filter(Boolean).join(' ').trim() || null
    const personal = (p.email ?? '').trim().toLowerCase()
    for (const a of [personal || null, teacherClassroomAddress(p, domain)]) {
      if (a) byAddress.set(a, { id: p.id, name })
    }
  }

  const byId = new Map<string, string | null>()
  for (const p of [...card.roster.persons, ...card.parents]) {
    byId.set(p.id, [p.firstName, p.lastName].filter(Boolean).join(' ').trim() || null)
  }

  const rows: FamilyMapRow[] = card.gapRows.map(g => {
    const links = display.courseLinks(g.courseId)
    // THE SOURCE FACT FIRST, the address second. The run already names the person on the
    // roster side of the row (SourceFact.personId); resolving the address is the fallback
    // for a Google-only row, which has no projection and therefore no fact.
    const fact = g.projection?.facts?.[0]
    const who = fact
      ? { id: fact.personId, name: byId.get(fact.personId) ?? null }
      : byAddress.get(g.email.trim().toLowerCase()) ?? null
    return {
      className: display.courseName(g.courseId) ?? g.courseId,
      personKey: who?.id ?? null,
      personName: who?.name ?? null,
      role: g.role,
      classes: display.courseClasses(g.courseId),
      matched: g.match,
      // A join link on a row that already matched is noise at best and a wrong instruction
      // at worst — the email builder drops it for the same reason.
      joinUrl: g.match ? null : links.joinUrl,
      enrollmentCode: g.match ? null : links.enrollmentCode ?? null,
    }
  })

  const noAddress = card.noEmail.map(n => ({
    personKey: n.participant.id,
    personName: [n.participant.firstName, n.participant.lastName].filter(Boolean).join(' ').trim() || null,
  }))

  return {
    year,
    allSet: rows.every(r => r.matched) && noAddress.length === 0,
    rows,
    noAddress,
  }
}
