/**
 * The board.
 *
 * From our data we can derive what a classroom should look like, and we have the actual
 * classroom data saved, refreshed from time to time. Between the two there is a gap; the
 * principal's actions bridge it, one action or a group at a time — like moving pieces on
 * a board.
 *
 * So this file computes ONE thing: the difference between what the roster says a
 * Google Classroom should be and what the saved snapshot says it is. Each difference is
 * a move the principal can make. A count of them is a summary; the board is the thing itself.
 *
 * TWO PROPERTIES THAT ARE NOT NEGOTIABLE:
 *
 * 1. **It is drawn from the cache, never from Google.** Google is touched when a piece is MOVED and when
 *    REFRESH is pressed. Nowhere else — not to draw the board, not to preview a move.
 *
 * 2. **Reversible and irreversible moves are different things and must never look
 *    alike.** Adding or removing somebody in a classroom can be undone. An email to a
 *    family cannot. On a board every piece slides the same way, which is exactly what
 *    would make a one-way move easy to make by accident.
 *
 * The comparison runs BOTH ways. A student who dropped but is still in the classroom is
 * as much a difference as one who never joined.
 */

import { rosterClassCode } from './roster-class-code'
import { ports } from '../ports'
import { schoolYearLabel } from './enrollment'
import type { RejectionRecord, RunResult } from './three-universes'
import type { MoveKind } from './classroom-kinds'
import { leadTeacherEmail } from './google-school'
import { teacherClassroomAddress } from './teacher-classroom-address'
import { workspaceDomain } from './role-mailbox'

// Re-exported for this file's importers; the kinds themselves live in their own import-nothing module.
export type { MoveKind }

/** One difference between roster and Classroom. A row on the board. */
export type Move = {
  /** Stable across redraws, so a selection survives one. */
  id: string
  kind: MoveKind
  classId: string
  /** The catalog course code — what a classroom created from this row is named (its section rides separately). */
  shortCode: string
  /** The roster class's short form, section included (X2B) — what the board shows. */
  classCode?: string
  /** Who or what the move is about. */
  subject: string
  /** What pressing it does, in plain words. */
  action: string
  /**
   * False for anything that sends email. Nothing else on this board is one-way:
   * an account can be deleted, a course archived, a member removed.
   */
  reversible: boolean
  /** Informational rows carry no move — the board still shows them. */
  actionable: boolean
  /** Carried through to the executor so it need not re-derive them. */
  personId?: string
  email?: string
  courseId?: string
  /**
   * Set when the row is about a BOARD (the school board, or any other board) rather than a
   * class: `classId` then holds the board's id and `shortCode` its name, and the row
   * links to the board.
   */
  boardId?: string
}

/**
 * A board: a Google course that is not a class. Every teacher's school-issued
 * address goes on each board AS A STUDENT, never as a teacher; who is made a teacher
 * of a board is the owner's own act in Classroom, so a board never asks for a removal.
 */
export type DesiredBoard = {
  boardId: string
  name: string
  googleCourseId: string | null
  /** Whether the board's course is in the snapshot at all (see board-not-synced). */
  inSnapshot: boolean
}

export type Board = {
  year: number
  schoolYear: string
  moves: Move[]
  /** When the snapshot was last pulled from Google — the board says how stale it is. */
  lastSynced: string | null
  counts: Record<MoveKind, number>
  /**
   * WHY THERE IS NO BOARD, when the roster check refuses to run at all.
   *
   * Faulty data refuses the WHOLE run (the run's gate), and the board is drawn from that
   * run now — so it has nothing to draw and must say so rather than show an empty, reassuring screen.
   *
   * THE RUN'S OWN RECORDS, whole: a {check, description} without the row would print the difficulty with nothing in
   * it to click. A refusal must state its difficulty, and the row IS the difficulty; a reduced copy of it hides what
   * the reader needs to act on.
   */
  refused: RejectionRecord[] | null
}

// ─── the pure part: desired vs actual → moves ────────────────────────────────

