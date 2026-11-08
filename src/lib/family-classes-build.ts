// A family's classroom table, built from its family card with no store read (family-classes-load.ts holds the
// store reads). The roster facts the table needs beside the card come in as FamilyFacts, from the universe answers
// or read by the loader; the course names and links are the Google snapshot's.
//
// One source: the family's card from the current run, with the course names and join links the card itself shows,
// and the catalog's own `department` to put a class under Language or Culture.

import type { FamilyCard, PersonRow } from './three-universes'
import { currentAcademicYear, localDateStr } from './years'
import { yearRules } from './year-context'
import { tenantRules } from './rules-context'
import { ports } from '../ports'
import { schoolYearLabel } from './enrollment'
import type { Tenant } from './tenant'
import { schoolWord } from './school-words'
import { rosterPublicUrl } from './roster-public-url'
import { GUARDIAN_MOTHER, GUARDIAN_FATHER } from './student-address'
import { courseLabels } from './course-labels'
import type { FamilyGrid, GridColumn, GridMember } from './family-grid'

/** The roster facts the table reads beside the card: the session's first school day and each class's department. */
export type FamilyFacts ={ schoolStart: string | null; departments: Record<string, string | null> }

export function familyNameOf(card: FamilyCard): string {
  const lastNames = [...new Set(card.parents.map(p => p.lastName).filter(Boolean))]
  return lastNames.length > 0 ? `${lastNames.join(' / ')} family` : card.familyId
}

// FIRST NAMES ONLY — the email is about one family, so it needs no last
// names.
const firstName = (p: PersonRow) => p.firstName

// The school's culture department is its own column; every other department is a language class.
const columnOf = (cultureDepartment: string, department: string | null): GridColumn => (department === cultureDepartment ? 'culture' : 'language')

/** The class ids a card's projection names. */
export function cardClassIds(card: FamilyCard): string[] {
  return [...new Set(card.gapRows.flatMap(g => (g.projection?.facts ?? [])
    .flatMap(f => (f.kind === 'class' ? [f.classId] : []))))]
}

export async function gridFromCard(tenant: Tenant, card: FamilyCard, facts: FamilyFacts): Promise<FamilyGrid> {
  // The year and its first school day come from the roster calendar (the one source), today from the
  // tenant's own clock.
  const y = await yearRules(tenant.id)
  const rules = await tenantRules(tenant.id)
  const cultureDepartment = rules.courses.cultureDepartment
  const at = ports().clock.now()
  const year = currentAcademicYear(y, at)
  const schoolStart = facts.schoolStart

  const courseIds = [...new Set(card.gapRows.map(g => g.courseId.trim()))]
  const { courseName, courseLinks } = await courseLabels(tenant.id, courseIds)

  const deptOf = new Map(Object.entries(facts.departments))

  const noEmail = new Set(card.noEmail.map(n => n.participant.id))
  const collided = new Set(card.collisions.map(c => c.participant.id))

  // Every member the card names, parents first, once each.
  const people = new Map<string, PersonRow>()
  for (const p of [...card.parents, ...card.roster.persons]) if (!people.has(p.id)) people.set(p.id, p)
  const members = new Map<string, GridMember>()
  const member = (id: string): GridMember | null => {
    const p = people.get(id)
    if (!p) return null
    if (!members.has(id)) {
      members.set(id, {
        name: firstName(p),
        flag: noEmail.has(id) ? 'no-email' : collided.has(id) ? 'collision' : null,
        cells: { board: [], language: [], culture: [] },
      })
    }
    return members.get(id)!
  }

  // ROWS ARE ADDRESSES. With no email conflict, the name comes from the address; a child row is
  // misleading, as if the child were missing; with a conflict, the grid says which person has it. So a
  // class row lands on the member who OWNS its address; when that is a parent lending it to a child, the
  // row is the parent's. Members with no address, or on a shared one, keep their own
  // flagged row, since the problem is theirs.
  // And the box does NOT name the child: the parent knows who uses the address; which child it is, the family
  // already decided.
  const ownerOf = new Map<string, string>()
  for (const p of people.values()) {
    const e = (p.email ?? '').trim().toLowerCase()
    if (e && !ownerOf.has(e)) ownerOf.set(e, p.id)
  }

  // A BOX IS A GOOGLE CLASSROOM, named as Google names it, not by roster class: when two roster
  // classes share one classroom, one box stands for the one door. The roster class decides the
  // COLUMN (its department).
  const unexpected: FamilyGrid['unexpected'] = []
  for (const g of card.gapRows) {
    const courseLabel = courseName(g.courseId) ?? g.courseId
    const l = courseLinks(g.courseId)
    if (!g.projection) {
      // Someone on the school board the roster does not place there is not an item: who is on the
      // school board is not this grid's concern. meetRequired is the course labels' own mark for the
      // school board's course.
      if (!l.meetRequired) unexpected.push({ className: courseLabel, email: g.email })
      continue
    }
    for (const f of g.projection.facts) {
      const rowId = ownerOf.get(g.email.trim().toLowerCase()) ?? f.personId
      const m = member(rowId)
      if (!m) continue

      const column: GridColumn = f.kind === 'class' ? columnOf(cultureDepartment, deptOf.get(f.classId) ?? null) : 'board'
      // One box per classroom in a column: a child's grade class and the kindergarten one can share a box.
      if (m.cells[column].some(c => c.courseId === g.courseId.trim())) continue
      m.cells[column].push({
        state: g.match ? 'good' : 'join', className: courseLabel, email: g.email,
        joinUrl: g.match ? null : l.joinUrl, code: g.match ? null : l.enrollmentCode ?? null,
        classroomUrl: g.match ? l.classroomUrl : null, meetUrl: g.match ? l.meetUrl : null,
        courseId: g.courseId.trim(),
      })
    }
  }
  // A member with no address has no row in the gap at all — they still get their line.
  for (const id of [...noEmail, ...collided]) member(id)

  const order = [...people.keys()]
  const recipients = [...new Set(card.gapRows.map(g => g.email))]
  return {
    familyName: familyNameOf(card),
    members: [...members.entries()].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0])).map(([, m]) => m),
    collisions: card.collisions.map(c => ({
      name: firstName(c.participant), email: c.email,
      lender: c.participant.guardian === GUARDIAN_FATHER ? 'Father' as const : c.participant.guardian === GUARDIAN_MOTHER ? 'Mother' as const : null,
    })),
    unexpected,
    recipients,
    greetingNames: [...new Map(recipients.flatMap(r => [...people.values()]
      .filter(p => (p.email ?? '').trim().toLowerCase() === r)
      .map(p => [p.id, { first: p.firstName, last: p.lastName }] as const))).values()],
    rosterUrl: null,
    schoolName: await schoolWord(tenant.id, 'name'),
    boardName: rules.courses.schoolBoard.name,
    departmentWords: rules.courses.departmentWords,
    language: rules.locale.language,
    colour: await schoolWord(tenant.id, 'colour'),
    schoolYear: schoolYearLabel(year),
    schoolStart,
    today: localDateStr(y, at),
  }
}

/** The grid as an email carries it: with the roster's address for the sign-in line. */
export async function emailGridFromCard(tenant: Tenant, card: FamilyCard, facts: FamilyFacts): Promise<FamilyGrid> {
  return { ...await gridFromCard(tenant, card, facts), rosterUrl: await rosterPublicUrl(tenant) }
}
