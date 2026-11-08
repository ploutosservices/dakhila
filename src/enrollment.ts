// ENROLLMENT. The enrollment list, one family's enrollment, and the fourteen acts beside them, each with its who-may.
// The host keeps its session, its form and its words; this answers with data.
import { may } from './access'
import type { Route } from './routes'
import { badRequest, field, mayOrOwn, notFound, ok, OWN_FAMILY, refused, result, S } from './op'
import { enrollmentYearOf } from './lib/year-context'
import { tenantRules } from './lib/rules-context'
import {
  trackerRowsWithStatus, enrollmentsOfYear, familiesWithParents, tenantFamilyRow, parentsInOrder, familyChildrenByName,
  enrollmentPayments, familyNames,
} from './lib/enrollment-reads'
import { personNames } from './lib/person-names'
import { owedAndPaid, owedAndPaidOf } from './lib/tuition-owed-store'
import { tuitionDifferences } from './lib/tuition-differences'
import {
  cancelEnrollment, getEnrollment, getEnrolledStudentIds, getEnrollmentStudents, setEnrollmentStatus,
} from './lib/family-enrollment'
import {
  optOutFamilyEnrollment, familyEnrollmentId, saveFamilyEnrollment, recordZelleEnrollmentPayment,
  deleteManualEnrollmentPayment, recordManualPaypalEnrollmentPayment, setEnrollmentPaymentDate,
  setEnrollmentPaymentProcessingFee, sendEnrollmentReminderMail, sendNotStartedReminderMail,
  enrollmentForZelleCheck, unappliedIncomingPayments,
} from './lib/family-enrollment-writes'
import { bookFamilyMoney } from './lib/family-money'
import { checkZelleForFamily } from './lib/zelle'
import { isoDayIn } from './lib/zoned'
import { zelleTo, paypalCode } from './lib/zelle-to'


const T = '/v1/tenants/{slug}'
const FAMILY = `${T}/enrollment/families/{id}`
const familyIdOf = (r: { familyId: string }) => ({ familyId: r.familyId })
const withFamily = S.obj({ familyId: S.uuid })