export type DesiredClass = {
  classId: string
  shortCode: string
  section: string | null
  classroomCourseId: string | null
  meet: string | null
  teachers: { personId: string; name: string; email: string | null; classroomEmail: string | null }[]
  students: {
    personId: string; name: string
    /** The address representing them in the classroom — own, or a parent's via `guardian`. */
    email: string | null
    addressSource?: 'own' | 'mother' | 'father' | 'none'
    /**
     * Why no address is allocated. 'sibling' — two children point at the same
     * parent, and one account cannot be two Classroom members.
     */
    contestedBy?: 'sibling'
    /** With 'sibling': the other children pointing at the same address. */
    contendingWith?: string[]
    /**
     * WHY the run gives this student no address — and the ONLY thing that makes a missing address
     * worth emailing a family about. 'none' is no address anywhere, 'contested' is
     * one address, two children. An absent `email` with no problem named here means the
     * run simply had no row for them, which is what a class with no Google classroom looks like.
     */
    addressProblem?: 'none' | 'contested'
    parentEmails: string[]
  }[]
  /**
   * WHY THE ROSTER CHECK SAYS NOTHING ABOUT THIS CLASS, when it says nothing.
   *
   * The run projects nobody into a class with no teacher and drops a class carrying a defective fact. Either way there is no projection
   * for its room, so no member of that room can be called right or wrong.
   *
   * IT IS A SILENCE, NOT A REPORT. Nothing is placed and no member is judged; the board says
   * nothing about the class rather than putting a roster condition on a board of Google moves.
   * Whether a class has a teacher is the school's business and not this program's.
   */
  excluded?: 'no-teacher' | 'data-error' | null
}

export type ActualMember = { courseId: string; role: 'Teacher' | 'Student'; email: string | null; name: string | null }

const lower = (s: string | null | undefined) => (s ?? '').trim().toLowerCase()

/** Every kind the board counts — one list, so the refused path cannot answer a different set of
 *  keys from the accepted one. */
const KIND_COUNTED: MoveKind[] = [
  'create-account', 'create-classroom', 'add-teacher', 'remove-teacher', 'remove-student',
  'email-teacher', 'email-join', 'email-parents', 'no-meet', 'add-to-board', 'board-not-synced',
]

/**
 * Pure. Given what the roster wants and what the snapshot holds, return every
 * difference. No database, no Google, no clock — so the whole rule is testable.
 */
