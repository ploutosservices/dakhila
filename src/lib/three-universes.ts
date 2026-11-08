// The three universes — the per-tenant, per-session RUN.
//
// This file implements the run's rules: the gate (which rows may enter), the normalization, the checks (3), (4) and
// (5) that take a person out of the email mapping, the numbered sections of the answer a row falls into when it cannot
// be mapped, and the family derivation.
//
// PURE READER. The run reads two datasets and returns one result object.
// It writes nothing, anywhere.
//
// Structure: computeRun() is the pure core over plain data (unit-testable
// without a DB); runThreeUniverses() (three-universes-load.ts) loads the tenant's rows and calls it.

import { resolveStudentAddress } from './student-address'
import { teacherClassroomAddress } from './teacher-classroom-address'
import { byCode, byName } from './zoned'

// ---------------------------------------------------------------------------
// Normalization — ONE normalization wherever the run compares text:
// Unicode trim (String.prototype.trim) on every compared text; the lower-case
// fold (String.prototype.toLowerCase — no locale) on the email ALONE.
// Stored bytes display as they stand; keys, lookups and predicates compare
// normalized. courseId and role compare case-exactly after trim.
// ---------------------------------------------------------------------------

// The presence predicate, the address normalization, the named checks and the participants are three-universes-words.ts
// (pure), imported here and re-exported for this file's importers.
import { CHECK, isMissing, normEmail, participants } from './three-universes-words'
export { CHECK, isMissing, normEmail, participants }

// The canonical clock-time form: 24-hour zero-padded HH:MM, HH 00-23,
// MM 00-59. Under it textual order is clock order.
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

// ---------------------------------------------------------------------------
// Input rows — plain data, as read.
// ---------------------------------------------------------------------------

export type ClassRow = {
  id: string
  year: number
  shortCode: string | null      // catalog join; null for a course-less class
  // The class's department — the catalog's word for the group of people who could teach it, and
  // what the department roster is keyed on. Null for a course-less class.
  department: string | null
  section: string | null
  startTime: string | null
  endTime: string | null
  classroomCourseId: string | null   // "classroomId" — the Google id, NEVER the catalog FK
}

export type TeacherAssignmentRow = { id: string; classId: string; personId: string }
export type StudentAssignmentRow = { id: string; classId: string; studentId: string }
export type EnrollmentRow = { id: string; familyId: string; status: string }
export type KidRow = { id: string; enrollmentId: string; studentId: string }
export type FamilyRow = { id: string; motherId: string | null; fatherId: string | null }

export type PersonRow = {
  id: string
  firstName: string
  lastName: string | null
  email: string | null
  classroomEmail: string | null
  guardian: number | null
  familyId: string | null
}

export type BoardRow = { id: string; name: string; googleCourseId: string | null }

/** A snapshot row — the tenant's classroom_members: courseId, role, email.
 *  Nothing else is snapshot data; rowKey is an opaque render key, never compared. */
export type SnapshotRow = {
  rowKey: string
  courseId: string | null
  role: string | null
  email: string | null
}

export type RunInput = {
  year: number
  /** Current-session roster_available_classes of the tenant. */
  classes: ClassRow[]
  /** roster_teachers rows on those classes (live by construction — no marker column). */
  teacherAssignments: TeacherAssignmentRow[]
  /** Live roster_enrollments rows on those classes (dropped_out_at/deleted_at NULL). */
  studentAssignments: StudentAssignmentRow[]
  /** Current-session family_enrollments, any status — the core keeps the
   *  enrolled ones (status trimmed = 'enrolled', case-exact). */
  enrollments: EnrollmentRow[]
  /** Live family_enrollment_students rows (dropped_out_at NULL) of those enrollments. */
  enrollmentKids: KidRow[]
  /** The tenant's roster_families — the tenant-scoped resolution set. */
  tenantFamilies: FamilyRow[]
  /** The tenant's LIVE persons — resolution set and the family-lookup search set. */
  tenantPersons: PersonRow[]
  /** The school's board (SchoolRules.courses.schoolBoard), if the host holds one. */
  board: BoardRow | null
  /** The snapshot as given — the run reads ALL of it, no selection of its own. */
  snapshot: SnapshotRow[]
  /** The tenant's directory domain — the tenant value `workspace-domain`. */
  domain: string
  /** The school's language (SchoolRules.locale.language): family cards sort by its collation. */
  language: string
}

// ---------------------------------------------------------------------------
// Result shapes.
// ---------------------------------------------------------------------------

/** Cliff conditions in force — the enumerated list, nothing improvised. (One class cannot appear in two groups:
 *  each class row is grouped once, so that case has no condition.) */
export const CLIFF = {
  mixedIds: 'two different classroomIds in one (teacher set, start, end) group',
  personTwoIds: 'one person, same time, two different classroomIds',
} as const

