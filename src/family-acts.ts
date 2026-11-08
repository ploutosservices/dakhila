// THE ROSTER'S FAMILY ACTS, each with its who-may and the code it runs (lib/roster-family-acts.ts, or the lib function
// it calls). A form travels as its fields.
import { may } from './access'
import type { PersonCall, Route } from './routes'
import { badRequest, BodyRefused, field, mayOrOwn, ok, OWN_FAMILY, refused, result, S } from './op'
import { markPaidEnrollment } from './lib/roster-family-record'
import { enrollmentYearOf } from './lib/year-context'
import { tenantRules } from './lib/rules-context'
import { setTrackerStatus, upsertTrackerStatusUpdate } from './lib/roster-families'
import { inviteAllAwaiting, sendInvitationForFamily } from './lib/enrollment-invitation'
import { assignStudentToClass, removeClassAssignment, swapClassAssignment } from './lib/roster-class-writes'
import { markStudentDroppedOut, markStudentReenrolled } from './lib/family-enrollment'
import { createFamilyAct, deleteFamilyAct, emailCheck, isParentOf, updateFamilyAct, type FormFields } from './lib/roster-family-acts'

const T = '/v1/tenants/{slug}/roster/families'
const PARENT = "a parent (mother or father) of the family, matched by the address the caller signed in with: own-family scope, not a role"

/** The form's fields as sent; a field is a string or a list of strings. */
function fields(b: unknown): FormFields {
  const o = field.obj(field.obj(b).fields)
  for (const [k, v] of Object.entries(o)) {
    if (typeof v !== 'string' && !(Array.isArray(v) && v.every(x => typeof x === 'string'))) throw new BodyRefused(`field ${k} is not text`)
  }
  return o as FormFields
}
const FIELDS = S.obj({ fields: { type: 'object', description: "the form's fields as the door read them: each name to its text, a repeated name to its texts in order", additionalProperties: true } })

/** roster.write, or a parent of the family the call names. */
const writerOrParent = (familyId: (c: PersonCall) => string) => async (c: PersonCall) =>
  may(c.caller, 'roster.write') || isParentOf(c.tenant.id, c.caller.email, familyId(c))

const writer = async (c: PersonCall) => may(c.caller, 'roster.write')
const done = () => ok({ success: true })

/** The named body fields, each text; any empty is 'Missing parameters', asked after who-may. */
function needed<K extends string>(b: unknown, ...keys: K[]): Record<K, string> | null {
  const out = {} as Record<K, string>
  for (const k of keys) {
    const v = field.strOrNull(b, k)
    if (!v) return null
    out[k] = v
  }
  return out
}
const MISSING = refused('Missing parameters')

