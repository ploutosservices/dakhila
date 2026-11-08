// WHAT THE SEAM ANSWERS. Each takes the tenant and the address the caller signed in with — verified by the host's seam
// door and by the API's own token check; the reasoning of each field stays here, beside the code that makes it. The
// host keeps its own token check, status words and identity headers.
import { getUserFamilyId, teachesThisYear } from './roster-roles'
import { isEligibleToEnroll } from './eligible-kids'
import { resolveAddressIdentity } from './address-identity'
import { db } from './db'
import { persons } from '../tables'
import { eq, and, isNull, inArray } from 'drizzle-orm'
import { schoolYearLabel } from './enrollment'
import { academicYearOf } from './year-context'
import { runThreeUniverses } from './three-universes-load'
import { courseDisplayData } from './course-display'
import { getFamilySchedule } from './roster-classes'
import { rosterPublicUrl } from './roster-public-url'
import type { Tenant } from './tenant'
import { getTeacherCard } from './teacher-card'
import { getFamilyContext, emptyFamilyContext } from './family-context'
import { schoolHelp } from './help'
import { catalogValue } from './message-catalog'
import { loadFamilyCardForContext, courseIdsOf, buildFamilyMap } from './family-map-context'
import { getPrincipalWork } from './principal-work'
import { workspaceDomain } from './role-mailbox'
import { hostPage, now as hostNow } from './host'
import { schoolWord, helpControls, teacherHelpWords, unavailableWords } from './school-words'
import { courseRules, tenantRules } from './rules-context'

/** A seam answer: the body, or the address rule's two refusals the door words itself. */
export type SeamAnswer =
  | { kind: 'ok'; body: Record<string, unknown> }
  | { kind: 'classroom' }
  | { kind: 'unknown' }

// WHOSE ADDRESS THE SCHOOL WRITES TO for this person. The column holds 0/1/2 and a caller
// outside the roster has no way to know that 2 means the father.
// The number rides along as `guardian` because it is the stored fact, and the word is what
// a caller can print. An unknown value is reported as the number it is, never coerced into
// one of the three words.
function guardianLabel(guardian: number | null): string | null {
  if (guardian === null) return null
  if (guardian === 0) return 'own'
  if (guardian === 1) return 'mother'
  if (guardian === 2) return 'father'
  return String(guardian)
}

// THE SCHEDULE, ON THE FAMILY CARD. One answer says both which Google classroom each person is
// expected in and when the class meets, so a caller needs nothing else to tell a parent.
//
// ON THE PERSON, not in a list beside them: each person in the family is shown among the
// participants, with their classes inline. A second person-keyed list would make a caller join
// lists to describe one human; a person with no classes carries an empty list, which is a fact
// about them rather than an absence from a list.
function joinUrl(meet: string | null, classroomCourseId: string | null): string | null {
  if (meet) return `https://meet.google.com/${meet}`
  if (classroomCourseId) return `https://classroom.google.com/c/${classroomCourseId}`
  return null
}

type ScheduleStudent = {
  personId: string
  name: string
  classes: {
    classId: string
    shortCode: string | null
    fullName: string | null
    section: string | null
    startTime: string | null
    endTime: string | null
    meet: string | null
    classroomCourseId: string | null
    joinUrl: string | null
  }[]
}

// personId -> that person's classes, so participants[] can carry them inline.
async function classesByPerson(tenantId: string, familyId: string, year: number): Promise<Map<string, ScheduleStudent['classes']>> {
  const family = await getFamilySchedule(tenantId, familyId, year)
  return new Map(family.map(s => [s.personId, s.classes.map(c => ({
      classId: c.classId,
      shortCode: c.shortCode,
      fullName: c.fullName,
      section: c.section,
      startTime: c.startTime,
      endTime: c.endTime,
      meet: c.meet,
      classroomCourseId: c.classroomCourseId,
      joinUrl: joinUrl(c.meet, c.classroomCourseId),
    }))]))
}