/** A gate refusal: the violating row as read + the named check; relational
 *  violations carry their co-violating rows — half a difficulty cannot be worked. */
export type RejectionRecord = {
  check: string
  description: string
  row: unknown
  coRows?: unknown[]
}

export type SourceFact =
  | { kind: 'class'; classId: string; personId: string; role: 'Teacher' | 'Student' }
  | { kind: 'board-parent'; personId: string; familyId: string }
  | { kind: 'board-kid'; personId: string }
  | { kind: 'board-teacher'; personId: string }

/** A projection row: its key plus its source facts, ALL of them, as a list —
 *  one key held once carries every fact that stated it. */
export type ProjectionRow = {
  courseId: string               // trimmed; case preserved
  email: string                  // normalized (trim + lower)
  role: 'Teacher' | 'Student'
  facts: SourceFact[]
}

export type GapRow = {
  courseId: string
  email: string
  role: string
  projection: ProjectionRow | null
  snapshot: SnapshotRow | null
  match: boolean                 // derived from the presence of both references, nothing else
  familyId: string | null        // role-directed lookup from the email; null = whole-view only
}

export type CliffCondition = { name: string; description: string; coRows: unknown[] }

export type Section2Row = { class: ClassRow }
export type Section3Row = { teacher: PersonRow }
export type Section4Row = { participant: PersonRow; email: string; familyId: string | null }
export type Section5Row = { participant: PersonRow; familyId: string | null }
export type Section6Row = { class: ClassRow; conditions: CliffCondition[] }
export type Section7Row = { teachers: PersonRow[]; start: string; end: string; classes: ClassRow[] }

/** The roster facts the run read — the same principle that bounds the gate's domain. */
export type RosterPicture = {
  classes: ClassRow[]
  teacherAssignments: TeacherAssignmentRow[]
  studentAssignments: StudentAssignmentRow[]
  enrollments: EnrollmentRow[]           // the enrolled ones — the rows the run reads
  enrollmentKids: KidRow[]
  families: FamilyRow[]                  // the enrolled families' rows
  persons: PersonRow[]                   // the persons any of these name
  board: BoardRow | null
}

export type FamilyCardRoster = {
  enrollments: EnrollmentRow[]
  kids: KidRow[]
  persons: PersonRow[]
  teacherAssignments: TeacherAssignmentRow[]
  studentAssignments: StudentAssignmentRow[]
  classes: ClassRow[]                    // named by the family's own assignment rows
}

export type FamilyCard = {
  familyId: string
  family: FamilyRow
  parents: PersonRow[]
  gapRows: GapRow[]                      // Match and Break alike
  collisions: Section4Row[]
  noEmail: Section5Row[]
  roster: FamilyCardRoster
  snapshotRows: SnapshotRow[]
}

/** One result object shape, two outcomes that never mix: a refused run carries
 *  ONLY the rejections; an accepted run carries the full result, rejections
 *  empty by construction. */
export type RunResult =
  | { accepted: false; year: number; rejections: RejectionRecord[] }
  | {
      accepted: true
      year: number
      rejections: []
      gap: GapRow[]                      // (1)
      /** Whose address each student participant is shown by — see the emission rule. */
      addressSource: Map<string, 'own' | 'mother' | 'father' | 'none'>
      noTeachers: Section2Row[]          // (2)
      noClassroomEmail: Section3Row[]    // (3)
      collisions: Section4Row[]          // (4)
      noEmail: Section5Row[]             // (5)
      dataErrors: Section6Row[]          // (6)
      pendingClassrooms: Section7Row[]   // (7)
      roster: RosterPicture
      projection: ProjectionRow[]
      snapshot: SnapshotRow[]
      familyCards: FamilyCard[]
    }

// ---------------------------------------------------------------------------
// The pure core.
// ---------------------------------------------------------------------------

// NUL cannot occur in a trimmed stored value, so keys never collide on it.
const KEY_SEP = '\u0000'
// Missing classroomId is ONE state (NULL === ''), and "an id too" where the
// cliff compares ids. Internal marker — never a projection key.
const MISSING_ID = '\u0000missing'

function classTimesOk(c: ClassRow): boolean {
  // The time check: presence + canonical HH:MM + valid values + start < end,
  // evaluated on the TRIMMED value — the same value the key carries.
  if (isMissing(c.startTime) || isMissing(c.endTime)) return false
  const s = c.startTime!.trim()
  const e = c.endTime!.trim()
  return HHMM.test(s) && HHMM.test(e) && s < e
}

/** The overlap predicate: strict — max(start) < min(end); a shared endpoint
 *  is not an overlap. Textual compare, valid under the canonical form. */
function overlaps(aS: string, aE: string, bS: string, bE: string): boolean {
  return (aS > bS ? aS : bS) < (aE < bE ? aE : bE)
}

