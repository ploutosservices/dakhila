// THE TEACHER CARD — the family card's counterpart, for the person who teaches.
//
// A teacher has a list of classrooms, meet ids, timings and a list of students in each
// classroom and its roster class: one set of data, presented as the family card is, with a link to the roster for
// more.
//
// THREE LEVELS: teacher -> classroom -> students. A teacher can have multiple classrooms and
// a classroom can have multiple students. The middle level is the CLASSROOM, not the roster class: a teacher's
// three classes in one Google classroom sharing one Meet are one entry, the roster classes it covers are named inside
// it, and its students are listed once.
//
// A roster class with no Google classroom yet is still a classroom in this tree — it simply has
// no Google id, no Meet and no join state. It comes back as its own entry with
// classroomCourseId null, rather than being dropped or merged with another.
//
// ONE SOURCE for "has this student joined": the three-universes run, the same reading every
// other count of joins reads (lib/classroom-pending). A student with no
// address or a shared one reads as not joined — it means the school has to follow
// up with them — rather than being quietly absent. The roster's own enrolment list is what
// decides WHO is in the classroom, so a classroom with no Google course still lists its
// students; `joined` is then null, because nothing has been asked of Google about them.

import type { TeacherType } from './teacher-type'
import { db } from './db'
import { persons } from '../tables'
import { courseMembers } from './classroom-mirror'
import { and, eq } from 'drizzle-orm'
import { teacherClassroomAddress } from './teacher-classroom-address'
import { getTeacherSchedule, getClassStudents } from './roster-classes'
import { rosterClassCode } from './roster-class-code'
import { participantsByClassroom, type Participant } from './classroom-pending'
import { runThreeUniverses } from './three-universes-load'
import { workspaceDomain } from './role-mailbox'
import { hostPage } from './host'

export type TeacherCardStudent = {
  personId: string
  name: string
  /** The address the roster holds for them; null when they have none. */
  email: string | null
  /** In the Google classroom — null when the classroom has no Google course to join. */
  joined: boolean | null
  /** Why a false is false, when the run has something to say. */
  state: Participant['state'] | null
  /** The name Google shows for them in the classroom — null until they join, or when Google
   *  holds no name. The roster's `name` is what the school calls them; this is what the
   *  teacher sees on the screen, and the two differ ("Ann Example" / "Ann E."). */
  screenName: string | null
  /** The roster classes of this classroom the student is in — a classroom can cover several. */
  classIds: string[]
}

/** A roster class covered by the classroom. Several can share one Google classroom. */
export type TeacherCardRosterClass = {
  classId: string
  /** The roster class's short form, section included — "X2B". */
  code: string
  fullName: string | null
  section: string | null
  department: string | null
  /** Whether the teacher leads the class; derived from typeOfTeacher, the one stored fact. */
  isLead: boolean
  /** lead | regular | backup. */
  typeOfTeacher: TeacherType
  startTime: string | null
  endTime: string | null
  /** Where the teacher goes for everything the card does not carry. */
  rosterClassUrl: string
}

export type TeacherCardClassroom = {
  /** Google's course id, or null for a roster class with no Google classroom yet. */
  classroomCourseId: string | null
  meet: string | null
  meetUrl: string | null
  classroomUrl: string | null
  rosterClasses: TeacherCardRosterClass[]
  students: TeacherCardStudent[]
}

export type TeacherCard = {
  teacher: boolean
  /** The teacher's school-domain address — the account they must switch to in Google. */
  classroomEmail: string | null
  /** null when the roster's Google reading was refused — joined is then null on every student. */
  runAccepted: boolean | null
  classrooms: TeacherCardClassroom[]
}

/**
 * GROUP A TEACHER'S CLASSES BY CLASSROOM — the middle level of the tree.
 *
 * Several roster classes may share one Google classroom (one course with one Meet), so the classroom is the group and the classes are its members. A class
 * with NO Google classroom is its own group keyed by its class id: two unlinked classes are two
 * classrooms that do not exist in Google yet, never one merged null group.
 *
 * Pure, so the shape can be drilled without a teacher who happens to have the right data.
 */
