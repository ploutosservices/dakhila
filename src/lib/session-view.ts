// One family's standing in one session — the SESSION universe, not the family one.
//
// The model: the family is
// permanent and manages itself; the classroom universe lives for one session,
// one school year, and at the end hands the evaluation back and disappears. So a
// classroom, a Meet link and a join are attributes of a family IN A SESSION —
// never attributes of the family.
//
// Two states and no third: "all good", or the gaps for this session. The
// principal reads the whole board; a family reads its own rows. Same truth,
// different scope — which is why this filters `getBoard()` rather than asking
// its own questions. A second computation of "what is missing" would drift from
// the first, and the family would be told something the principal cannot see.
//
// A READER IS POINTED AT A GAP; THE ROSTER NEVER BRIDGES ONE. Every gap here names who can
// close it, because two of the three cannot be closed by the roster at all: an address
// is a fact only the family holds, and joining is an act only the person holding
// that address can perform.

import { getBoard, type MoveKind } from './classroom-board'
import { runThreeUniverses } from './three-universes-load'
import { schoolYearLabel } from './enrollment'
import { db } from './db'
import { sql } from 'drizzle-orm'
import { ports } from '../ports'
import { hostPage } from './host'

/** Who has to act: the family or the school, never the roster itself. */
export type GapOwner = 'family' | 'school'

/**
 * Missing information calls for a reminder to provide it; a missing join calls
 * for "please join".
 *
 * So an address is a RESOURCE with exactly one holder, and binding it to a person
 * is an ALLOCATION. The state is `unallocated` — this person must be in a
 * classroom and no address is allocated to them — and `absent` (nothing was
 * supplied) is the reason under it.
 *
 * Teacher roles use school-issued addresses only, so a teaching parent's personal
 * address is free to lend and teaching consumes no address.
 */
export type GapReason = 'absent'

export type SessionGap = {
  kind: MoveKind
  /** Only set for an unallocated address — it picks the sentence, not the state. */
  reason?: GapReason
  /** The person or class the gap is about. */
  subject: string
  /** The class this concerns, or the classes when one fact spans several. */
  shortCode: string
  shortCodes: string[]
  /** What is wrong, in the family's language — not the principal's. */
  detail: string
  owner: GapOwner
  /** Where the family goes to close it, when they can. Roster-relative. */
  href?: string
  /**
   * The one-click join link for the classroom this gap is about — absolute, and
   * Google's, so it is NOT prefixed with the roster URL like `href` is.
   *
   * In the family view, a classroom that needs to be joined shows its join
   * link. Only ever set on an `email-join` gap, and only when Google
   * has published an enrolment code for that course: without one the bare course
   * URL asks a person to sign in and then tells them they are not a member.
   */
  joinUrl?: string
}

export type SessionClass = {
  classId: string
  shortCode: string
  section: string | null
  studentName: string
  /** Null until the school creates the classroom. */
  classroomUrl: string | null
  meetUrl: string | null
  /** One-click join for this class, when Google has published a code. */
  joinUrl: string | null
}

export type SessionView = {
  year: number
  schoolYear: string
  /** True when this family has nothing outstanding in this session. */
  allGood: boolean
  classes: SessionClass[]
  gaps: SessionGap[]
  /** How stale the Google snapshot is — a join made minutes ago may not show yet. */
  lastSynced: string | null
}

/**
 * The gaps, in the family's words. The board states them for a principal ("EMAIL
 * the family of X asking for an address"); a family needs to read what is true
 * about their own people and what they can do about it.
 */
function describe(
  kind: MoveKind,
  subject: string,
  familyEditHref: string,
): { detail: string; owner: GapOwner; href?: string } | null {
  switch (kind) {
    case 'email-parents':
      return {
        detail: `${subject} has no email address, so there is no way to send them their classroom. You can add one — a parent's own address is fine if they do not have one yet.`,
        owner: 'family',
        href: familyEditHref,
      }
    case 'email-join':
      return {
        detail: `${subject} has not joined their classroom yet. They join it themselves — we are not able to add anyone.`,
        owner: 'family',
        href: hostPage('join-school-board'),
      }
    case 'create-classroom':
      return { detail: `The classroom for ${subject} has not been created yet. The school does this.`, owner: 'school' }
    case 'create-account':
      return { detail: `${subject} is teaching this class and does not have a school account yet. The school does this.`, owner: 'school' }
    case 'no-meet':
      return { detail: `${subject} has no Meet link yet. The school does this.`, owner: 'school' }
    // Not a family's business: corrections to the classroom roll that the school
    // makes, and showing them would ask a family to worry about bookkeeping it
    // cannot act on.
    case 'add-teacher':
    case 'remove-teacher':
    case 'remove-student':
    case 'email-teacher':
    // A board's membership is about teachers, never a family.
    case 'add-to-board':
    case 'board-not-synced':
      return null
  }
}