export function buildBoard(
  /** The tenant's directory domain — the tenant value `workspace-domain`. */
  domain: string,
  classes: DesiredClass[], actual: ActualMember[], year: number, lastSynced: string | null,
  boards: DesiredBoard[] = [],
  /**
   * The lead teacher's address — leadTeacherEmail(tenantId). It OWNS every classroom, so it
   * is a teacher of each and on no roster class, so it is excluded: it is never shown as a
   * teacher to be removed.
   */
  leadTeacher: string | null = null,
): Board {
  const moves: Move[] = []
  const membersByCourse = new Map<string, ActualMember[]>()
  for (const m of actual) {
    const list = membersByCourse.get(m.courseId)
    if (list) list.push(m)
    else membersByCourse.set(m.courseId, [m])
  }

  /**
   * ONE GOOGLE CLASSROOM CAN SERVE SEVERAL ROSTER CLASSES, and every REMOVAL has to be decided
   * over the whole room rather than one class at a time.
   *
   * A school's rooms may be shared by two or three classes. Compared per roster class against the room's entire
   * membership, every student of the OTHER class in the same room would look like an intruder: removals that are not
   * extras at all. The comparison is per CLASSROOM, as every other reader of the run makes it.
   *
   * ADDING SOMEBODY is still per class and correctly so — a student belongs to a class, and the
   * class says which room to put them in. It is only the question "should this member be here at
   * all" that is a property of the ROOM, because the room is what they are a member of.
   */
  const classesByCourse = new Map<string, DesiredClass[]>()
  for (const c of classes) {
    if (!c.classroomCourseId) continue
    const list = classesByCourse.get(c.classroomCourseId)
    if (list) list.push(c)
    else classesByCourse.set(c.classroomCourseId, [c])
  }

  for (const c of classes) {
    const inCourse = c.classroomCourseId ? (membersByCourse.get(c.classroomCourseId) ?? []) : []
    const courseTeachers = new Set(inCourse.filter(m => m.role === 'Teacher').map(m => lower(m.email)))
    const courseStudents = new Set(inCourse.filter(m => m.role === 'Student').map(m => lower(m.email)))

    // ── teachers ──────────────────────────────────────────────────────────
    // NOTHING IS PLACED IN A ROOM THE RUN SAYS NOTHING ABOUT. This is the only consequence the
    // program draws from `excluded`, and it is a silence rather than a report: whether a class has a
    // teacher does not change the program. What changes is that there is no projection to compare against, so claiming a member is
    // missing or wrong would be an invention. The classroom and Meet rows below need no projection
    // and still stand.
    for (const t of c.excluded ? [] : c.teachers) {
      const address = teacherClassroomAddress(t, domain)
      if (!address) {
        moves.push({
          id: `create-account:${c.classId}:${t.personId}`, kind: 'create-account',
          classId: c.classId, shortCode: c.shortCode, classCode: rosterClassCode(c), subject: t.name,
          action: `Create a ${domain} account for ${t.name}`,
          reversible: true, actionable: true, personId: t.personId, email: t.email ?? undefined,
        })
        continue    // nothing else about this teacher is reachable until they have one
      }
      if (c.classroomCourseId && !courseTeachers.has(address)) {
        moves.push({
          id: `add-teacher:${c.classId}:${t.personId}`, kind: 'add-teacher',
          classId: c.classId, shortCode: c.shortCode, classCode: rosterClassCode(c), subject: t.name,
          action: `Add ${address} to the classroom as a teacher`,
          reversible: true, actionable: true, personId: t.personId,
          email: address, courseId: c.classroomCourseId,
        })
      }
    }

    // ── the classroom itself ──────────────────────────────────────────────
    if (!c.classroomCourseId) {
      moves.push({
        id: `create-classroom:${c.classId}`, kind: 'create-classroom',
        classId: c.classId, shortCode: c.shortCode, classCode: rosterClassCode(c), subject: rosterClassCode(c),
        action: `Create the Google Classroom for ${rosterClassCode(c)}`,
        reversible: true, actionable: c.teachers.length > 0,
      })
    } else if (!c.meet) {
      // The owner creates the Meet by hand and stores it. The board shows the
      // hole; it does not invent a link.
      moves.push({
        id: `no-meet:${c.classId}`, kind: 'no-meet',
        classId: c.classId, shortCode: c.shortCode, classCode: rosterClassCode(c), subject: rosterClassCode(c),
        action: 'No Meet link recorded for this classroom',
        reversible: true, actionable: false, courseId: c.classroomCourseId,
      })
    }

    // ── students ──────────────────────────────────────────────────────────
    for (const s of c.excluded ? [] : c.students) {
      // A MISSING ADDRESS IS NOT ITSELF A REASON TO EMAIL A FAMILY. Only the run's own two reasons
      // are (contested, or none at all); an address absent for any other cause —
      // a class with no classroom, so no projection row — is silent here, and the missing classroom
      // is already its own row.
      if (s.addressProblem || (!s.email && s.contestedBy)) {
        moves.push({
          id: `email-parents:${c.classId}:${s.personId}`, kind: 'email-parents',
          classId: c.classId, shortCode: c.shortCode, classCode: rosterClassCode(c), subject: s.name,
          action: s.contestedBy === 'sibling'
            ? `EMAIL the family of ${s.name} — ${[s.name, ...(s.contendingWith ?? [])].join(' and ')} `
              + `all point at one address, and it can represent only one of them`
            : s.parentEmails.length
              ? `EMAIL the family of ${s.name} — ${s.name} has no address`
              : `${s.name} has no address and no parent address either — nobody to ask`,
          reversible: false, actionable: s.parentEmails.length > 0, personId: s.personId,
        })
        continue
      }
      if (!s.email) continue
      if (c.classroomCourseId && !courseStudents.has(lower(s.email))) {
        moves.push({
          id: `email-join:${c.classId}:${s.personId}`, kind: 'email-join',
          classId: c.classId, shortCode: c.shortCode, classCode: rosterClassCode(c), subject: s.name,
          action: `EMAIL the family of ${s.name} — ${s.name} has not joined as ${s.email}`,
          reversible: false, actionable: true, personId: s.personId,
          email: s.email, courseId: c.classroomCourseId,
        })
      }
    }

    // A teacher who now has an account but has never been sent it cannot be told from
    // the snapshot — Google does not record that we emailed anybody. It is deliberately
    // NOT guessed at here; the create-account move sends the welcome with the password,
    // which is the only moment the password exists.
  }

  // ── who should not be in the room — decided ONCE PER ROOM ──────────────────
  //
  // The union of every roster class that points at this classroom. A member Google holds that
  // none of those classes places is an extra; a member one of them places is not, whichever class
  // it is. See the note on classesByCourse above.
  for (const [courseId, roomClasses] of classesByCourse) {
    // A ROOM WITH AN UNSPEAKABLE CLASS IN IT REPORTS NO REMOVALS, wherever it is asked: if the projection
    // has nothing to say about any class sharing this room, its members cannot be judged — judging
    // it would offer to remove a parent whose child is enrolled in the class the projection skipped.
    if (roomClasses.some(c => c.excluded)) continue
    const inCourse = membersByCourse.get(courseId) ?? []
    const roomLabel = roomClasses.map(rosterClassCode).join(' + ')
    const first = roomClasses[0]

    const roomStudentAddrs = new Set<string>()
    const roomTeacherAddrs = new Set<string>()
    for (const c of roomClasses) {
      for (const s of c.students) if (s.email) roomStudentAddrs.add(lower(s.email))
      for (const t of c.teachers) {
        const a = teacherClassroomAddress(t, domain)
        if (a) roomTeacherAddrs.add(a)
      }
    }

    for (const m of inCourse) {
      const addr = lower(m.email)
      if (m.role === 'Teacher') {
        // The lead teacher owns every classroom and is on no roster class.
        if (leadTeacher && addr === lower(leadTeacher)) continue
        if (roomTeacherAddrs.has(addr)) continue
        moves.push({
          id: `remove-teacher:${courseId}:${addr}`, kind: 'remove-teacher',
          classId: first.classId, shortCode: first.shortCode, classCode: roomLabel,
          subject: m.name || m.email || 'unknown',
          action: `Remove ${m.email} from the classroom — not a teacher of ${roomLabel}`,
          reversible: true, actionable: true, email: m.email ?? undefined, courseId,
        })
        continue
      }
      if (roomStudentAddrs.has(addr)) continue
      moves.push({
        id: `remove-student:${courseId}:${addr}`, kind: 'remove-student',
        classId: first.classId, shortCode: first.shortCode, classCode: roomLabel,
        subject: m.name || m.email || 'unknown',
        action: `Remove ${m.email} from the classroom — not enrolled in ${roomLabel}`,
        reversible: true, actionable: true, email: m.email ?? undefined, courseId,
      })
    }
  }

  // ── boards ────────────────────────────────────────────────────────────────
  // Every teacher of the year, once, by their school-issued address. A teacher with no
  // address already has a create-account row on their class; nothing more is said here.
  const yearTeachers = new Map<string, { personId: string; name: string; address: string }>()
  for (const c of classes) {
    for (const t of c.teachers) {
      const address = teacherClassroomAddress(t, domain)
      if (address && !yearTeachers.has(t.personId)) {
        yearTeachers.set(t.personId, { personId: t.personId, name: t.name, address })
      }
    }
  }
  for (const b of boards) {
    if (!b.googleCourseId || !b.inSnapshot) {
      // Drawn from the cache, never from Google: a board whose course the last refresh
      // did not bring back has no members to compare against, so the board says so
      // rather than asking to add everybody.
      moves.push({
        id: `board-not-synced:${b.boardId}`, kind: 'board-not-synced',
        classId: b.boardId, shortCode: b.name, subject: b.name, boardId: b.boardId,
        action: b.googleCourseId
          ? `${b.name} (course ${b.googleCourseId}) was not in the last refresh from Google`
          : `${b.name} has no Google course`,
        reversible: true, actionable: false, courseId: b.googleCourseId ?? undefined,
      })
      continue
    }
    // Either role counts as "on the board": a teacher the owner has promoted by hand is not
    // asked for again as a student.
    const onBoard = new Set((membersByCourse.get(b.googleCourseId) ?? []).map(m => lower(m.email)))
    for (const t of yearTeachers.values()) {
      if (onBoard.has(t.address)) continue
      moves.push({
        id: `add-to-board:${b.boardId}:${t.personId}`, kind: 'add-to-board',
        classId: b.boardId, shortCode: b.name, subject: t.name, boardId: b.boardId,
        action: `Add ${t.address} to ${b.name} as a student`,
        reversible: true, actionable: true, personId: t.personId,
        email: t.address, courseId: b.googleCourseId,
      })
    }
  }

  // Counts are of ACTIONABLE moves only. A class with no classroom and no teacher either cannot be created, so
  // counting it would read as a thing the principal can do when it is not.
  const counts = {} as Record<MoveKind, number>
  for (const k of KIND_COUNTED) counts[k] = moves.filter(m => m.kind === k && m.actionable).length

  return { year, schoolYear: schoolYearLabel(year), moves, lastSynced, counts, refused: null }
}