export function classroomGroups<T extends { classId: string; classroomCourseId: string | null }>(
  rows: T[],
): { courseId: string | null; rows: T[] }[] {
  const groups = new Map<string, T[]>()
  for (const c of rows) {
    const key = c.classroomCourseId?.trim() || `class:${c.classId}`
    groups.set(key, [...(groups.get(key) ?? []), c])
  }
  return [...groups.values()].map(rs => ({ courseId: rs[0].classroomCourseId?.trim() || null, rows: rs }))
}

export async function getTeacherCard(
  tenantId: string,
  personId: string,
  year: number,
  rosterUrl: string,
): Promise<TeacherCard> {
  const schedule = await getTeacherSchedule(tenantId, personId, year)
  if (schedule.length === 0) return { teacher: false, classroomEmail: null, runAccepted: null, classrooms: [] }

  // THE CLASSROOM ADDRESS IS ONE FACT (the address a teacher is told to switch to in Google).
  // Through teacherClassroomAddress(), the one reader — a primary address in the teacher
  // domain IS the classroom address, and no caller derives it from a name.
  const [row] = await db
    .select({ email: persons.email, classroomEmail: persons.classroomEmail })
    .from(persons)
    .where(eq(persons.id, personId))
    .limit(1)
  const classroomEmail = row ? teacherClassroomAddress(row, await workspaceDomain(tenantId)) : null

  // Asked once for the whole card, not once per classroom.
  const run = await runThreeUniverses(tenantId)
  const byClassroom = run.accepted ? participantsByClassroom(run) : null

  const classrooms: TeacherCardClassroom[] = []
  for (const { courseId, rows } of classroomGroups(schedule)) {
    const participants = courseId && byClassroom
      ? (byClassroom.get(courseId) ?? []).filter(p => p.role === 'Student')
      : []
    const byPerson = new Map(participants.map(p => [p.personId, p]))

    // THE SCREEN NAME. Google's own name for the member, from the
    // classroom's member snapshot keyed by address — the fullName Google shows beside the
    // roster name. Only a member has one, so it is null
    // for anyone who has not joined.
    const members = courseId ? await courseMembers(tenantId, courseId) : []
    const screenNameOf = new Map(members
      .filter(m => m.emailAddress)
      .map(m => [m.emailAddress!.trim().toLowerCase(), m.fullName ?? null]))

    // One student, one row, however many of this classroom's roster classes they sit in.
    const students = new Map<string, TeacherCardStudent>()
    for (const c of rows) {
      for (const s of await getClassStudents(tenantId, c.classId)) {
        const seen = students.get(s.personId)
        if (seen) { seen.classIds.push(c.classId); continue }
        const p = byPerson.get(s.personId)
        students.set(s.personId, {
          personId: s.personId,
          name: [s.firstName, s.lastName].filter(Boolean).join(' '),
          // THE RUN'S ADDRESS FIRST. A child's persons.email may be empty when the child is
          // written to through a guardian, and the run is what resolves that (the guardian pointer).
          // Taking the column would publish "no address" for every child who has one
          // through a parent.
          email: p?.email ?? s.email ?? null,
          joined: courseId && byClassroom ? (p ? p.state === 'joined' : false) : null,
          state: p?.state ?? null,
          screenName: screenNameOf.get((p?.email ?? s.email ?? '').trim().toLowerCase()) ?? null,
          classIds: [c.classId],
        })
      }
    }

    classrooms.push({
      classroomCourseId: courseId,
      meet: rows[0].meet ?? null,
      meetUrl: rows[0].meet ? `https://meet.google.com/${rows[0].meet}` : null,
      classroomUrl: courseId ? `https://classroom.google.com/c/${courseId}` : null,
      rosterClasses: rows.map(c => ({
        classId: c.classId,
        code: rosterClassCode({ shortCode: c.shortCode, section: c.section }),
        fullName: c.fullName ?? null,
        section: c.section ?? null,
        department: c.department ?? null,
        isLead: c.typeOfTeacher === 'lead',
        typeOfTeacher: c.typeOfTeacher,
        startTime: c.startTime ?? null,
        endTime: c.endTime ?? null,
        rosterClassUrl: `${rosterUrl}${hostPage('class', c.classId)}`,
      })),
      students: [...students.values()],
    })
  }

  return { teacher: true, classroomEmail, runAccepted: run.accepted, classrooms }
}
