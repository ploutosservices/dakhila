// THE CLASSES AND THEIR TEACHERS, WRITTEN: three acts on classes and three on teachers (lib/roster-class-writes.ts),
// asked roster.write, and roster.delete to delete a class. A refusal the function threw comes back in its words.
import { may } from './access'
import type { PersonCall, Route } from './routes'
import { field, ok, refused, S } from './op'
import { tenantCatalogCourseExists } from './lib/roster-classes'
import {
  createClass, setClassSection, deleteEmptyClass, assignTeacherToClasses, setTeacherTypeInClasses, removeTeacherFromClasses,
} from './lib/roster-class-writes'
import { isTeacherType } from './lib/teacher-type'

const T = '/v1/tenants/{slug}/roster/classes'
const thrown = (e: unknown) => refused(e instanceof Error ? e.message : String(e))

export const CLASS_ROUTES: Route[] = [
  {
    method: 'POST', path: T, operationId: 'class.create',
    summary: "A class of a catalog course for a year, its times from the course's department's rule.",
    permission: 'roster.write',
    allowed: async c => may(c.caller, 'roster.write'),
    request: S.obj({ courseId: S.uuid, year: S.num, section: S.nullable(S.str) }),
    response: S.obj({ id: S.uuid }),
    handle: async c => {
      const courseId = field.str(c.body, 'courseId')
      if (!(await tenantCatalogCourseExists(c.tenant.id, courseId))) return refused('Course not found')
      try {
        return ok({ id: await createClass(c.tenant.id, { courseId, year: field.num(c.body, 'year'), section: field.strOrNull(c.body, 'section') }) })
      } catch (e) { return thrown(e) }
    },
  },
  {
    method: 'PUT', path: `${T}/{id}/section`, operationId: 'class.setSection',
    summary: "A class's section set, or cleared with null.",
    permission: 'roster.write',
    allowed: async c => may(c.caller, 'roster.write'),
    request: S.obj({ section: S.nullable(S.str) }),
    response: S.obj({}),
    handle: async c => {
      await setClassSection(c.tenant.id, c.params.id, field.strOrNull(c.body, 'section'))
      return ok({})
    },
  },
  {
    method: 'DELETE', path: `${T}/{id}`, operationId: 'class.delete',
    summary: 'A current-session class that never had a child removed, its Google Classroom archived first; refused, with why, otherwise.',
    permission: 'roster.delete',
    allowed: async c => may(c.caller, 'roster.delete'),
    response: S.obj({ year: S.num, 'notMade?': S.str }),
    handle: async c => {
      try { return ok(await deleteEmptyClass(c.tenant.id, c.params.id, (c as PersonCall).actor)) } catch (e) { return thrown(e) }
    },
  },
  {
    method: 'POST', path: `${T}/teachers/{id}/assign`, operationId: 'class.assignTeacher',
    summary: 'A person made a teacher, of the type given, of each class that does not already have them.',
    permission: 'roster.write',
    allowed: async c => may(c.caller, 'roster.write'),
    request: S.obj({ classIds: S.list(S.uuid), typeOfTeacher: S.str }),
    response: S.obj({}),
    handle: async c => {
      const type = field.str(c.body, 'typeOfTeacher')
      if (!isTeacherType(type)) return refused('Unknown teacher type')
      await assignTeacherToClasses(c.tenant.id, field.strs(c.body, 'classIds'), c.params.id, type)
      return ok({})
    },
  },
  {
    method: 'POST', path: `${T}/teachers/{id}/type`, operationId: 'class.setTeacherType',
    summary: 'What a person is — lead, regular or backup — in each of the classes.',
    permission: 'roster.write',
    allowed: async c => may(c.caller, 'roster.write'),
    request: S.obj({ classIds: S.list(S.uuid), typeOfTeacher: S.str }),
    response: S.obj({}),
    handle: async c => {
      const type = field.str(c.body, 'typeOfTeacher')
      if (!isTeacherType(type)) return refused('Unknown teacher type')
      await setTeacherTypeInClasses(c.tenant.id, field.strs(c.body, 'classIds'), c.params.id, type)
      return ok({})
    },
  },
  {
    method: 'POST', path: `${T}/teachers/{id}/remove`, operationId: 'class.removeTeacher',
    summary: 'A person taken off each of the classes as teacher.',
    permission: 'roster.write',
    allowed: async c => may(c.caller, 'roster.write'),
    request: S.obj({ classIds: S.list(S.uuid) }),
    response: S.obj({}),
    handle: async c => {
      await removeTeacherFromClasses(field.strs(c.body, 'classIds'), c.params.id)
      return ok({})
    },
  },
]
