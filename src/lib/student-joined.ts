// HAS THIS STUDENT JOINED THIS CLASS'S GOOGLE CLASSROOM — one answer for every screen that shows a
// student in a roster class: given <student, rosterclassid>, the map knows whether the student has
// joined the classroom, so every table that knows student and roster class shows it.
//
// ONE SOURCE, the three-universes run through lib/classroom-pending — the same reading every count of
// joins reads, so no screen can disagree with another. A screen asks
// `joinedIndex(tenantId)` once and reads `get(studentId, classId)` per cell; it computes nothing.
//
// What the answer can be, and what it is NOT:
//   joined / not-joined / missing-email / email-conflict — the run's own participant states;
//   no-classroom — the class names no Google Classroom, so there is nothing to join;
//   unknown      — the run cannot speak for this pair: another session's class, a class with no
//                  teacher or one fallen to a data error. Shown as nothing, never as "not joined".
// When the run REFUSES, `refusal` carries it and every answer is unknown — the screen states the
// refusal rather than printing blanks.
import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from './db'
import { classroomUsersByEmails } from './classroom-mirror'
import { isMissing } from './three-universes-words'
import type { RunResult } from './three-universes'
import { runThreeUniverses } from './three-universes-load'
import { participantsByClassroom, runSpeaksFor, type ParticipantState } from './classroom-pending'

export type JoinedState =
  | { state: 'joined'; photoUrl: string | null }
  | { state: Exclude<ParticipantState, 'joined'> }
  | { state: 'no-classroom' }
  | { state: 'unknown' }

export type JoinedIndex = {
  refusal: Extract<RunResult, { accepted: false }> | null
  get: (studentId: string, classId: string) => JoinedState
}

const UNKNOWN: JoinedState = { state: 'unknown' }

/** `run`: pass the run when the page already holds one — it is a whole-tenant computation. */
export async function joinedIndex(tenantId: string, given?: RunResult): Promise<JoinedIndex> {
  const run = given ?? await runThreeUniverses(tenantId)
  if (!run.accepted) return { refusal: run, get: () => UNKNOWN }

  const courseOf = new Map(run.roster.classes.map(c => [c.id, isMissing(c.classroomCourseId) ? null : c.classroomCourseId!.trim()]))
  const byCourse = participantsByClassroom(run)
  const stateOf = new Map<string, ParticipantState>()   // `${courseId} ${studentId}`
  const emailOf = new Map<string, string>()
  for (const [courseId, ps] of byCourse) {
    for (const p of ps) {
      if (p.role !== 'Student') continue
      stateOf.set(`${courseId} ${p.personId}`, p.state)
      if (p.state === 'joined' && p.email) emailOf.set(p.personId, p.email.trim().toLowerCase())
    }
  }

  // A joined student shows their Google profile photo.
  const emails = [...new Set(emailOf.values())]
  const photos = await classroomUsersByEmails(tenantId, emails)
  const photoByEmail = new Map(photos.filter(r => r.email && r.photoUrl).map(r => [r.email!.trim().toLowerCase(), r.photoUrl!]))

  return {
    refusal: null,
    get(studentId, classId) {
      if (!courseOf.has(classId)) return UNKNOWN                 // not a class of the run's session
      const courseId = courseOf.get(classId)
      if (!courseId) return { state: 'no-classroom' }
      if (!runSpeaksFor(run, courseId)) return UNKNOWN
      const s = stateOf.get(`${courseId} ${studentId}`)
      if (!s) return UNKNOWN
      if (s === 'joined') {
        const email = emailOf.get(studentId)
        return { state: 'joined', photoUrl: (email && photoByEmail.get(email)) || null }
      }
      return { state: s }
    },
  }
}

/** The answers for these pairs as plain data: keyed `${studentId}:${classId}`, unknown pairs left out, so a reader that
 *  cannot import this file (it reaches the store) reads them by their keys. */
export type JoinedRecord = Record<string, JoinedState>

export function joinedRecord(index: JoinedIndex, pairs: { studentId: string; classId: string }[]): JoinedRecord {
  const out: JoinedRecord = {}
  for (const { studentId, classId } of pairs) {
    const s = index.get(studentId, classId)
    if (s.state !== 'unknown') out[`${studentId}:${classId}`] = s
  }
  return out
}