export function computeRun(input: RunInput): RunResult {
  const { year } = input
  const familyById = new Map(input.tenantFamilies.map(f => [f.id, f]))
  const personById = new Map(input.tenantPersons.map(p => [p.id, p]))
  const classById = new Map(input.classes.map(c => [c.id, c]))

  // The enrollments the run reads are the enrolled ones: status equality is
  // text the run compares — trimmed, case-exact (the fold is the email's alone).
  const enrollments = input.enrollments.filter(e => e.status.trim() === 'enrolled')
  const enrollmentIds = new Set(enrollments.map(e => e.id))
  const kids = input.enrollmentKids.filter(k => enrollmentIds.has(k.enrollmentId))

  const rejections: RejectionRecord[] = []

  // ---- THE GATE. Both datasets judged; each check ranges over the rows its
  // predicate is defined on; the rejections are the union of all violations.

  // enrollment→family: the reference must resolve within the run's tenant.
  const enrolledFamilies: FamilyRow[] = []
  {
    const seen = new Set<string>()
    for (const e of enrollments) {
      const fam = familyById.get(e.familyId)
      if (!fam) {
        rejections.push({
          check: CHECK.enrollmentFamily,
          description: `enrollment names family ${e.familyId}, which resolves to no roster_families row of the run's tenant`,
          row: e,
        })
        continue
      }
      if (!seen.has(fam.id)) { seen.add(fam.id); enrolledFamilies.push(fam) }
    }
  }

  // Every person reference the run follows — assignment → person, kid set →
  // person, mother/father → person, and the guardian pointer's resolution —
  // must resolve to a LIVE persons row of the run's tenant.
  type PersonRef = { personId: string; namingRow: unknown; via: string }
  const refs: PersonRef[] = []
  for (const t of input.teacherAssignments) refs.push({ personId: t.personId, namingRow: t, via: 'roster_teachers.person_id' })
  for (const a of input.studentAssignments) refs.push({ personId: a.studentId, namingRow: a, via: 'roster_enrollments.student_id' })
  for (const k of kids) refs.push({ personId: k.studentId, namingRow: k, via: 'family_enrollment_students.student_id' })
  for (const f of enrolledFamilies) {
    if (f.motherId) refs.push({ personId: f.motherId, namingRow: f, via: 'roster_families.mother_id' })
    if (f.fatherId) refs.push({ personId: f.fatherId, namingRow: f, via: 'roster_families.father_id' })
  }
  // The guardian pointer names a parent for class-path students: guardian 1 =
  // mother, 2 = father, through the kid's OWN family. Any other value names no
  // parent. A dangling kid family is the family check's rejection on the kid, not a walk.
  for (const sid of new Set(input.studentAssignments.map(a => a.studentId))) {
    const kid = personById.get(sid)
    if (!kid || (kid.guardian !== 1 && kid.guardian !== 2)) continue
    const fam = kid.familyId ? familyById.get(kid.familyId) : undefined
    if (!fam) continue
    const slot = kid.guardian === 1 ? fam.motherId : fam.fatherId
    if (slot) refs.push({ personId: slot, namingRow: kid, via: 'persons.guardian' })
  }

  const domainPersons: PersonRow[] = []
  {
    const seen = new Set<string>()
    for (const r of refs) {
      const p = personById.get(r.personId)
      if (!p) {
        rejections.push({
          check: CHECK.readability,
          description: `${r.via} names person ${r.personId}, which resolves to no live persons row of the run's tenant`,
          row: r.namingRow,
        })
        continue
      }
      if (!seen.has(p.id)) { seen.add(p.id); domainPersons.push(p) }
    }
  }

  // The family check — family present AND resolving, tenant-scoped, for every read person.
  for (const p of domainPersons) {
    if (!p.familyId || !familyById.has(p.familyId)) {
      rejections.push({
        check: CHECK.familyPresent,
        description: p.familyId
          ? `person's family ${p.familyId} resolves to no roster_families row of the run's tenant`
          : 'person carries no family attribute',
        row: p,
      })
    }
  }

  // Uniqueness assertions — over populated values of the run's domain, under
  // the run's normalization. n holders → one record per holder, co-holders carried.
  const uniquenessCheck = (check: string, field: string, get: (p: PersonRow) => string | null) => {
    const groups = new Map<string, PersonRow[]>()
    for (const p of domainPersons) {
      const v = get(p)
      if (isMissing(v)) continue
      const k = normEmail(v!)
      const g = groups.get(k)
      if (g) g.push(p); else groups.set(k, [p])
    }
    for (const [k, ps] of groups) {
      if (ps.length < 2) continue
      for (const p of ps) {
        rejections.push({
          check,
          description: `${field} value '${k}' held by ${ps.length} persons under the run's normalization`,
          row: p,
          coRows: ps.filter(o => o !== p),
        })
      }
    }
  }
  uniquenessCheck(CHECK.emailUnique, 'persons.email', p => p.email)
  uniquenessCheck(CHECK.classroomEmailUnique, 'persons.classroom_email', p => teacherClassroomAddress(p, input.domain))

  // The time check — over every current-session class the run reads, teacherless included.
  const timedClasses: ClassRow[] = []
  for (const c of input.classes) {
    if (classTimesOk(c)) timedClasses.push(c)
    else {
      rejections.push({
        check: CHECK.classTimes,
        description: `start/end must be present, canonical HH:MM, valid, and start < end (read: start='${c.startTime ?? 'NULL'}', end='${c.endTime ?? 'NULL'}')`,
        row: c,
      })
    }
  }

  // The room check and the overlap check are defined only under the canonical form — their domain is
  // the classes passing the time check. The room check reads REAL classroomIds only: a missing id
  // names no classroom, so no home is shared.
  {
    const byRealId = new Map<string, ClassRow[]>()
    for (const c of timedClasses) {
      if (isMissing(c.classroomCourseId)) continue
      const id = c.classroomCourseId!.trim()     // trim only — ids compare case-exactly
      const g = byRealId.get(id)
      if (g) g.push(c); else byRealId.set(id, [c])
    }
    for (const [id, cs] of byRealId) {
      const tuples = new Set(cs.map(c => `${c.startTime!.trim()}${KEY_SEP}${c.endTime!.trim()}`))
      if (tuples.size < 2) continue
      for (const c of cs) {
        rejections.push({
          check: CHECK.oneIdPerTime,
          description: `classroomId '${id}' is shared across ${tuples.size} different (start, end) times`,
          row: c,
          coRows: cs.filter(o => o !== c),
        })
      }
    }
  }
  {
    const timedIds = new Set(timedClasses.map(c => c.id))
    const byStudent = new Map<string, StudentAssignmentRow[]>()
    for (const a of input.studentAssignments) {
      if (!timedIds.has(a.classId)) continue
      const g = byStudent.get(a.studentId)
      if (g) g.push(a); else byStudent.set(a.studentId, [a])
    }
    for (const rows of byStudent.values()) {
      for (let i = 0; i < rows.length; i++) {
        for (let j = i + 1; j < rows.length; j++) {
          const ca = classById.get(rows[i].classId)!
          const cb = classById.get(rows[j].classId)!
          if (!overlaps(ca.startTime!.trim(), ca.endTime!.trim(), cb.startTime!.trim(), cb.endTime!.trim())) continue
          rejections.push({
            check: CHECK.studentOverlap,
            description: `student in two roster classes that overlap in time (${ca.startTime!.trim()}–${ca.endTime!.trim()} / ${cb.startTime!.trim()}–${cb.endTime!.trim()})`,
            row: rows[i],
            coRows: [rows[j], ca, cb],
          })
          rejections.push({
            check: CHECK.studentOverlap,
            description: `student in two roster classes that overlap in time (${cb.startTime!.trim()}–${cb.endTime!.trim()} / ${ca.startTime!.trim()}–${ca.endTime!.trim()})`,
            row: rows[j],
            coRows: [rows[i], ca, cb],
          })
        }
      }
    }
  }

  // The snapshot's asserted structure — its own closed list of three bars.
  for (const m of input.snapshot) {
    if (isMissing(m.courseId) || isMissing(m.email) || isMissing(m.role)) {
      rejections.push({
        check: CHECK.snapshotFields,
        description: 'a membership is three fields — courseId, email, role — and all three must be present (NULL/whitespace = missing)',
        row: m,
      })
    }
    if (!isMissing(m.role)) {
      const role = m.role!.trim()
      if (role !== 'Teacher' && role !== 'Student') {
        rejections.push({
          check: CHECK.snapshotRole,
          description: `role must be exactly 'Teacher' or 'Student' (read: '${role}')`,
          row: m,
        })
      }
    }
  }
  {
    // Key-uniqueness under the run's normalization, over rows whose key is defined.
    const byKey = new Map<string, SnapshotRow[]>()
    for (const m of input.snapshot) {
      if (isMissing(m.courseId) || isMissing(m.email) || isMissing(m.role)) continue
      const k = `${m.courseId!.trim()}${KEY_SEP}${normEmail(m.email!)}${KEY_SEP}${m.role!.trim()}`
      const g = byKey.get(k)
      if (g) g.push(m); else byKey.set(k, [m])
    }
    for (const [k, ms] of byKey) {
      if (ms.length < 2) continue
      for (const m of ms) {
        rejections.push({
          check: CHECK.snapshotKey,
          description: `${ms.length} stored rows form one (courseId, email, role) key under the run's normalization`,
          row: m,
          coRows: ms.filter(o => o !== m),
        })
      }
    }
  }

  // Any violation refuses the WHOLE run: faulty data is never processed.
  if (rejections.length > 0) return { accepted: false, year, rejections }

  // ---- ACCEPTED RUN. Every class passes the time check; every reference resolves;
  // every domain person's family resolves; the snapshot is key-unique with
  // total role tokens. The projection trusts the gate and never re-validates.

  const teachersByClass = new Map<string, TeacherAssignmentRow[]>()
  for (const t of input.teacherAssignments) {
    const g = teachersByClass.get(t.classId)
    if (g) g.push(t); else teachersByClass.set(t.classId, [t])
  }
  const assignsByClass = new Map<string, StudentAssignmentRow[]>()
  for (const a of input.studentAssignments) {
    const g = assignsByClass.get(a.classId)
    if (g) g.push(a); else assignsByClass.set(a.classId, [a])
  }

  // (2) — a class with no teachers is reported here and never grouped.
  const noTeachers: Section2Row[] = input.classes
    .filter(c => !teachersByClass.has(c.id))
    .map(c => ({ class: c }))
  // The classes the run maps: those with a teacher.
  const taught = input.classes.filter(c => teachersByClass.has(c.id))

  const cidOf = (c: ClassRow): string =>
    isMissing(c.classroomCourseId) ? MISSING_ID : c.classroomCourseId!.trim()

  // Each taught class with its classroomId, its set of teachers, start and end, grouped by (teacher set, start, end).
  // The teacher set is a mathematical set.
  type Group = { teacherIds: string[]; start: string; end: string; classes: ClassRow[] }
  const groups = new Map<string, Group>()
  for (const c of taught) {
    const teacherIds = [...new Set(teachersByClass.get(c.id)!.map(t => t.personId))].sort()
    const start = c.startTime!.trim()
    const end = c.endTime!.trim()
    const key = `${teacherIds.join(',')}${KEY_SEP}${start}${KEY_SEP}${end}`
    const g = groups.get(key)
    if (g) g.classes.push(c)
    else groups.set(key, { teacherIds, start, end, classes: [c] })
  }

  // The data error cliff. Connected-fall is ONE step: every class carrying the
  // defective fact falls, students included; co-members' other classes survive.
  // A class condemned by more than one condition carries them all. (6) beats (7).
  const fallen = new Map<string, CliffCondition[]>()
  const condemn = (c: ClassRow, cond: CliffCondition) => {
    const g = fallen.get(c.id)
    if (g) g.push(cond); else fallen.set(c.id, [cond])
  }
  // Condition 2 — mixed ids in one group; a missing classroomId is an id too.
  for (const g of groups.values()) {
    const ids = new Set(g.classes.map(cidOf))
    if (ids.size < 2) continue
    for (const c of g.classes) {
      condemn(c, {
        name: CLIFF.mixedIds,
        description: `the (teacher set, ${g.start}–${g.end}) group carries ${ids.size} different classroomIds (missing is an id too)`,
        coRows: g.classes.filter(o => o !== c),
      })
    }
  }
  // Person-level condition — one body in two spaces at one time. Compared
  // across roles, over membership rows of the taught classes (gate-accepted, with a teacher).
  {
    type Membership = { personId: string; classId: string; role: 'Teacher' | 'Student'; row: unknown }
    const memberships: Membership[] = []
    for (const c of taught) {
      for (const t of teachersByClass.get(c.id)!) memberships.push({ personId: t.personId, classId: c.id, role: 'Teacher', row: t })
      for (const a of assignsByClass.get(c.id) ?? []) memberships.push({ personId: a.studentId, classId: c.id, role: 'Student', row: a })
    }
    const byPerson = new Map<string, Membership[]>()
    for (const m of memberships) {
      const g = byPerson.get(m.personId)
      if (g) g.push(m); else byPerson.set(m.personId, [m])
    }
    for (const [pid, rows] of byPerson) {
      const byTime = new Map<string, Membership[]>()
      for (const m of rows) {
        const c = classById.get(m.classId)!
        const k = `${c.startTime!.trim()}${KEY_SEP}${c.endTime!.trim()}`
        const g = byTime.get(k)
        if (g) g.push(m); else byTime.set(k, [m])
      }
      for (const set of byTime.values()) {
        const setClassIds = [...new Set(set.map(m => m.classId))]
        if (setClassIds.length < 2) continue
        const ids = new Set(setClassIds.map(id => cidOf(classById.get(id)!)))
        if (ids.size < 2) continue    // classes sharing one classroom at one time — one fact, no defect
        const person = personById.get(pid)!
        for (const classId of setClassIds) {
          condemn(classById.get(classId)!, {
            name: CLIFF.personTwoIds,
            description: `${person.firstName}${person.lastName ? ' ' + person.lastName : ''} holds same-time membership rows on ${ids.size} different classroomIds`,
            coRows: [person, ...set.map(m => m.row)],
          })
        }
      }
    }
  }

  const dataErrors: Section6Row[] = [...fallen].map(([classId, conditions]) => ({
    class: classById.get(classId)!,
    conditions,
  }))

  // (7) — clean groups uniformly missing their classroomId: the teachers and
  // their time, waiting for a home. One row per group, surviving members only.
  const pendingClassrooms: Section7Row[] = []
  for (const g of groups.values()) {
    const members = g.classes.filter(c => !fallen.has(c.id) && cidOf(c) === MISSING_ID)
    if (members.length === 0) continue
    pendingClassrooms.push({
      teachers: g.teacherIds.map(id => personById.get(id)!),
      start: g.start,
      end: g.end,
      classes: members,
    })
  }

  // The candidate row set: participants of clean taught classes with a real
  // classroomId. The email method removes rows ONLY by checks (3), (4), (5).
  const projecting = taught.filter(c => !fallen.has(c.id) && cidOf(c) !== MISSING_ID)

  const projection = new Map<string, ProjectionRow>()
  const addRow = (courseId: string, email: string, role: 'Teacher' | 'Student', fact: SourceFact) => {
    const key = `${courseId}${KEY_SEP}${email}${KEY_SEP}${role}`
    const row = projection.get(key)
    if (row) row.facts.push(fact)
    else projection.set(key, { courseId, email, role, facts: [fact] })
  }

  // Check (3) — a Teacher role must have the school-issued address
  // (persons.classroom_email); one row per teacher, their rows drop.
  const check3 = new Map<string, PersonRow>()
  for (const c of projecting) {
    for (const t of teachersByClass.get(c.id)!) {
      const p = personById.get(t.personId)!
      const address = teacherClassroomAddress(p, input.domain)
      if (!address) { check3.set(p.id, p); continue }
      addRow(cidOf(c), address, 'Teacher', { kind: 'class', classId: c.id, personId: p.id, role: 'Teacher' })
    }
  }
  const noClassroomEmail: Section3Row[] = [...check3.values()].map(teacher => ({ teacher }))

  // Student emission — the emission rule, read via resolveStudentAddress:
  // own email if populated, else the guardian-named parent's, else blank.
  // No teacher condition.
  const emitWithSource = (p: PersonRow) => {
    const fam = p.familyId ? familyById.get(p.familyId) : undefined
    const mother = fam?.motherId ? personById.get(fam.motherId) : undefined
    const father = fam?.fatherId ? personById.get(fam.fatherId) : undefined
    return resolveStudentAddress({
      email: p.email,
      guardian: p.guardian,
      motherId: fam?.motherId ?? null,
      fatherId: fam?.fatherId ?? null,
      motherEmail: mother?.email ?? null,
      fatherEmail: father?.email ?? null,
      domain: input.domain,
    })
  }
  const emitFor = (p: PersonRow): string | null => emitWithSource(p).email

  // WHOSE ADDRESS IT IS, served beside the projection so no reader recomputes it: the emission
  // rule produces it, and the mapping between a roster class and a Google Classroom is this
  // model's alone.
  const addressSourceByPerson = new Map<string, 'own' | 'mother' | 'father' | 'none'>()

  type StudentCand = { class: ClassRow; person: PersonRow }
  const studentCands: StudentCand[] = []
  const studentParticipants = new Map<string, PersonRow>()
  for (const c of projecting) {
    for (const a of assignsByClass.get(c.id) ?? []) {
      const p = personById.get(a.studentId)!
      studentParticipants.set(p.id, p)
      studentCands.push({ class: c, person: p })
    }
  }

  // Check (5) — participant with no emitted address; one row per participant.
  // Check (4) — the collision is participant-level: every student participant
  // standing on one normalized emitted address drops, one row each. A parent's
  // school board's row is NOT in this check.
  const emission = new Map<string, string | null>()
  const byAddr = new Map<string, PersonRow[]>()
  const noEmail: Section5Row[] = []
  for (const p of studentParticipants.values()) {
    const emitted = emitWithSource(p)
    const e = emitted.email
    addressSourceByPerson.set(p.id, emitted.source)
    emission.set(p.id, e)
    if (e === null) { noEmail.push({ participant: p, familyId: p.familyId }); continue }
    const g = byAddr.get(e)
    if (g) g.push(p); else byAddr.set(e, [p])
  }
  const collisions: Section4Row[] = []
  const droppedStudents = new Set<string>()
  for (const [addr, ps] of byAddr) {
    if (ps.length < 2) continue
    for (const p of ps) {
      droppedStudents.add(p.id)
      collisions.push({ participant: p, email: addr, familyId: p.familyId })
    }
  }
  for (const { class: c, person: p } of studentCands) {
    if (droppedStudents.has(p.id)) continue
    const e = emission.get(p.id)
    if (e == null) continue
    addRow(cidOf(c), e, 'Student', { kind: 'class', classId: c.id, personId: p.id, role: 'Student' })
  }

  // The school board: everyone role Student, only people with an email, own
  // persons.email only (no guardian fallback here), silent absence when blank.
  // A blank/absent designated value = no board rows, no error.
  const boardCourseId = input.board && !isMissing(input.board.googleCourseId)
    ? input.board.googleCourseId!.trim()
    : null
  if (boardCourseId !== null) {
    for (const fam of enrolledFamilies) {
      for (const pid of [fam.motherId, fam.fatherId]) {
        if (!pid) continue
        const parent = personById.get(pid)!
        if (isMissing(parent.email)) continue     // family choice — no row, no complaint
        addRow(boardCourseId, normEmail(parent.email!), 'Student', { kind: 'board-parent', personId: parent.id, familyId: fam.id })
      }
    }
    for (const k of kids) {
      const p = personById.get(k.studentId)!
      if (isMissing(p.email)) continue
      addRow(boardCourseId, normEmail(p.email!), 'Student', { kind: 'board-kid', personId: p.id })
    }
    for (const pid of new Set(input.teacherAssignments.map(t => t.personId))) {
      const p = personById.get(pid)!               // assigned = agreed to teach, unmapped sections included
      if (isMissing(p.email)) continue
      addRow(boardCourseId, normEmail(p.email!), 'Student', { kind: 'board-teacher', personId: p.id })
    }
  }

  // ---- The gap: the superset of the two key sets under the one normalization.
  const snapByKey = new Map<string, SnapshotRow>()   // singular by the key-uniqueness bar
  for (const m of input.snapshot) {
    snapByKey.set(`${m.courseId!.trim()}${KEY_SEP}${normEmail(m.email!)}${KEY_SEP}${m.role!.trim()}`, m)
  }

  // ON THE SCHOOL BOARD, A TEACHER IS ON IT TOO: for the school board, both roles are looked at.
  // A teacher's personal address may be a Teacher on the board, and the projection expects every board address
  // as a Student, so the three-column key would never meet and the teacher would read as not joined. For the board ONLY, a Teacher row
  // stands in for the Student row the projection wants at the same address — the address is on the board either
  // way. It stands in only when no Student row exists there, so a genuine Student row is never displaced, and a
  // class's roles still compare exactly.
  if (boardCourseId !== null) {
    for (const m of input.snapshot) {
      if (m.courseId!.trim() !== boardCourseId || m.role!.trim() !== 'Teacher') continue
      const email = normEmail(m.email!)
      const studentKey = `${boardCourseId}${KEY_SEP}${email}${KEY_SEP}Student`
      if (!projection.has(studentKey) || snapByKey.has(studentKey)) continue
      snapByKey.delete(`${boardCourseId}${KEY_SEP}${email}${KEY_SEP}Teacher`)
      snapByKey.set(studentKey, m)
    }
  }

  // Family derivation — the closed list. A gap row's family comes FROM THE
  // EMAIL: role-directed lookup over the TENANT'S live persons (whole tenant);
  // the resolved person's OWN family attribute is the family. No hit,
  // multi-hit, or absent/dangling family = no family — whole-view only.
  const byEmailLookup = new Map<string, PersonRow[]>()
  const byClassroomEmailLookup = new Map<string, PersonRow[]>()
  for (const p of input.tenantPersons) {
    if (!isMissing(p.email)) {
      const k = normEmail(p.email!)
      const g = byEmailLookup.get(k)
      if (g) g.push(p); else byEmailLookup.set(k, [p])
    }
    const k = teacherClassroomAddress(p, input.domain)
    if (k) {
      const g = byClassroomEmailLookup.get(k)
      if (g) g.push(p); else byClassroomEmailLookup.set(k, [p])
    }
  }
  const deriveFamily = (email: string, role: string): string | null => {
    const hits = (role === 'Teacher' ? byClassroomEmailLookup : byEmailLookup).get(email) ?? []
    if (hits.length !== 1) return null
    const fid = hits[0].familyId
    return fid !== null && familyById.has(fid) ? fid : null
  }

  const gap: GapRow[] = []
  for (const key of new Set([...projection.keys(), ...snapByKey.keys()])) {
    const [courseId, email, role] = key.split(KEY_SEP)
    const proj = projection.get(key) ?? null
    const snap = snapByKey.get(key) ?? null
    gap.push({
      courseId,
      email,
      role,
      projection: proj,
      snapshot: snap,
      match: proj !== null && snap !== null,
      familyId: deriveFamily(email, role),
    })
  }
  gap.sort((a, b) =>
    a.courseId < b.courseId ? -1 : a.courseId > b.courseId ? 1
    : a.email < b.email ? -1 : a.email > b.email ? 1
    : a.role < b.role ? -1 : a.role > b.role ? 1 : 0)

  // ---- The three pictures.
  const roster: RosterPicture = {
    classes: input.classes,
    teacherAssignments: input.teacherAssignments,
    studentAssignments: input.studentAssignments,
    enrollments,
    enrollmentKids: kids,
    families: enrolledFamilies,
    persons: domainPersons,
    board: input.board,
  }
  const projectionList = [...projection.values()]

  // ---- Family cards — who-acts: a card carries the family's rows in (1),
  // Match and Break alike, checks (4)/(5), and its reachable picture rows.
  // (2), (3), (6), (7) and rejections are principal items, never on a card.
  const cards = new Map<string, FamilyCard>()
  const cardFor = (fid: string): FamilyCard => {
    let card = cards.get(fid)
    if (card) return card
    const family = familyById.get(fid)!
    const parents = [family.motherId, family.fatherId]
      .filter((id): id is string => id !== null)
      .map(id => personById.get(id))
      .filter((p): p is PersonRow => p !== undefined)
    card = {
      familyId: fid,
      family,
      parents,
      gapRows: [],
      collisions: [],
      noEmail: [],
      roster: { enrollments: [], kids: [], persons: [], teacherAssignments: [], studentAssignments: [], classes: [] },
      snapshotRows: [],
    }
    cards.set(fid, card)
    return card
  }

  for (const row of gap) {
    if (row.familyId === null) continue         // whole-view only
    const card = cardFor(row.familyId)
    card.gapRows.push(row)
    if (row.snapshot) card.snapshotRows.push(row.snapshot)
  }
  for (const r of collisions) if (r.familyId !== null) cardFor(r.familyId).collisions.push(r)
  for (const r of noEmail) if (r.familyId !== null) cardFor(r.familyId).noEmail.push(r)
  // Picture rows reach a card through the family's own facts.
  for (const e of enrollments) if (familyById.has(e.familyId)) cardFor(e.familyId).roster.enrollments.push(e)
  for (const k of kids) {
    const fid = personById.get(k.studentId)!.familyId!
    cardFor(fid).roster.kids.push(k)
  }
  for (const p of domainPersons) cardFor(p.familyId!).roster.persons.push(p)
  const cardClassIds = new Map<string, Set<string>>()
  const nameClass = (fid: string, classId: string) => {
    let set = cardClassIds.get(fid)
    if (!set) { set = new Set(); cardClassIds.set(fid, set) }
    if (set.has(classId)) return
    set.add(classId)
    cardFor(fid).roster.classes.push(classById.get(classId)!)
  }
  for (const t of input.teacherAssignments) {
    const fid = personById.get(t.personId)!.familyId!
    cardFor(fid).roster.teacherAssignments.push(t)
    nameClass(fid, t.classId)
  }
  for (const a of input.studentAssignments) {
    const fid = personById.get(a.studentId)!.familyId!
    cardFor(fid).roster.studentAssignments.push(a)
    nameClass(fid, a.classId)
  }

  // THE SESSION'S FAMILIES ONLY: enrolled families' parents, enrolled children with an address,
  // and teachers. A break row — a Google address no session enumeration produced — resolves to a
  // person and so to a family, but that attribution alone makes no card: a family has a card only
  // when it has a teacher or an enrolled student. The row stays in the gap for the overall view.
  for (const [fid, c] of cards) {
    if (c.roster.enrollments.length === 0 && c.roster.teacherAssignments.length === 0) cards.delete(fid)
  }

  const cardLabel = (c: FamilyCard) =>
    c.parents.map(p => `${p.lastName ?? ''} ${p.firstName}`).join(' ') || c.familyId
  const byLabel = byName(input.language)
  const familyCards = [...cards.values()].sort((a, b) => byLabel(cardLabel(a), cardLabel(b)) || byCode(a.familyId, b.familyId))

  return {
    accepted: true,
    year,
    rejections: [],
    gap,
    /** WHOSE ADDRESS REPRESENTS EACH STUDENT PARTICIPANT — 'own', 'mother', 'father' or 'none', by
     *  person id. Served so no screen recomputes the emission rule to label a column. */
    addressSource: addressSourceByPerson,
    noTeachers,
    noClassroomEmail,
    collisions,
    noEmail,
    dataErrors,
    pendingClassrooms,
    roster,
    projection: projectionList,
    snapshot: input.snapshot,
    familyCards,
  }
}

// ---------------------------------------------------------------------------
// The session selector and the loader.
// ---------------------------------------------------------------------------

// The current session lives in session-year.ts, store-free; re-exported for this file's many importers.
import { currentSessionYear } from './session-year'
export { currentSessionYear }

// The room claim and the loader, runThreeUniverses, live in three-universes-load.ts; this file is pure.
