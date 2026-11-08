// THE GOOGLE CLASSROOM ACTS THAT WRITE THE ROSTER: a new Classroom linked to roster classes (classroom-create.ts), a
// teacher's school account made and recorded on their person (teacher-account-provision.ts), and the two roster writes
// of a move the host runs: a class linked to the Classroom a move made, a person's account address recorded. Each asks
// google.write; a teacher's own account asks that the caller teach this session year, matched by the address they
// signed in with. And one read: the links a Classroom refresh names courses and members by.
import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import { may } from './access'
import type { PersonCall, Route } from './routes'
import { field, notFound, ok, result, S } from './op'
import { persons, rosterAvailableClasses, rosterEnrollments, rosterTeachers } from './tables'
import { academicYearOf } from './lib/year-context'
import { createClassroomForClasses } from './lib/classroom-create'
import { provisionTeacherAccount, sessionYearTeacher } from './lib/teacher-account-provision'

const T = '/v1/tenants/{slug}/roster'
const PROVISIONED = S.obj({ 'address?': S.str, 'sentTo?': S.str, 'notMade?': S.str })

/** The tenant's session year, by its own timezone. */
async function sessionYear(c: PersonCall): Promise<number> {
  return academicYearOf(c.tenant.id)
}

export const CLASSROOM_ROUTES: Route[] = [
  {
    method: 'POST', path: `${T}/classes/classroom`, operationId: 'classroom.create',
    summary: 'A Google Classroom made as the lead teacher and linked to the selected unassigned classes, in one act or none; off production, what was not made.',
    permission: 'google.write',
    allowed: async c => may(c.caller, 'google.write'),
    request: S.obj({ name: S.str, description: S.str, classIds: S.list(S.uuid) }),
    response: S.obj({ 'courseId?': S.str, 'notMade?': S.str }),
    handle: async c => result(await createClassroomForClasses(c.tenant.id, field.str(c.body, 'name'), field.str(c.body, 'description'),
      field.strs(c.body, 'classIds'), (c as PersonCall).actor)),
  },
  {
    method: 'PUT', path: `${T}/classes/{id}/classroom`, operationId: 'classroom.linkClass',
    summary: "A class linked to the Google Classroom course created for it.",
    permission: 'google.write',
    allowed: async c => may(c.caller, 'google.write'),
    request: S.obj({ courseId: S.str }),
    response: S.obj({}),
    handle: async c => {
      const done = await c.store.update(rosterAvailableClasses).set({ classroomCourseId: field.str(c.body, 'courseId') })
        .where(and(eq(rosterAvailableClasses.id, c.params.id), eq(rosterAvailableClasses.tenantId, c.tenant.id)))
        .returning({ id: rosterAvailableClasses.id })
      return done.length ? ok({}) : notFound('no such class in this tenant')
    },
  },
  {
    method: 'PUT', path: `${T}/persons/{id}/classroom-email`, operationId: 'classroom.recordAccount',
    summary: "A person's address on the school's Workspace, recorded once the account is created.",
    permission: 'google.write',
    allowed: async c => may(c.caller, 'google.write'),
    request: S.obj({ address: S.str }),
    response: S.obj({}),
    handle: async c => {
      const done = await c.store.update(persons).set({ classroomEmail: field.str(c.body, 'address') })
        .where(and(eq(persons.id, c.params.id), eq(persons.tenantId, c.tenant.id)))
        .returning({ id: persons.id })
      return done.length ? ok({}) : notFound('no such person in this tenant')
    },
  },
  {
    method: 'POST', path: `${T}/persons/{id}/teacher-account`, operationId: 'classroom.provision',
    summary: "A school Workspace account made for a person, recorded, and its temporary password mailed to their personal address — one act or neither; refused, with why, for a person who already has one or has no personal address.",
    permission: 'google.write',
    allowed: async c => may(c.caller, 'google.write'),
    response: PROVISIONED,
    handle: async c => {
      const pc = c as PersonCall
      return result(await provisionTeacherAccount(c.tenant.id, c.params.id, await sessionYear(pc), pc.actor))
    },
  },
  {
    method: 'POST', path: `${T}/teacher-account/mine`, operationId: 'classroom.provisionMine',
    summary: "The caller's own school Workspace account, as classroom.provision makes one, when they teach this session year.",
    permission: null, alsoAllowed: 'a teacher this session year: the person whose address is the one the caller signed in with, exactly as written',
    allowed: async () => true,
    response: PROVISIONED,
    handle: async c => {
      const pc = c as PersonCall
      const year = await sessionYear(pc)
      const me = await sessionYearTeacher(c.tenant.id, pc.caller.email, year)
      if ('error' in me) return result(me)
      return result(await provisionTeacherAccount(c.tenant.id, me.personId, year, pc.actor))
    },
  },
  {
    // What the Classroom refresh's enrichment reads to name a course and a member's
    // class. Every enrollment row, in the store's order, because a student's first row decides.
    method: 'GET', path: `${T}/classroom/links`, operationId: 'classroom.links',
    summary: "Each class linked to a Google Classroom course with that course's id, every enrollment's student and class, and the teacher rows of the linked classes.",
    permission: 'google.write',
    allowed: async c => may(c.caller, 'google.write'),
    response: S.obj({
      classes: S.list(S.obj({ id: S.uuid, courseId: S.str })),
      enrollments: S.list(S.obj({ studentId: S.uuid, classId: S.uuid })),
      teachers: S.list(S.obj({ personId: S.uuid, classId: S.uuid })),
    }),
    handle: async c => {
      const linked = await c.store.select({ id: rosterAvailableClasses.id, courseId: rosterAvailableClasses.classroomCourseId })
        .from(rosterAvailableClasses)
        .where(and(eq(rosterAvailableClasses.tenantId, c.tenant.id), isNotNull(rosterAvailableClasses.classroomCourseId)))
      const ids = linked.map(k => k.id)
      const enrollments = await c.store.select({ studentId: rosterEnrollments.studentId, classId: rosterEnrollments.classId })
        .from(rosterEnrollments).where(eq(rosterEnrollments.tenantId, c.tenant.id))
      const teachers = ids.length === 0 ? [] : await c.store.select({ personId: rosterTeachers.personId, classId: rosterTeachers.classId })
        .from(rosterTeachers).where(and(eq(rosterTeachers.tenantId, c.tenant.id), inArray(rosterTeachers.classId, ids)))
      return ok({ classes: linked.map(k => ({ id: k.id, courseId: k.courseId as string })), enrollments, teachers })
    },
  },
]
