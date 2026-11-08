import { google, jwtClient } from './google'
import { leadTeacherEmail, leadTeacherFor } from './google-school'
import { isProduction } from './host'
import { outwardAct, type Actor } from './outward-act'
import { notMade, type NotMade } from './not-made'
import { CLASSROOM_WRITE_SCOPES } from './google-scopes'
import { ports } from '../ports'

// Every write below is an outward act: recorded under `actor`, refused under view-as. Off production
// the act is a stand-in — recorded, nothing reaches Google, and the write RETURNS the statement of what it did
// not make and whom it would have reached (lib/not-made.ts).
async function classroomAct<T>(tenantId: string, actor: Actor, role: string, destination: string, real: () => Promise<{ value: T; vendorRef?: string | null }>, to: string[] = []): Promise<T | NotMade> {
  const isReal = isProduction()
  return outwardAct<T | NotMade>(
    { tenantId, kind: 'classroom', actor, role, destination, delivery: isReal ? 'real' : 'stand-in' },
    async () => (isReal ? real() : { value: notMade(`Google Classroom: ${destination}`, to) }),
  )
}

// THE GOOGLE WRITE GATE: only production writes to Google — the same gate as email. Every other environment reads
// Google as production does and writes nothing to it. Off production every write function below returns NotMade BEFORE
// any secret read or Google call — no stock id is handed back, so nothing fake is stored. The store side still writes, and the
// flow goes on past the statement, so flows remain testable end to end.

// Google Classroom API — the school's directory
// The key is the host's (the Google port) and the lead teacher the tenant's (leadTeacherFor) — no address is written here.
//
// DWD scopes authorized in Admin Console (Security → API Controls → Domain-wide Delegation):
//   classroom.courses   — create, update, archive courses
//   classroom.rosters   — add/remove teachers and students

// Every Classroom act is made as the lead teacher, the administrative contact for Google Classroom,
// read per call; the directory-admin account is for the directory's work, never Classroom's.
const SCOPES = CLASSROOM_WRITE_SCOPES   // google-scopes.ts

async function getAuth(subject: string) {
  const keyJson = await ports().google.serviceAccountKey()
  const key = JSON.parse(keyJson)
  return jwtClient({
    email: key.client_email,
    key: key.private_key,
    scopes: SCOPES,
    subject,
  })
}

/**
 * Create a Google Classroom course.
 *
 * The course's fields: its name is the short codes of the classes in the room; its section is the class's section
 * where it has one, otherwise none; its room is the current session's label (schoolYearLabel); level and subject
 * are not set.
 *
 * So the NAME is the short codes of every class that shares the room — "X2, X3"
 * — not a sentence and not the school's name. A classroom can hold several
 * teachers and several classes, so a name built from one class cannot describe
 * the room it names.
 *
 * ROOM carries the session label. The classroom universe lives one session and
 * then disappears, so the year belongs on the room rather than smuggled into
 * the course name.
 *
 * Level and subject are not sent at all: Google's API has no field for either, so they are omitted rather
 * than sent as ''.
 *
 * OWNER is the tenant's lead teacher, and the course is created AS them — no personal
 * account, only the lead teacher — whoever asks for the course.
 */
export async function createCourse(opts: {
  tenantId: string
  /** Short codes of every class in this room, already ordered. */
  name: string
  /** Our section, when the classes carry one. Omitted when they do not. */
  section?: string
  /** Session label, "YYYY–YY". */
  room: string
  actor: Actor
}): Promise<string | NotMade> {
  const owner = await leadTeacherEmail(opts.tenantId)
  return classroomAct(opts.tenantId, opts.actor, owner, `a new course '${opts.name}' (${opts.room})`, async () => {
    const auth = await getAuth(owner)
    const classroom = google.classroom({ version: 'v1', auth })
    const r = await classroom.courses.create({
      requestBody: {
        name: opts.name,
        ...(opts.section ? { section: opts.section } : {}),
        room: opts.room,
        ownerId: owner,
        // Unspecified, Google creates the course PROVISIONED: nobody can join it and the
        // refresh (ACTIVE only) never sees it.
        courseState: 'ACTIVE',
      },
    })
    return { value: r.data.id!, vendorRef: r.data.id ?? null }
  })
}