/**
 * THE FAMILY CARD: the three-universes run's family card, full detail, plus each participant's family details.
 * NO dates of birth. ONE SOURCE: the answer adds to the run's card and reads nothing else independently. No id parameter in any
 * mode — a caller can never ask for another family.
 */
export async function familyCardAnswer(tenant: Tenant, email: string): Promise<SeamAnswer> {
  // The roster's address for THIS environment, from the tenant record. AWAITED: without it every caller would get
  // `rosterUrl: {}` and a familyDetailsUrl beginning "[object Promise]".
  const ROSTER_URL = await rosterPublicUrl(tenant)

  // THE ADDRESS RULE. A primary address is the only one that signs in; a
  // classroom address is recognised and refused with a message naming which address to use.
  // Anything else falls through to the family:false intake signal below, unchanged.
  const who = await resolveAddressIdentity(tenant.id, email)
  if (who.kind === 'classroom') return { kind: 'classroom' }

  const year = await academicYearOf(tenant.id)
  const schoolYear = schoolYearLabel(year)
  const familyId = await getUserFamilyId(email, tenant.id)

  // Not a member: same key set, empty everything — the intake signal, never
  // somebody else's rows.
  if (!familyId) {
    return { kind: 'ok', body: {
      family: false,
      year, schoolYear,
      runAccepted: null,
      participants: [],
      card: null,
      rosterUrl: ROSTER_URL,
    } }
  }

  // Family details for the participants — whole family, NO dates of birth
  // (an explicit exclusion). Source: the persons table, the same rows
  // the family surface shows.
  const familyPersons = await db
    .select({ id: persons.id, firstName: persons.firstName, lastName: persons.lastName, role: persons.role, email: persons.email, phone: persons.phone, guardian: persons.guardian, firstGradeYear: persons.firstGradeYear })
    .from(persons)
    .where(and(eq(persons.tenantId, tenant.id), eq(persons.familyId, familyId), isNull(persons.deletedAt)))

  // The schedule is roster's own data and owes the map run nothing, so it is read before
  // the gate and still serves when the run is refused — a family can be told when its
  // classes meet even on a day the map cannot be computed.
  const classesFor = await classesByPerson(tenant.id, familyId, year)

  // ONLY ELIGIBLE KIDS LEAVE THIS DOOR: the caller is given details of eligible kids
  // only. One rule, lib/eligible-kids.ts — the same
  // one the invitation and the tracker's column read — against THIS card's school year.
  // Adults are not kids and are never filtered. Children past the last grade, children with no first-grade year and
  // children too young are not handed to the caller.
  const { grades } = await courseRules(tenant.id)
  const publish = (p: { role: string | null; firstGradeYear: number | null }) =>
    (p.role !== 'boy' && p.role !== 'girl') || isEligibleToEnroll(p, year, grades)

  const run = await runThreeUniverses(tenant.id)
  if (!run.accepted) {
    // The gate refused the run — an honest state, not an error: family details
    // still serve; the card does not exist for anyone right now.
    return { kind: 'ok', body: {
      family: true,
      year, schoolYear,
      runAccepted: false,
      participants: familyPersons.filter(publish).map(p => ({
        ...p,
        name: [p.firstName, p.lastName].filter(Boolean).join(' '),
        guardianLabel: guardianLabel(p.guardian),
        classes: classesFor.get(p.id) ?? [],
      })),
      card: null,
      rosterUrl: ROSTER_URL,
      familyDetailsUrl: `${ROSTER_URL}${hostPage('family-edit', familyId)}`,
    } }
  }

  const card = run.familyCards.find(c => c.familyId === familyId) ?? null

  // Parents can live outside the family's own person rows — include them.
  const parentIds = (card?.parents ?? []).map(p => p.id).filter(id => !familyPersons.some(fp => fp.id === id))
  const extraParents = parentIds.length > 0
    ? await db
        .select({ id: persons.id, firstName: persons.firstName, lastName: persons.lastName, role: persons.role, email: persons.email, phone: persons.phone, guardian: persons.guardian, firstGradeYear: persons.firstGradeYear })
        .from(persons)
        .where(inArray(persons.id, parentIds))
    : []
  const participants = [...familyPersons, ...extraParents].filter(publish).map(p => ({
    id: p.id,
    name: [p.firstName, p.lastName].filter(Boolean).join(' '),
    firstName: p.firstName,
    lastName: p.lastName,
    role: p.role,
    email: p.email,
    phone: p.phone,
    guardian: p.guardian,
    guardianLabel: guardianLabel(p.guardian),
    // Empty for a parent who teaches nothing and for anyone not in a class this year.
    classes: classesFor.get(p.id) ?? [],
  }))

  // WHO THE ROW IS ABOUT, from the run's own source facts. A gap row's KEY is (courseId,
  // email, role), and every SourceFact on it carries the participant's personId, published
  // here so no caller re-derives the person from the address. Google-only rows have no
  // projection and therefore no facts; they get an empty list, never a guess.
  const nameOf = new Map(participants.map(p => [p.id, p.name]))
  // The eligibility filter reaches the CARD too, not just participants[]: a row, a collision
  // or a missing-address note about an alumnus would name somebody the caller was not given.
  const published = new Set(participants.map(p => p.id))

  let cardJson: unknown = null
  if (card) {
    const courseIds = [...new Set(card.gapRows.map(g => g.courseId.trim()))]
    const { courseName, courseLinks, courseClasses } = await courseDisplayData(tenant.id, courseIds)
    cardJson = {
      familyId: card.familyId,
      parents: card.parents.map(p => p.id),
      // A mapped family: one with a gap row derived from the roster (a projection).
      mapped: card.gapRows.some(g => g.projection),
      rows: card.gapRows.map(g => {
        const l = courseLinks(g.courseId)
        return {
          courseId: g.courseId.trim(),
          courseName: courseName(g.courseId),
          // WHEN IT MEETS, ON THE ROW. A row that says which classroom a person belongs in
          // and not what time it starts makes the caller join a second list to say anything
          // useful to a parent. An array because a combined Google course carries several
          // roster classes ("X6 X7 X9") and taking the first would drop the rest.
          classes: courseClasses(g.courseId),
          participants: [...new Map((g.projection?.facts ?? [])
            .filter(f => published.has(f.personId))
            .map(f => [f.personId, { personId: f.personId, name: nameOf.get(f.personId) ?? null }]))
            .values()],
          email: g.email,
          role: g.role,
          match: g.match,                              // in Google AND expected
          expected: !!g.projection,                    // the roster expects this row
          inGoogle: !!g.snapshot,
          classroomUrl: l.classroomUrl,
          joinUrl: g.match ? null : l.joinUrl,
          enrollmentCode: g.match ? null : l.enrollmentCode ?? null,
          meetUrl: l.meetUrl,
          meetRequired: l.meetRequired ?? false,
        }
      }),
      // Named, not bare ids: a caller cannot tell a parent "one of your people has no
      // address" and mean anything by it.
      collisions: card.collisions.filter(c => published.has(c.participant.id)).map(c => ({ personId: c.participant.id, name: nameOf.get(c.participant.id) ?? null, contestedEmail: c.email })),
      noEmail: card.noEmail.filter(n => published.has(n.participant.id)).map(n => ({ personId: n.participant.id, name: nameOf.get(n.participant.id) ?? null })),
      allGood: card.gapRows.length > 0 && card.gapRows.every(g => g.match) && card.noEmail.length === 0 && card.collisions.length === 0,
    }
  }

  return { kind: 'ok', body: {
    family: true,
    year, schoolYear,
    runAccepted: true,
    participants,
    card: cardJson,
    rosterUrl: ROSTER_URL,
    familyDetailsUrl: `${ROSTER_URL}${hostPage('family-edit', familyId)}`,
  } }
}

