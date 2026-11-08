// THE ROSTER CLASSES BESIDE GOOGLE CLASSROOM: the linked classrooms and the unassigned classes, a course's roster
// classes, a member's class labels (lib/classroom-roster.ts), asked google.read, and google.write for the unassigned
// classes, which only a writer is offered.
import { may } from './access'
import type { PersonCall, Route } from './routes'
import { badRequest, field, ok, S } from './op'
import {
  unassignedClassesOfYear, classroomIdsOfYear, rosterClassesOfClassroom, rosterClassLabelParts,
} from './lib/classroom-roster'

const T = '/v1/tenants/{slug}/roster/classroom'

export const CLASSROOM_READ_ROUTES: Route[] = [
  {
    method: 'GET', path: `${T}/year/{year}`, operationId: 'classroom.year',
    summary: "The classrooms the year's roster classes point at, and — to a google.write holder — the year's classes no classroom holds yet.",
    permission: 'google.read',
    textParams: ['year'],
    allowed: async c => may(c.caller, 'google.read'),
    response: S.obj({ linked: S.list(S.nullable(S.str)), unassigned: S.list(S.obj({ id: S.uuid, shortCode: S.str, section: S.nullable(S.str) })) }),
    handle: async c => {
      const year = parseInt(c.params.year)
      if (!Number.isFinite(year)) return badRequest('year must be a number')
      const linked = (await classroomIdsOfYear(c.tenant.id, year)).map(r => r.courseId)
      const unassigned = may((c as PersonCall).caller, 'google.write') ? await unassignedClassesOfYear(c.tenant.id, year) : []
      return ok({ linked, unassigned })
    },
  },
  {
    method: 'GET', path: `${T}/courses/{courseId}/classes`, operationId: 'classroom.rosterClasses',
    summary: 'The roster classes, of any year, that point at one Google classroom, each with its live student count.',
    permission: 'google.read',
    textParams: ['courseId'],
    allowed: async c => may(c.caller, 'google.read'),
    response: S.list(S.row('a roster class: id, year, section, startTime, endTime, shortCode, students')),
    handle: async c => ok(await rosterClassesOfClassroom(c.tenant.id, c.params.courseId)),
  },
  {
    method: 'POST', path: `${T}/class-labels`, operationId: 'classroom.classLabels',
    summary: "The given roster classes' section and catalog course, and each catalog course's short code.",
    permission: 'google.read',
    allowed: async c => may(c.caller, 'google.read'),
    request: S.obj({ classIds: S.list(S.uuid) }),
    response: S.obj({ rosterClasses: S.list(S.obj({ id: S.uuid, section: S.nullable(S.str), courseId: S.nullable(S.uuid) })), catalog: S.list(S.obj({ id: S.uuid, shortCode: S.str })) }),
    handle: async c => ok(await rosterClassLabelParts(field.strs(c.body, 'classIds'))),
  },
]
