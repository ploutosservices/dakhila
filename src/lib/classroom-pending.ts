// WHO BELONGS IN EACH CLASSROOM, AND WHO HAS NOT JOINED — read from the three-universes run, the one
// place that knows it. Every count of joined and pending members, every list of a classroom's participants and
// every list of members Google holds that the roster places nobody for reads this, so none can disagree.
//
// No reader keeps a roster of its own for a classroom: one knowing only the roster classes linked to
// it knows nobody on the school board, and would offer to remove every parent, child and teacher there.
//
// A participant is someone the roster places in the classroom:
//   - a projected row — joined when Google holds it, else not joined;
//   - a student the run dropped for having no address, or for sharing one: they still have not joined, and
//     someone has to follow up with them;
//   - a teacher the run dropped for having no school address, on the same reasoning.
// Pending is every participant not joined. Someone Google holds that the roster does not place is an
// EXTRA — removing them is the administrator's task, never a pending join (gridToDoCount in family-grid.ts counts the same way).

import { isMissing, type RunResult } from './three-universes'

type AcceptedRun = Extract<RunResult, { accepted: true }>

export type ParticipantState = 'joined' | 'not-joined' | 'missing-email' | 'email-conflict'
export type Participant = { personId: string; role: 'Teacher' | 'Student'; email: string | null; state: ParticipantState }
export type Extra = { email: string; role: 'Teacher' | 'Student' }
export type PendingCounts = { Teacher: number; Student: number }

const asRole = (r: string): 'Teacher' | 'Student' => (r === 'Teacher' ? 'Teacher' : 'Student')

/** Every classroom's participants, one per person and role, keyed by the trimmed Google course id. */
export function participantsByClassroom(run: AcceptedRun): Map<string, Participant[]> {
  const seen = new Set<string>()
  const out = new Map<string, Participant[]>()
  const add = (courseId: string, p: Participant) => {
    const key = `${courseId}\u0000${p.role}\u0000${p.personId}`
    if (seen.has(key)) return
    seen.add(key)
    out.set(courseId, [...(out.get(courseId) ?? []), p])
  }

  for (const g of run.gap) {
    if (!g.projection) continue
    for (const f of g.projection.facts) {
      add(g.courseId, { personId: f.personId, role: g.projection.role, email: g.email, state: g.match ? 'joined' : 'not-joined' })
    }
  }

  // The classes the run projects from: taught, not fallen to (6), with a classroom id.
  const taught = new Set(run.roster.teacherAssignments.map(t => t.classId))
  const fallen = new Set(run.dataErrors.map(d => d.class.id))
  const courseOf = new Map(run.roster.classes
    .filter(c => taught.has(c.id) && !fallen.has(c.id) && !isMissing(c.classroomCourseId))
    .map(c => [c.id, c.classroomCourseId!.trim()]))

  const noEmail = new Set(run.noEmail.map(r => r.participant.id))
  const collided = new Map(run.collisions.map(r => [r.participant.id, r.email]))
  for (const a of run.roster.studentAssignments) {
    const courseId = courseOf.get(a.classId)
    if (!courseId) continue
    if (noEmail.has(a.studentId)) add(courseId, { personId: a.studentId, role: 'Student', email: null, state: 'missing-email' })
    else if (collided.has(a.studentId)) add(courseId, { personId: a.studentId, role: 'Student', email: collided.get(a.studentId)!, state: 'email-conflict' })
  }

  const noClassroomEmail = new Set(run.noClassroomEmail.map(r => r.teacher.id))
  for (const t of run.roster.teacherAssignments) {
    const courseId = courseOf.get(t.classId)
    if (courseId && noClassroomEmail.has(t.personId)) add(courseId, { personId: t.personId, role: 'Teacher', email: null, state: 'missing-email' })
  }

  return out
}

/**
 * THE ROOMS THE RUN CANNOT SPEAK FOR — by its own two rules, and the reason this lives here.
 *
 *   section 2  noTeachers  a class with no teachers never enters the SELECT
 *   section 6  dataErrors  the cliff: a class carrying a defective fact FALLS, students included
 *
 * Either way there is no projection for that class's room, so EVERY member Google holds there looks
 * like somebody the roster places nobody for. They are not extras; the run declined to say.
 *
 * WHY IT IS HERE AND NOT ON THE SCREENS. Written on one screen, the rule misses another: a screen would call a parent
 * "not on the roster" whose child is enrolled in that class with `guardian` pointing at the parent — precisely the
 * address that represents the child there. So it sits in the one function every caller goes through.
 */
function unspokenRooms(run: AcceptedRun): Set<string> {
  return new Set([...run.noTeachers, ...run.dataErrors]
    .map(r => (r.class.classroomCourseId ?? '').trim())
    .filter(Boolean))
}

/** Who Google holds in the classroom that the roster places nobody on — and nobody at all in a room
 *  the run cannot speak for, because there the question has no answer rather than the answer "all of
 *  them". */
export function extrasOf(run: AcceptedRun, courseId: string): Extra[] {
  if (unspokenRooms(run).has(courseId.trim())) return []
  return run.gap
    .filter(g => g.courseId === courseId.trim() && g.snapshot && !g.projection)
    .map(g => ({ email: g.email, role: asRole(g.role) }))
}

/** Whether the run has anything to say about this room at all — so a screen can say "the check could
 *  not read this class" instead of rendering an empty table that reads as "nothing to do". */
export function runSpeaksFor(run: AcceptedRun, courseId: string): boolean {
  return !unspokenRooms(run).has(courseId.trim())
}

export function pendingByClassroom(run: AcceptedRun): Map<string, PendingCounts> {
  const out = new Map<string, PendingCounts>()
  for (const [courseId, ps] of participantsByClassroom(run)) {
    const c = { Teacher: 0, Student: 0 }
    for (const p of ps) if (p.state !== 'joined') c[p.role] += 1
    if (c.Teacher + c.Student > 0) out.set(courseId, c)
  }
  return out
}