/**
 * What a student needs in order to let THEMSELVES in.
 *
 * Google refuses to add an out-of-domain student to a course at all, so a course is joined, never granted: the code and the link are the only door.
 * Both come from Google rather than being assembled here — the `cjc` link format is
 * theirs to change, and a hand-built one would break silently.
 */
export async function courseJoinInfo(tenantId: string, courseId: string): Promise<{
  enrollmentCode: string
  joinUrl: string
  alternateLink: string
}> {
  // A course not made has no id and is never asked here.
  const auth = await getAuth(await leadTeacherEmail(tenantId))
  const classroom = google.classroom({ version: 'v1', auth })
  const r = await classroom.courses.get({ id: courseId })
  const enrollmentCode = r.data.enrollmentCode ?? ''
  const alternateLink = r.data.alternateLink ?? ''
  if (!enrollmentCode) throw new Error(`course ${courseId} returned no enrollment code`)
  return {
    enrollmentCode,
    alternateLink,
    joinUrl: alternateLink ? `${alternateLink}?cjc=${enrollmentCode}` : '',
  }
}

export async function archiveCourse(tenantId: string, courseId: string, actor: Actor): Promise<void | NotMade> {
  return classroomAct(tenantId, actor, await leadTeacherFor(tenantId, isProduction()), `course ${courseId} (archived)`, async () => {
    const auth = await getAuth(await leadTeacherEmail(tenantId))
    const classroom = google.classroom({ version: 'v1', auth })
    await classroom.courses.patch({
      id: courseId,
      updateMask: 'courseState',
      requestBody: { courseState: 'ARCHIVED' },
    })
    return { value: undefined, vendorRef: courseId }
  })
}

export async function addStudent(tenantId: string, courseId: string, email: string, actor: Actor): Promise<void | NotMade> {
  return classroomAct(tenantId, actor, await leadTeacherFor(tenantId, isProduction()), `course ${courseId}: student ${email} added`, async () => {
    const auth = await getAuth(await leadTeacherEmail(tenantId))
    const classroom = google.classroom({ version: 'v1', auth })
    await classroom.courses.students.create({
      courseId,
      requestBody: { userId: email },
    })
    return { value: undefined, vendorRef: courseId }
  }, [email])
}

/**
 * REMOVALS ACT AS THE COURSE'S TEACHER, NOT THE ADMIN. Removing an outside student from a course as the admin answers
 * "The caller does not have permission" — the admin is no member of the course, and Google
 * hides external members from a non-member (a sync reads each course as its teacher for that reason). `asUser` is the account to act as — the lead teacher,
 * who owns every classroom; omitted, the lead teacher too.
 */
export async function removeStudent(tenantId: string, courseId: string, email: string, actor: Actor, asUser?: string): Promise<void | NotMade> {
  return classroomAct(tenantId, actor, asUser ?? await leadTeacherFor(tenantId, isProduction()), `course ${courseId}: student ${email} removed`, async () => {
    const auth = await getAuth(asUser ?? await leadTeacherEmail(tenantId))
    const classroom = google.classroom({ version: 'v1', auth })
    await classroom.courses.students.delete({ courseId, userId: email })
    return { value: undefined, vendorRef: courseId }
  }, [email])
}

export async function addTeacher(tenantId: string, courseId: string, email: string, actor: Actor): Promise<void | NotMade> {
  return classroomAct(tenantId, actor, await leadTeacherFor(tenantId, isProduction()), `course ${courseId}: teacher ${email} added`, async () => {
    const auth = await getAuth(await leadTeacherEmail(tenantId))
    const classroom = google.classroom({ version: 'v1', auth })
    await classroom.courses.teachers.create({
      courseId,
      requestBody: { userId: email },
    })
    return { value: undefined, vendorRef: courseId }
  }, [email])
}

/** As removeStudent: act as the course's teacher (`asUser`), not the admin. */
export async function removeTeacher(tenantId: string, courseId: string, email: string, actor: Actor, asUser?: string): Promise<void | NotMade> {
  return classroomAct(tenantId, actor, asUser ?? await leadTeacherFor(tenantId, isProduction()), `course ${courseId}: teacher ${email} removed`, async () => {
    const auth = await getAuth(asUser ?? await leadTeacherEmail(tenantId))
    const classroom = google.classroom({ version: 'v1', auth })
    await classroom.courses.teachers.delete({ courseId, userId: email })
    return { value: undefined, vendorRef: courseId }
  }, [email])
}