export const ENROLLMENT_ROUTES: Route[] = [
  // ---- reads
  {
    method: 'GET', path: `${T}/enrollment`, operationId: 'enrollment.list',
    summary: "The enrollment year's list: the tracker's expected families, the year's enrollments, the families and their parents' names, what each enrollment owes and has paid, and the tuition reconciliation's rows.",
    permission: 'enrollment.read',
    allowed: async c => may(c.caller, 'enrollment.read'),
    response: S.obj({
      year: S.num,
      trackerRows: S.list(S.obj({ familyId: S.uuid, enrollmentStatus: S.nullable(S.num), registrationDate: S.nullable(S.str) })),
      enrollments: S.list(S.obj({ id: S.uuid, familyId: S.nullable(S.uuid), status: S.nullable(S.str), createdAt: S.dateTime })),
      families: S.list(S.obj({ id: S.uuid, legacyFamilyId: S.nullable(S.num), motherId: S.nullable(S.uuid), fatherId: S.nullable(S.uuid) })),
      parents: S.list(S.obj({ id: S.uuid, firstName: S.str, lastName: S.nullable(S.str) })),
      money: S.list(S.obj({ enrollmentId: S.uuid, owed: S.num, paid: S.num, counted: S.num, firstPaid: S.nullable(S.dateTime) })),
      differ: S.list(S.obj({ familyId: S.uuid, status: S.str, firstPaid: S.nullable(S.dateTime), studentCount: S.num, fee: S.num, paid: S.num })),
      differNames: S.list(S.obj({ id: S.uuid, legacyFamilyId: S.nullable(S.num), mother: S.nullable(S.str), father: S.nullable(S.str) })),
    }),
    handle: async c => {
      const year = await enrollmentYearOf(c.tenant.id)
      // The tracker statuses the list counts as expected to enroll: the school's live set.
      const live = (await tenantRules(c.tenant.id)).codes.enrollmentStatus.live
      const trackerRows = await trackerRowsWithStatus(c.tenant.id, year, live)
      const enrollments = await enrollmentsOfYear(c.tenant.id, year)
      const families = await familiesWithParents(c.tenant.id, trackerRows.map(r => r.familyId))
      const parents = await personNames([...new Set(families.flatMap(f => [f.motherId, f.fatherId].filter(Boolean) as string[]))])
      const money = await owedAndPaid(enrollments.map(e => e.id))
      const differ = await tuitionDifferences(c.tenant.id, year)
      return ok({
        year, trackerRows, enrollments, families, parents,
        money: [...money].map(([enrollmentId, m]) => ({ enrollmentId, ...m })),
        differ,
        differNames: await familyNames(c.tenant.id, differ.map(d => d.familyId)),
      })
    },
  },
  {
    method: 'GET', path: FAMILY, operationId: 'enrollment.family',
    summary: "One family's enrollment for the enrollment year: the family, its parents and children, the enrollment, its students, payments and fee, where a payer sends money, and what the caller may do here.",
    permission: 'enrollment.read', alsoAllowed: OWN_FAMILY,
    allowed: c => mayOrOwn(c, 'enrollment.read', c.params.id),
    response: S.obj({
      year: S.num,
      may: S.obj({ read: S.bool, write: S.bool }),
      family: S.obj({ id: S.uuid, legacyFamilyId: S.nullable(S.num), motherId: S.nullable(S.uuid), fatherId: S.nullable(S.uuid) }),
      parents: S.list(S.obj({ id: S.uuid, firstName: S.str, lastName: S.nullable(S.str), role: S.nullable(S.str) })),
      children: S.list(S.obj({ id: S.uuid, firstName: S.str, lastName: S.nullable(S.str), firstGradeYear: S.nullable(S.num) })),
      enrollment: S.nullable(S.row('the family_enrollments row')),
      enrolledStudentIds: S.list(S.uuid),
      payments: S.list(S.row('a cash_enrollment_payments row (id, amount, method, paypalOrderId, notes, processingFee, paidAt, referenceId, createdAt)')),
      fee: S.num,
      droppedOutAt: S.list(S.dateTime),
      zelle: { type: 'object', description: 'where a payer sends Zelle money, or the sentence saying the tenant declares none (src/lib/zelle-to.ts)' },
      paypal: { type: 'object', description: "the tenant's PayPal code, or the sentence saying it declares none" },
    }),
    handle: async c => {
      const family = await tenantFamilyRow(c.tenant.id, c.params.id)
      if (!family) return notFound('no such family in this tenant')
      const year = await enrollmentYearOf(c.tenant.id)
      const enrollment = await getEnrollment(c.tenant.id, c.params.id, year)
      return ok({
        year,
        may: { read: may(c.caller!, 'enrollment.read'), write: may(c.caller!, 'enrollment.write') },
        family: { id: family.id, legacyFamilyId: family.legacyFamilyId, motherId: family.motherId, fatherId: family.fatherId },
        parents: await parentsInOrder([family.motherId, family.fatherId].filter(Boolean) as string[]),
        children: await familyChildrenByName(c.tenant.id, c.params.id),
        enrollment: enrollment ?? null,
        enrolledStudentIds: enrollment ? await getEnrolledStudentIds(enrollment.id) : [],
        payments: enrollment ? await enrollmentPayments(enrollment.id) : [],
        fee: enrollment ? (await owedAndPaidOf(enrollment.id)).owed : 0,
        droppedOutAt: enrollment
          ? (await getEnrollmentStudents(enrollment.id)).flatMap(s => s.droppedOutAt ? [s.droppedOutAt.toISOString()] : [])
          : [],
        zelle: await zelleTo(c.tenant.id),
        paypal: await paypalCode(c.tenant.id),
      })
    },
  },
  {
    method: 'GET', path: `${T}/incoming-payments/unapplied`, operationId: 'incomingPayment.unapplied',
    summary: 'The unapplied Zelle and PayPal rows, labelled, oldest first — so a booking can say which one it settles.',
    permission: 'enrollment.write',
    allowed: async c => may(c.caller, 'enrollment.write'),
    response: S.list(S.obj({ id: S.uuid, label: S.str, amount: S.str, source: S.str, referenceId: S.nullable(S.str), receivedAt: S.str })),
    handle: async c => ok(await unappliedIncomingPayments(c.tenant.id)),
  },

  // ---- a family's own acts, or the school's
  {
    method: 'POST', path: `${FAMILY}/opt-out`, operationId: 'enrollment.optOut',
    summary: 'Opt the family out of the enrollment year.',
    permission: 'enrollment.write', alsoAllowed: OWN_FAMILY,
    allowed: c => mayOrOwn(c, 'enrollment.write', c.params.id),
    response: S.done,
    handle: async c => { await optOutFamilyEnrollment(c.tenant.id, c.params.id, await enrollmentYearOf(c.tenant.id)); return ok({ success: true }) },
  },
  {
    method: 'POST', path: `${FAMILY}/undo-opt-out`, operationId: 'enrollment.undoOptOut',
    summary: "Undo an opt-out: the year's enrollment, if any, goes back to pending.",
    permission: 'enrollment.write', alsoAllowed: OWN_FAMILY,
    allowed: c => mayOrOwn(c, 'enrollment.write', c.params.id),
    response: S.done,
    handle: async c => {
      const enrollment = await getEnrollment(c.tenant.id, c.params.id, await enrollmentYearOf(c.tenant.id))
      if (enrollment) await setEnrollmentStatus(c.tenant.id, enrollment.id, 'pending')
      return ok({ success: true })
    },
  },
  {
    method: 'PUT', path: `${FAMILY}/students`, operationId: 'enrollment.save',
    summary: "Make or update the year's enrollment with the children chosen.",
    permission: 'enrollment.write', alsoAllowed: OWN_FAMILY,
    allowed: c => mayOrOwn(c, 'enrollment.write', c.params.id),
    request: S.obj({ studentIds: S.list(S.uuid) }),
    response: S.obj({ success: S.bool, enrollmentId: S.uuid }),
    handle: async c => {
      const studentIds = field.strs(c.body, 'studentIds')
      if (studentIds.length === 0) return refused('At least one student must be selected.')
      return result(await saveFamilyEnrollment(c.tenant.id, c.params.id, await enrollmentYearOf(c.tenant.id), studentIds))
    },
  },
  {
    method: 'POST', path: `${FAMILY}/cancel`, operationId: 'enrollment.cancel',
    summary: "Cancel the year: the school's act, writing its fee to zero (src/lib/family-enrollment.ts cancelEnrollment).",
    permission: 'enrollment.write',
    allowed: async c => may(c.caller, 'enrollment.write'),
    response: S.done,
    handle: async c => {
      const year = await enrollmentYearOf(c.tenant.id)
      const enrollmentId = await familyEnrollmentId(c.tenant.id, c.params.id, year)
      if (!enrollmentId) return refused(`This family has no ${year} enrolment to cancel.`)
      await cancelEnrollment(c.tenant.id, enrollmentId)
      return ok({ success: true })
    },
  },
  {
    method: 'POST', path: `${FAMILY}/reminder`, operationId: 'enrollment.remind',
    summary: 'Mail the family a reminder that its enrollment is incomplete.',
    permission: 'enrollment.write',
    allowed: async c => may(c.caller, 'enrollment.write'),
    response: S.done,
    handle: async c => result(await sendEnrollmentReminderMail(c.tenant.id, c.params.id, c.actor!)),
  },
  {
    method: 'POST', path: `${FAMILY}/not-started-reminder`, operationId: 'enrollment.remindNotStarted',
    summary: 'Mail a family that has not started enrollment a nudge.',
    permission: 'enrollment.write',
    allowed: async c => may(c.caller, 'enrollment.write'),
    response: S.done,
    handle: async c => result(await sendNotStartedReminderMail(c.tenant.id, c.params.id, c.actor!)),
  },

  // ---- money on an enrollment
  {
    method: 'POST', path: `${T}/enrollments/{id}/payments/zelle`, operationId: 'enrollmentPayment.recordZelle',
    summary: 'Record a Zelle payment toward an enrollment.',
    permission: 'enrollment.write',
    allowed: async c => may(c.caller, 'enrollment.write'),
    request: S.obj({ amountDollars: S.num, paidAt: S.nullable(S.date), referenceId: S.nullable(S.str), notes: S.nullable(S.str) }),
    response: withFamily,
    handle: async c => {
      const r = await recordZelleEnrollmentPayment(c.tenant.id, c.caller!.userId, c.params.id, field.num(c.body, 'amountDollars'),
        field.strOrNull(c.body, 'paidAt'), field.strOrNull(c.body, 'referenceId'), field.strOrNull(c.body, 'notes'))
      return 'error' in r ? refused(r.error) : ok(familyIdOf(r))
    },
  },
  {
    method: 'POST', path: `${T}/enrollments/{id}/payments/paypal`, operationId: 'enrollmentPayment.recordPaypal',
    summary: 'Record a PayPal payment received outside PayPal checkout.',
    permission: 'enrollment.write',
    allowed: async c => may(c.caller, 'enrollment.write'),
    request: S.obj({ amountDollars: S.num, processingFeeDollars: S.nullable(S.num), paidAt: S.nullable(S.date), referenceId: S.nullable(S.str), notes: S.nullable(S.str) }),
    response: withFamily,
    handle: async c => {
      const r = await recordManualPaypalEnrollmentPayment(c.tenant.id, c.caller!.userId, c.params.id, field.num(c.body, 'amountDollars'),
        field.numOrNull(c.body, 'processingFeeDollars'), field.strOrNull(c.body, 'paidAt'), field.strOrNull(c.body, 'referenceId'),
        field.strOrNull(c.body, 'notes'))
      return 'error' in r ? refused(r.error) : ok(familyIdOf(r))
    },
  },
  {
    method: 'POST', path: `${T}/enrollments/{id}/money`, operationId: 'enrollment.bookMoney',
    summary: "The one booking operation for a family's money: in or out, with a character, optionally settling an unapplied Zelle or PayPal row (src/lib/family-money.ts).",
    permission: 'enrollment.write',
    allowed: async c => may(c.caller, 'enrollment.write'),
    request: S.obj({
      direction: { type: 'string', enum: ['in', 'out'] }, amountDollars: S.num, method: S.str, 'character?': S.str,
      paidAt: S.nullable(S.date), referenceId: S.nullable(S.str), notes: S.nullable(S.str),
      'settlesIncomingPaymentId?': S.nullable(S.uuid), 'processingFeeDollars?': S.nullable(S.num),
    }),
    response: withFamily,
    handle: async c => {
      const b = field.obj(c.body)
      const direction = field.str(b, 'direction')
      if (direction !== 'in' && direction !== 'out') return badRequest('direction must be in or out')
      const r = await bookFamilyMoney(c.tenant.id, c.caller!.userId, {
        enrollmentId: c.params.id, direction, amountDollars: field.num(b, 'amountDollars'), method: field.str(b, 'method'),
        character: b.character === undefined ? undefined : field.str(b, 'character'),
        paidAt: field.strOrNull(b, 'paidAt'), referenceId: field.strOrNull(b, 'referenceId'), notes: field.strOrNull(b, 'notes'),
        settlesIncomingPaymentId: field.strOrNull(b, 'settlesIncomingPaymentId'),
        processingFeeDollars: field.numOrNull(b, 'processingFeeDollars'),
      })
      return 'error' in r ? refused(r.error) : ok(familyIdOf(r))
    },
  },
  {
    method: 'POST', path: `${T}/enrollments/{id}/zelle-check`, operationId: 'enrollment.checkZelle',
    summary: "Search the school's Zelle deposits since the enrollment was made for a payment from the name given.",
    permission: 'tenant.read', alsoAllowed: `${OWN_FAMILY}, when the enrollment is that family's`,
    allowed: async c => {
      if (may(c.caller, 'tenant.read')) return true
      const e = await enrollmentForZelleCheck(c.tenant.id, c.params.id)
      // No such enrollment: the operation answers 404 before asking who.
      return !e || await mayOrOwn(c, 'tenant.read', e.familyId)
    },
    request: S.obj({ searchName: S.str }),
    response: S.row('src/lib/zelle.ts ZelleCheckResult'),
    handle: async c => {
      const e = await enrollmentForZelleCheck(c.tenant.id, c.params.id)
      if (!e) return notFound('Enrollment not found.')
      try {
        return ok(await checkZelleForFamily(c.tenant.id, c.params.id, isoDayIn(e.createdAt, c.tenant.timezone), field.str(c.body, 'searchName')))
      } catch (err) {
        return refused(err instanceof Error ? err.message : 'Check failed.')
      }
    },
  },
  {
    method: 'DELETE', path: `${T}/enrollment-payments/{id}`, operationId: 'enrollmentPayment.delete',
    summary: 'Remove a manually recorded payment (not an SDK-captured PayPal one).',
    permission: 'enrollment.write',
    allowed: async c => may(c.caller, 'enrollment.write'),
    response: S.done,
    handle: async c => result(await deleteManualEnrollmentPayment(c.tenant.id, c.params.id)),
  },
  {
    method: 'PUT', path: `${T}/enrollment-payments/{id}/date`, operationId: 'enrollmentPayment.setDate',
    summary: "Set a payment's date.",
    permission: 'enrollment.write',
    allowed: async c => may(c.caller, 'enrollment.write'),
    request: S.obj({ date: S.date }),
    response: S.done,
    handle: async c => result(await setEnrollmentPaymentDate(c.tenant.id, c.params.id, field.str(c.body, 'date'))),
  },
  {
    method: 'PUT', path: `${T}/enrollment-payments/{id}/processing-fee`, operationId: 'enrollmentPayment.setProcessingFee',
    summary: "Override the processing fee on a PayPal payment.",
    permission: 'enrollment.write',
    allowed: async c => may(c.caller, 'enrollment.write'),
    request: S.obj({ processingFeeDollars: S.num }),
    response: S.done,
    handle: async c => result(await setEnrollmentPaymentProcessingFee(c.tenant.id, c.params.id, field.num(c.body, 'processingFeeDollars'))),
  },
]