/**
 * THE TEACHER CARD — the family card's counterpart, for the person who teaches. The person is resolved
 * from the verified address; a caller can never ask for another teacher's classes. NOBODY HERE holds an unknown
 * address — an address that does not match is answered "no such account." Distinct
 * from a person who IS here and teaches nothing, which is `teacher: false` with an empty list.
 */
export async function teacherCardAnswer(tenant: Tenant, email: string): Promise<SeamAnswer> {
  const ROSTER_URL = await rosterPublicUrl(tenant)
  const who = await resolveAddressIdentity(tenant.id, email)
  if (who.kind === 'classroom') return { kind: 'classroom' }
  if (who.kind === 'unknown') return { kind: 'unknown' }

  const year = await academicYearOf(tenant.id)
  const schoolYear = schoolYearLabel(year)
  const card = await getTeacherCard(tenant.id, who.personId, year, ROSTER_URL)
  return { kind: 'ok', body: {
    teacher: card.teacher,
    personId: who.personId,
    name: who.name,
    classroomEmail: card.classroomEmail,
    year, schoolYear,
    runAccepted: card.runAccepted,
    classrooms: card.classrooms,
    rosterUrl: ROSTER_URL,
  } }
}

/**
 * THE CHATBOT'S CONTEXT: everything roster will tell a signed-in family about ITSELF, de-identified, small
 * enough to sit in a model prompt — no names, dates of birth or ages. `mayManageRoster` is the caller's roster.write,
 * asked by whoever calls this.
 */
