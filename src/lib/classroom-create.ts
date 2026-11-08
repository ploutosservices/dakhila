// A NEW GOOGLE CLASSROOM FOR ROSTER CLASSES — created at Google as the lead teacher and linked to the selected
// classes in one act or none. The caller decides who may.
import { CLASSROOM_CREATE_SCOPES } from './google-scopes'
import { google, jwtClient } from './google'
import type { classroom_v1 } from 'googleapis'
import { db } from './db'
import { rosterAvailableClasses } from '../tables'
import { keepCourse } from './classroom-mirror'
import { leadTeacherFor } from './google-school'
import { eq, and, inArray, isNull } from 'drizzle-orm'
import { schoolYearLabel } from './enrollment'
import { enrollmentYearOf } from './year-context'
import { isProduction, now } from './host'
import { outwardAct, type Actor } from './outward-act'
import { notMade, isNotMade, type NotMade } from './not-made'
import { ports } from '../ports'

// The email that owns a classroom is gated by Google — the lead teacher's address
// (the tenant's, leadTeacherEmail()) is creator/owner. May be changed to another
// school address after the fact.
async function getClassroomClient(owner: string) {
  const key = JSON.parse(await ports().google.serviceAccountKey())
  const auth = jwtClient({
    email: key.client_email,
    key: key.private_key,
    scopes: CLASSROOM_CREATE_SCOPES,
    subject: owner,
  })
  return google.classroom({ version: 'v1', auth })
}

// Create a Google Classroom and link the selected roster classes to it.
// One classroom can contain more than one roster class; a roster class can be
// associated with only one classroom (guarded here and by the null-check update).
// Atomic: preconditions are checked before the Google call; if the DB linking
// step fails after the course exists at Google, the course is archived and the
// DB is left untouched.
export async function createClassroomForClasses(
  tenantId: string,
  name: string,
  description: string,
  classIds: string[],
  actor: Actor,
): Promise<{ courseId?: string; notMade?: string; error?: string }> {
  if (!name.trim()) return { error: 'Name is required' }
  if (classIds.length === 0) return { error: 'Select at least one class' }

  // Precondition: every selected class exists, belongs to this tenant, and is unassigned.
  const selected = await db
    .select({ id: rosterAvailableClasses.id, courseId: rosterAvailableClasses.classroomCourseId })
    .from(rosterAvailableClasses)
    .where(and(
      eq(rosterAvailableClasses.tenantId, tenantId),
      inArray(rosterAvailableClasses.id, classIds),
    ))
  if (selected.length !== classIds.length) return { error: 'A selected class was not found' }
  const taken = selected.filter(c => c.courseId !== null)
  if (taken.length > 0) return { error: 'A selected class is already assigned to a classroom' }

  const year = await enrollmentYearOf(tenantId)
  const room = schoolYearLabel(year)
  // Descriptions derived when not specified — same as name by default.
  const desc = description.trim() || name.trim()

  // GOOGLE WRITES ARE PRODUCTION-ONLY: ungated, a real course would be made at Google from any
  // environment holding the school's key. Off production nothing is
  // created and nothing is linked; the answer is the statement of what was not made (lib/not-made.ts).
  // An outward act: recorded under `actor`, refused under view-as; off production a stand-in.
  const real = isProduction()
  const OWNER = await leadTeacherFor(tenantId, real)
  const created = await outwardAct<{ classroom: Awaited<ReturnType<typeof getClassroomClient>>; course: classroom_v1.Schema$Course } | NotMade>(
    { tenantId, kind: 'classroom', actor, role: OWNER, destination: `a new course '${name.trim()}' for ${classIds.length} class(es)`, delivery: real ? 'real' : 'stand-in' },
    async () => {
      if (!real) return { value: notMade(`Google Classroom: a new course '${name.trim()}' owned by ${OWNER} for ${classIds.length} class(es)`) }
      const classroom = await getClassroomClient(OWNER)
      const res = await classroom.courses.create({
        requestBody: {
          name: name.trim(),
          descriptionHeading: name.trim(),
          description: desc,
          room,
          ownerId: OWNER,
          courseState: 'ACTIVE',
        },
      })
      return { value: { classroom, course: res.data }, vendorRef: res.data.id ?? null }
    },
  )
  if (isNotMade(created)) return { notMade: created.statement }
  const { classroom, course } = created
  if (!course.id) return { error: 'Classroom created but returned no ID' }
  const courseId = course.id

  try {
    await db.transaction(async (tx) => {
      await keepCourse(tx, {
        id:             courseId,
        tenantId:       tenantId,
        name:           course.name ?? name,
        subject:        course.subject ?? null,
        section:        course.section ?? null,
        room:           course.room ?? room,
        courseState:    course.courseState ?? 'ACTIVE',
        enrollmentCode: course.enrollmentCode ?? null,
        ownerId:        course.ownerId ?? OWNER,
        teacherGroupEmail: course.teacherGroupEmail ?? null,
        courseGroupEmail:  course.courseGroupEmail ?? null,
        calendarId:     course.calendarId ?? null,
        alternateLink:  course.alternateLink ?? null,
        creationTime:   course.creationTime ? new Date(course.creationTime) : null,
        updateTime:     course.updateTime ? new Date(course.updateTime) : null,
        rawJson:        course,
        syncedAt:       now(),
      })

      // Null-guard repeats the precondition inside the transaction: a class that
      // was grabbed by a concurrent create stays untouched and fails the count.
      const updated = await tx.update(rosterAvailableClasses)
        .set({ classroomCourseId: courseId })
        .where(and(
          eq(rosterAvailableClasses.tenantId, tenantId),
          inArray(rosterAvailableClasses.id, classIds),
          isNull(rosterAvailableClasses.classroomCourseId),
        ))
        .returning({ id: rosterAvailableClasses.id })
      if (updated.length !== classIds.length) {
        throw new Error('A selected class was assigned to another classroom mid-flight')
      }
    })
  } catch (linkError) {
    // The course exists at Google but nothing was linked — archive it so no
    // half-created classroom survives (whole thing works or nothing works).
    await outwardAct(
      { tenantId, kind: 'classroom', actor, role: OWNER, destination: `course ${courseId} (archived: its classes could not be linked)`, delivery: 'real' },
      async () => {
        await classroom.courses.patch({
          id: courseId,
          updateMask: 'courseState',
          requestBody: { courseState: 'ARCHIVED' },
        })
        return { value: undefined, vendorRef: courseId }
      },
    ).catch(() => {})
    return { error: String(linkError) }
  }

  return { courseId }
}