export const FAMILY_ACT_ROUTES: Route[] = [
  {
    method: 'POST', path: `${T}/{id}/mark-paid`, operationId: 'family.markPaidEnrollment',
    summary: "Mark a paid enrollment, as its own act: the family's enrollment for the enrollment year, pending though its fee is above nothing and paid in full, is marked enrolled. A family's reader asks it before its read; a read writes nothing.",
    permission: 'roster.read', alsoAllowed: OWN_FAMILY,
    allowed: c => mayOrOwn(c, 'roster.read', c.params.id),
    response: S.obj({ marked: S.bool }),
    handle: async c => ok({ marked: await markPaidEnrollment(c.tenant.id, c.params.id) }),
  },
  {
    method: 'POST', path: `${T}/{id}/email-check`, operationId: 'family.emailCheck',
    summary: "Who already holds an address the caller is about to save on the family: inside the family, the person's name; outside it, only that someone does. A caller who is neither a roster writer nor a parent of the family hears that the address is free.",
    permission: null, alsoAllowed: `any signed-in person; answered for roster.write or ${PARENT}`,
    allowed: async () => true,
    request: S.obj({ email: S.str, personId: S.nullable(S.str), label: S.str }),
    response: S.obj({ ok: S.bool, 'message?': S.str }),
    handle: async c => {
      const pc = c as PersonCall
      if (!may(pc.caller, 'roster.write') && !(await isParentOf(c.tenant.id, pc.caller.email, c.params.id))) return ok({ ok: true })
      return ok(await emailCheck(c.tenant.id, c.params.id, field.str(c.body, 'email'), field.strOrNull(c.body, 'personId'), field.str(c.body, 'label')))
    },
  },
  {
    method: 'POST', path: `${T}/{id}/invitations/{year}`, operationId: 'family.invite',
    summary: "One family's enrollment invitation for a year, sent. A failure answers 422 with the error's own words.",
    permission: 'roster.write', allowed: writer,
    textParams: ['year'],
    response: S.done,
    handle: async c => {
      try {
        await sendInvitationForFamily(c.tenant.id, c.params.id, Number(c.params.year), (c as PersonCall).actor)
        return done()
      } catch (e) {
        return refused(String(e))
      }
    },
  },
  {
    method: 'POST', path: `${T}/invitations/{year}`, operationId: 'family.inviteAll',
    summary: 'One invitation per family awaiting one for the year, as one batch: how many were sent and how many failed.',
    permission: 'roster.write', allowed: writer,
    textParams: ['year'],
    response: S.obj({ sent: S.num, errors: S.num }),
    handle: async c => {
      const year = Number(c.params.year)
      if (!Number.isInteger(year)) return badRequest('year must be a whole number')
      return ok(await inviteAllAwaiting(c.tenant.id, year, (c as PersonCall).actor))
    },
  },
  {
    method: 'DELETE', path: `${T}/{id}`, operationId: 'family.delete',
    summary: 'Remove a family and every person in it; refused, with what holds it, when anything still refers to them.',
    permission: 'tenant.delete',
    allowed: async c => may(c.caller, 'tenant.delete'),
    response: S.obj({ persons: S.num }),
    handle: async c => result(await deleteFamilyAct(c.tenant.id, c.params.id)),
  },
  {
    method: 'PUT', path: `${T}/{id}/tracker/{year}`, operationId: 'family.setTrackerStatus',
    summary: "The family's tracker status for a year. Registered is derived from payment and is never set here: asked, nothing changes.",
    permission: 'roster.write',
    textParams: ['year'],
    allowed: writer,
    request: S.obj({ status: S.num }),
    response: S.done,
    handle: async c => {
      const year = Number(c.params.year)
      if (!Number.isInteger(year)) return badRequest('year must be a whole number')
      const status = field.num(c.body, 'status')
      if (status !== (await tenantRules(c.tenant.id)).codes.enrollmentStatus.registered) await setTrackerStatus(c.tenant.id, c.params.id, year, status)
      return done()
    },
  },
  {
    method: 'POST', path: `${T}/{id}/tracker`, operationId: 'family.addToTracker',
    summary: 'Put the family on the enrollment year\'s tracker as invited.',
    permission: 'roster.write', alsoAllowed: PARENT,
    allowed: writerOrParent(c => c.params.id),
    response: S.done,
    handle: async c => {
      const { invited } = (await tenantRules(c.tenant.id)).codes.enrollmentStatus
      await upsertTrackerStatusUpdate(c.tenant.id, c.params.id, await enrollmentYearOf(c.tenant.id), invited)
      return done()
    },
  },
  {
    method: 'POST', path: T, operationId: 'family.create',
    summary: 'A new family: its parents, the family and its children, from the family fields.',
    permission: 'roster.write',
    allowed: writer,
    request: FIELDS,
    response: S.obj({ familyId: S.uuid }),
    handle: async c => result(await createFamilyAct(c.tenant.id, fields(c.body))),
  },
  {
    method: 'PUT', path: `${T}/{id}`, operationId: 'family.update',
    summary: "The family saved whole from the family fields: parents, address and children; a child left out of the fields is removed. The history names the caller as editor.",
    permission: 'roster.write', alsoAllowed: PARENT,
    allowed: writerOrParent(c => c.params.id),
    request: FIELDS,
    response: S.obj({ familyId: S.uuid }),
    handle: async c => result(await updateFamilyAct(c.tenant.id, c.params.id, (c as PersonCall).caller.userId, fields(c.body))),
  },
  {
    method: 'POST', path: `${T}/class-assignments`, operationId: 'family.assignClass',
    summary: 'A student put in a class.',
    permission: 'roster.write', allowed: writer,
    request: S.obj({ studentId: S.str, classId: S.str }),
    response: S.done,
    handle: async c => {
      const b = needed(c.body, 'studentId', 'classId')
      if (!b) return MISSING
      await assignStudentToClass(c.tenant.id, b.studentId, b.classId)
      return done()
    },
  },
  {
    method: 'POST', path: `${T}/class-assignments/remove`, operationId: 'family.removeClass',
    summary: 'A class assignment removed.',
    permission: 'roster.write', allowed: writer,
    request: S.obj({ enrollmentId: S.str }),
    response: S.done,
    handle: async c => {
      const b = needed(c.body, 'enrollmentId')
      if (!b) return MISSING
      await removeClassAssignment(c.tenant.id, b.enrollmentId)
      return done()
    },
  },
  {
    method: 'POST', path: `${T}/class-assignments/swap`, operationId: 'family.changeLanguageClass',
    summary: "A student's language class changed: one assignment removed, another made.",
    permission: 'roster.write', allowed: writer,
    request: S.obj({ removeEnrollmentId: S.str, studentId: S.str, newClassId: S.str }),
    response: S.done,
    handle: async c => {
      const b = needed(c.body, 'removeEnrollmentId', 'studentId', 'newClassId')
      if (!b) return MISSING
      await swapClassAssignment(c.tenant.id, b.removeEnrollmentId, b.studentId, b.newClassId)
      return done()
    },
  },
  {
    method: 'POST', path: `${T}/enrollment-students/dropout`, operationId: 'family.dropoutStudent',
    summary: 'An enrolled student marked dropped out.',
    permission: 'roster.write', allowed: writer,
    request: S.obj({ enrollmentStudentId: S.str }),
    response: S.done,
    handle: async c => {
      const b = needed(c.body, 'enrollmentStudentId')
      if (!b) return MISSING
      await markStudentDroppedOut(c.tenant.id, b.enrollmentStudentId)
      return done()
    },
  },
  {
    method: 'POST', path: `${T}/enrollment-students/reenroll`, operationId: 'family.reenrollStudent',
    summary: 'A dropped-out student enrolled again.',
    permission: 'roster.write', allowed: writer,
    request: S.obj({ enrollmentStudentId: S.str }),
    response: S.done,
    handle: async c => {
      const b = needed(c.body, 'enrollmentStudentId')
      if (!b) return MISSING
      await markStudentReenrolled(c.tenant.id, b.enrollmentStudentId)
      return done()
    },
  },
]