// ─── reading both sides out of the database ──────────────────────────────────

/**
 * Draw the board. ONE SOURCE — the roster check (the run) that draws the map of who belongs where.
 *
 * The board has no reading of the roster and no address rule of its own: two programs answering one question from
 * two sources disagree.
 *
 * WHAT COMES FROM THE RUN: the classes, their teachers, their students, and — the part that
 * matters — WHICH ADDRESS REPRESENTS A STUDENT in each classroom. The run's projection is the
 * answer, the same answer every other reader of the run draws.
 *
 * WHAT STAYS IN SQL, and why it is not a second source: the Meet link, the member NAMES, the
 * boards, and the snapshot's age. None of them is part of the run's model — its snapshot key is
 * (courseId, email, role) and carries no name, and a Meet link is a Google fact about a room rather
 * than a statement about who belongs in it. They are decoration on rows the run decided.
 */
export async function getBoard(tenantId: string, year: number, run: RunResult): Promise<Board> {
  // The run is the caller's: from the roster API (universe.run), or loaded directly by the API's own code.

  // The member names, the Meet links, the boards and the snapshot's age — read whatever the run
  // concluded, because a refused run still has a board to draw the refusal on.
  const memberRows: ActualMember[] = await ports().classroom.tenantMembers(tenantId)
  const lastSynced = await ports().classroom.lastSynced(tenantId)

  // A REFUSED RUN DRAWS NO BOARD. Faulty data refuses the whole run; a board that fell back to its
  // own reading would show tidy rows drawn from data the gate rejected.
  if (!run.accepted) {
    const counts = {} as Record<MoveKind, number>
    for (const k of KIND_COUNTED) counts[k] = 0
    return {
      year, schoolYear: schoolYearLabel(year), moves: [], lastSynced, counts,
      refused: run.rejections,
    }
  }

  const meetRows = await ports().classroom.courseMeets(tenantId)
  const meetOf = new Map(meetRows.map(r => [r.id.trim(), r.meet]))

  const boardRows: DesiredBoard[] = await ports().classroom.boards(tenantId)

  const personOf = new Map(run.roster.persons.map(p => [p.id, p]))
  const familyOf = new Map(run.roster.families.map(f => [f.id, f]))
  const nameOf = (id: string) => {
    const p = personOf.get(id)
    return p ? [p.firstName, p.lastName].filter(Boolean).join(' ') : id
  }

  // THE PROJECTED ADDRESS, PER PERSON — read off the run's own projection rows. This is the emission
  // rule as the model applies it; this file owns no second copy of it.
  //
  // PER PERSON AND NOT PER (CLASS, PERSON): the projection is keyed by COURSE, so a class with no Google
  // classroom has no projection rows at all, and keyed by class its students would read as having no
  // address. The emission rule gives one address per PERSON, and one Google account can sit in several
  // courses, so the person is the right key and the class is not.
  const projected = new Map<string, string>()
  for (const row of run.projection) {
    for (const f of row.facts) {
      if (f.kind === 'class' && !projected.has(`${f.personId}|${f.role}`)) {
        projected.set(`${f.personId}|${f.role}`, row.email)
      }
    }
  }

  // The run's own reasons a participant has no usable address: none at all, or one
  // contested with a sibling. Nothing else counts as a reason.
  const noEmailIds = new Set(run.noEmail.map(r => r.participant.id))
  const collidedOn = new Map(run.collisions.map(r => [r.participant.id, r.email]))
  const contendersOf = new Map<string, string[]>()
  for (const r of run.collisions) {
    const others = run.collisions.filter(o => o.email === r.email && o.participant.id !== r.participant.id)
    contendersOf.set(r.participant.id, others.map(o => [o.participant.firstName, o.participant.lastName].filter(Boolean).join(' ')))
  }

  const excludedOf = new Map<string, 'no-teacher' | 'data-error'>()
  for (const r of run.noTeachers) excludedOf.set(r.class.id, 'no-teacher')
  for (const r of run.dataErrors) excludedOf.set(r.class.id, 'data-error')

  const parentEmailsOf = (personId: string): string[] => {
    const fid = personOf.get(personId)?.familyId
    const fam = fid ? familyOf.get(fid) : null
    if (!fam) return []
    return [fam.motherId, fam.fatherId]
      .map(id => (id ? personOf.get(id)?.email ?? null : null))
      .filter((e): e is string => !!e)
  }

  const classes: DesiredClass[] = run.roster.classes.map(c => ({
    classId: c.id,
    shortCode: c.shortCode ?? '',
    section: c.section,
    classroomCourseId: c.classroomCourseId,
    meet: c.classroomCourseId ? meetOf.get(c.classroomCourseId.trim()) ?? null : null,
    excluded: excludedOf.get(c.id) ?? null,
    teachers: run.roster.teacherAssignments.filter(t => t.classId === c.id).map(t => {
      const p = personOf.get(t.personId)
      return {
        personId: t.personId, name: nameOf(t.personId),
        email: p?.email ?? null, classroomEmail: p?.classroomEmail ?? null,
      }
    }),
    students: run.roster.studentAssignments.filter(a => a.classId === c.id).map(a => ({
      personId: a.studentId,
      name: nameOf(a.studentId),
      // The run's answer, not a second computation of it. Absent = the run placed nobody for this
      // student in this class, which its own sections then explain.
      email: projected.get(`${a.studentId}|Student`) ?? null,
      // WHY THERE IS NO ADDRESS, in the run's words and only in the run's words. An absent address
      // is not by itself a problem to email a family about — it is also what a class with no
      // classroom looks like. The run names the two real reasons and nothing else may be inferred.
      addressProblem: collidedOn.has(a.studentId) ? ('contested' as const)
        : noEmailIds.has(a.studentId) ? ('none' as const) : undefined,
      contestedBy: collidedOn.has(a.studentId) ? ('sibling' as const) : undefined,
      contendingWith: contendersOf.get(a.studentId),
      parentEmails: parentEmailsOf(a.studentId),
    })),
  }))

  return buildBoard(await workspaceDomain(tenantId), classes, memberRows, run.year, lastSynced, boardRows, await leadTeacherEmail(tenantId))
}