export async function familyContextAnswer(tenant: Tenant, email: string, mayManageRoster: boolean): Promise<Record<string, unknown>> {
  const now = hostNow()
  const year = await academicYearOf(tenant.id)

  // The help text, scoped to the person the verified token names. Family help always —
  // someone with no family record needs it MORE, not less. Teacher help only if this
  // address actually teaches a class this year, which is a fact the roster holds and the
  // caller never asserts.
  const [admissionEmail, teaches] = await Promise.all([
    catalogValue(tenant.id, 'admissions-contact'),
    teachesThisYear(email, tenant.id),
  ])
  const rules = await tenantRules(tenant.id)
  const help = schoolHelp({
    admissionEmail, domain: await workspaceDomain(tenant.id), schoolName: await schoolWord(tenant.id, 'name'),
    courses: rules.courses, paymentWays: rules.fees.ways.map(w => w.name),
    donationStatus: await schoolWord(tenant.id, 'donation-status'),
    placementBasis: await schoolWord(tenant.id, 'placement-basis'), receiptName: await schoolWord(tenant.id, 'receipt-name'),
    controls: await helpControls(tenant.id), teacherWords: await teacherHelpWords(tenant.id), teaches,
  })

  // THE PRINCIPAL TIER: a principal can ask what their pending work is.
  // A caller who may not write the roster gets null, and null is the whole of the difference:
  // the work is never computed, so it cannot leak out of a prompt that was never given it.
  const principalWork = mayManageRoster ? await getPrincipalWork(tenant.id) : null

  const [person] = await db
    .select({ id: persons.id, familyId: persons.familyId })
    .from(persons)
    .where(and(
      eq(persons.email, email),
      eq(persons.tenantId, tenant.id),
      isNull(persons.deletedAt),
    ))
    .limit(1)

  // The intake signal — same shape as a real answer, so the caller parses one contract.
  // A principal with no family of their own still gets their work: the two are unrelated
  // facts about the same person, and the commonest principal is exactly that person.
  if (!person?.familyId) return { ...emptyFamilyContext(year, now, await unavailableWords(tenant.id), help), principalWork }

  // The family's own view of the family map — the answer to "am I in my classroom yet"
  // for THIS family. A refused run yields null and nothing is invented in its place.
  const card = await loadFamilyCardForContext(tenant.id, person.familyId)
  const map = card
    ? buildFamilyMap(card, year, await courseDisplayData(tenant.id, courseIdsOf(card)), await workspaceDomain(tenant.id))
    : null

  return { ...(await getFamilyContext(tenant.id, person.familyId, year, now, help, map)), principalWork }
}