export async function getSessionView(tenantId: string, familyId: string, year: number): Promise<SessionView> {
  const board = await getBoard(tenantId, year, await runThreeUniverses(tenantId))

  const mine = (await db.execute(sql`
    select p.id, trim(coalesce(p.first_name,'') || ' ' || coalesce(p.last_name,'')) as name
    from persons p
    where p.family_id = ${familyId} and p.tenant_id = ${tenantId} and p.deleted_at is null
  `)).rows as Array<{ id: string; name: string }>
  const mineIds = new Set(mine.map(m => m.id))

  // The classes this family's students are actually in, this session.
  const rosterRows = (await db.execute(sql`
    select c.id as "classId", cc.short_code as "shortCode", c.section,
           trim(coalesce(p.first_name,'') || ' ' || coalesce(p.last_name,'')) as "studentName",
           c.classroom_course_id as "courseId"
    from roster_enrollments e
    join persons p on p.id = e.student_id and p.deleted_at is null
    join roster_available_classes c on c.id = e.class_id
    join roster_course_catalog cc on cc.id = c.course_id
    where e.tenant_id = ${tenantId} and p.family_id = ${familyId}
      and c.year = ${year} and e.dropped_out_at is null and e.deleted_at is null
    order by p.first_name, cc.short_code
  `)).rows as Array<{ classId: string; shortCode: string; section: string | null; studentName: string; courseId: string | null }>
  // Each class's Meet link, class code and course link, as the host's Classroom mirror holds them.
  const courseIds = [...new Set(rosterRows.map(r => r.courseId).filter((id): id is string => !!id))]
  const courseOf = new Map((await ports().classroom.courses(courseIds)).map(c => [c.id, c]))
  const classRows = rosterRows.map(r => {
    const c = r.courseId ? courseOf.get(r.courseId) : undefined
    return { ...r, meet: c?.meet ?? null, enrollmentCode: c?.enrollmentCode ?? null, alternateLink: c?.alternateLink ?? null }
  })

  // Composed exactly once, by the same rule as classroomLinks(): the course URL
  // plus `?cjc=<code>` is what turns "look at this class" into "join it".
  const joinLink = (r: { enrollmentCode: string | null; alternateLink: string | null }) => {
    const code = r.enrollmentCode?.trim()
    return r.alternateLink && code ? `${r.alternateLink}?cjc=${code}` : null
  }

  const classes: SessionClass[] = classRows.map(r => ({
    classId: r.classId,
    shortCode: r.shortCode,
    section: r.section,
    studentName: r.studentName,
    classroomUrl: r.courseId ? `https://classroom.google.com/c/${r.courseId}` : null,
    meetUrl: r.meet?.trim() ? `https://meet.google.com/${r.meet.trim()}` : null,
    joinUrl: joinLink(r),
  }))

  // The join link for a class, by classId — attached to an email-join gap so the
  // family can act from the row rather than being sent to a help page to find it.
  const joinByClass = new Map(classRows.map(r => [r.classId, joinLink(r)]))

  const myClassIds = new Set(classRows.map(r => r.classId))
  const familyEditHref = hostPage('family-edit', familyId)

  // A move is this family's when it names one of their people, OR when it is a
  // class-level gap on a class one of their students is in — a classroom that
  // does not exist yet is the family's problem too, even though only the school
  // can fix it. Saying so is the point: they learn it is known and whose it is.
  const gaps: SessionGap[] = []
  for (const mv of board.moves) {
    const isMine = (mv.personId && mineIds.has(mv.personId)) || (!mv.personId && myClassIds.has(mv.classId))
    if (!isMine) continue
    const alloc: { reason: GapReason } | undefined =
      mv.kind === 'email-parents' ? { reason: 'absent' } : undefined
    const d = describe(mv.kind, mv.subject, familyEditHref)
    if (!d) continue
    const joinUrl = mv.kind === 'email-join' ? (joinByClass.get(mv.classId) ?? undefined) : undefined
    gaps.push({
      kind: mv.kind, subject: mv.subject, shortCode: mv.shortCode, shortCodes: [mv.shortCode],
      ...alloc, ...d, ...(joinUrl ? { joinUrl } : {}),
    })
  }

  // ONE FACT, ONE ROW. The board is per-class because each classroom is its own
  // move for the principal; a family reads a person. "Child A has no address" is one
  // fact whether they are in one class or four, and repeating it four times reads as
  // four problems. The classes are kept on the row instead.
  const merged: SessionGap[] = []
  const byFact = new Map<string, SessionGap>()
  for (const g of gaps) {
    // Person-level gaps merge; class-level ones (a classroom that does not exist)
    // are genuinely one per class and must not.
    const perPerson = g.kind === 'email-parents' || g.kind === 'email-join'
    if (!perPerson) { merged.push(g); continue }
    const key = `${g.kind}:${g.subject}`
    const seen = byFact.get(key)
    if (seen) { seen.shortCodes.push(g.shortCode); continue }
    byFact.set(key, g)
    merged.push(g)
  }
  for (const g of merged) g.shortCodes = [...new Set(g.shortCodes)]

  // Family gaps first — those are the ones the reader can do something about.
  merged.sort((a, b) => (a.owner === b.owner ? 0 : a.owner === 'family' ? -1 : 1))

  return {
    year,
    schoolYear: schoolYearLabel(year),
    allGood: merged.length === 0,
    classes,
    gaps: merged,
    lastSynced: board.lastSynced,
  }
}
