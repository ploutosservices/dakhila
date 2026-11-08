// THE EVALUATIONS BOARD: its two reads and its two acts (lib/roster-evaluations-board.ts, roster-evaluation-writes.ts,
// roster-swap.ts), asked placement.read or placement.write. An act's refusal comes back in its own words.
import { may } from './access'
import type { PersonCall, Route } from './routes'
import { badRequest, field, notFound, ok, refused, S } from './op'
import { saveEvaluationAct } from './lib/evaluation-save'
import { enrollmentYearOf } from './lib/year-context'
import { evalStatusForYear, languageUpdatesForYear, submittedEvaluation, evaluationApproval, familyEnrolledIn, submittedEvaluationIds } from './lib/roster-evaluations-board'
import { approveEvaluationLanguage, returnEvaluation } from './lib/roster-evaluation-writes'
import { swapStandbyToRecommended } from './lib/roster-swap'
import { buildEvalEmailTarget, evaluationFamilyMayView, evaluationStatus } from './lib/eval-data'
import { evaluationForm } from './lib/roster-evaluation'
import { tenantRules } from './lib/rules-context'
import { familyIdOfAddress, familyMembers, submittedEvaluationsOf } from './lib/family-evals'
const T = '/v1/tenants/{slug}/roster/evaluations'

function yearOf(s: string): number | null {
  const y = parseInt(s)
  return Number.isFinite(y) ? y : null
}

export const EVALUATION_ROUTES: Route[] = [
  {
    method: 'POST', path: `${T}/save`, operationId: 'evaluation.save',
    summary: "A teacher's evaluation of a student in a class saved as a draft and, with `submit`, submitted once complete — the student moved from a standby class to the recommended one when enrolled there; `saved` says whether the draft was written, and a submit refused after the save says so in its words.",
    permission: 'placement.write',
    allowed: async c => may(c.caller, 'placement.write'),
    request: S.obj({
      classId: S.uuid, studentId: S.uuid, year: S.num, responses: S.row("criterion to a value of the school's evaluation scale"),
      recommendedCourseId: S.nullable(S.uuid), teacherCommentCode: S.nullable(S.num), internalNotes: S.nullable(S.str), submit: S.bool,
    }),
    response: S.obj({ 'error?': S.str, 'ok?': S.bool, saved: S.bool }),
    handle: async c => {
      const b = field.obj(c.body)
      // A response is kept when it is a value on the school's evaluation scale.
      const scale = new Set((await tenantRules(c.tenant.id)).codes.evaluation.map(v => v.value))
      const responses = Object.fromEntries(Object.entries(field.obj(b.responses)).filter(([, v]) => typeof v === 'string' && scale.has(v))) as Record<string, string>
      return ok(await saveEvaluationAct(c.tenant.id, (c as PersonCall).caller.email, {
        classId: field.str(b, 'classId'), studentId: field.str(b, 'studentId'), year: field.num(b, 'year'), responses,
        recommendedCourseId: field.strOrNull(b, 'recommendedCourseId'), teacherCommentCode: field.numOrNull(b, 'teacherCommentCode'),
        internalNotes: field.strOrNull(b, 'internalNotes'), submit: b.submit === true,
      }))
    },
  },
  {
    method: 'GET', path: `${T}/year/{year}/status`, operationId: 'evaluation.status',
    summary: "Each language classroom's evaluation status for the year: its classes, teachers, enrolled and submitted counts, and who is pending or returned.",
    permission: 'placement.read',
    textParams: ['year'],
    allowed: async c => may(c.caller, 'placement.read'),
    response: S.list(S.row('a classroom\'s evaluation status (src/lib/roster-evaluations-board.ts ClassEvalStatus)')),
    handle: async c => {
      const year = yearOf(c.params.year)
      if (year === null) return badRequest('year must be a number')
      return ok(await evalStatusForYear(c.tenant.id, year))
    },
  },
  {
    method: 'GET', path: `${T}/year/{year}/language-updates`, operationId: 'evaluation.languageUpdates',
    summary: "The year's submitted language recommendations awaiting, or past, the principal's approval.",
    permission: 'placement.read',
    textParams: ['year'],
    allowed: async c => may(c.caller, 'placement.read'),
    response: S.list(S.row('a language update (src/lib/roster-evaluations-board.ts LanguageUpdate)')),
    handle: async c => {
      const year = yearOf(c.params.year)
      if (year === null) return badRequest('year must be a number')
      return ok(await languageUpdatesForYear(c.tenant.id, year))
    },
  },
  {
    method: 'GET', path: `${T}/mine`, operationId: 'evaluation.mine',
    summary: "The family view of evaluation reports: the family of the person whose address is the one the caller signed in with (null when none), every live member of it, and the members' submitted evaluations with each one's class, by year.",
    permission: null, alsoAllowed: "the caller's own family: the person whose address is the one they signed in with, and that person's family",
    allowed: async () => true,
    response: S.obj({
      familyId: S.nullable(S.uuid),
      members: S.list(S.row('a family member (src/lib/family-evals.ts familyMembers)')),
      evaluations: S.list(S.row('a submitted evaluation (src/lib/family-evals.ts submittedEvaluationsOf)')),
    }),
    handle: async c => {
      const familyId = await familyIdOfAddress(c.tenant.id, (c as PersonCall).caller.email)
      if (!familyId) return ok({ familyId: null, members: [], evaluations: [] })
      const members = await familyMembers(c.tenant.id, familyId)
      const evaluations = members.length ? await submittedEvaluationsOf(c.tenant.id, members.map(m => m.id)) : []
      return ok({ familyId, members, evaluations })
    },
  },
  {
    method: 'GET', path: `${T}/classes/{classId}/form`, operationId: 'evaluation.classForm',
    summary: "What a teacher evaluates a class with: the class and its course fields, its level's template sections, the comment codes, the courses a teacher may recommend, the class's live students and their saved evaluations (src/lib/roster-evaluation.ts EvaluationForm).",
    permission: 'placement.read',
    allowed: async c => may(c.caller, 'placement.read'),
    response: S.row('the evaluation form (src/lib/roster-evaluation.ts EvaluationForm)'),
    handle: async c => {
      const form = await evaluationForm(c.tenant.id, c.params.classId)
      return form ? ok(form) : notFound('no such class')
    },
  },
  {
    method: 'GET', path: `${T}/year/{year}/submitted`, operationId: 'evaluation.submittedIds',
    summary: "The ids of the year's submitted evaluations — what the reports to families are sent for.",
    permission: 'placement.read',
    textParams: ['year'],
    allowed: async c => may(c.caller, 'placement.read'),
    response: S.list(S.uuid),
    handle: async c => {
      const year = yearOf(c.params.year)
      if (year === null) return badRequest('year must be a number')
      return ok(await submittedEvaluationIds(c.tenant.id, year))
    },
  },
  {
    method: 'GET', path: `${T}/{id}/target`, operationId: 'evaluation.target',
    summary: "One evaluation as its page, PDF and report email show it: the student, parents, the family's recipients, the teacher, the class and recommendation, the template's criteria rated, the comment (src/lib/eval-data.ts EvalEmailTarget, the PDF's logo left to the caller); whether the caller is of the student's family; whether that family is enrolled for the enrollment year; the language-approval time; and the internal notes, to a placement.write caller only.",
    permission: 'placement.read', alsoAllowed: "the evaluated student's family: the caller's person shares the student's family, matched by the address they signed in with",
    allowed: async c => may(c.caller, 'placement.read') || (!!c.caller && (await evaluationFamilyMayView(c.tenant.id, c.params.id, c.caller.email)) !== false),
    response: S.obj({
      target: S.row('the evaluation (src/lib/eval-data.ts EvalEmailTarget, pdfData without logoPath)'),
      family: S.bool, familyEnrolled: S.bool, languageApprovedAt: S.nullable(S.str), internalNotes: S.nullable(S.str),
    }),
    handle: async c => {
      const target = await buildEvalEmailTarget(c.params.id, c.tenant.id)
      const status = await evaluationStatus(c.tenant.id, c.params.id)
      if (!target || !status) return notFound('no such evaluation')
      const caller = (c as PersonCall).caller
      const { logoPath: _logo, ...pdfData } = target.pdfData
      return ok({
        target: { ...target, pdfData },
        family: (await evaluationFamilyMayView(c.tenant.id, c.params.id, caller.email)) === true,
        familyEnrolled: target.familyId ? await familyEnrolledIn(c.tenant.id, target.familyId, await enrollmentYearOf(c.tenant.id)) : false,
        languageApprovedAt: status.languageApprovedAt ? status.languageApprovedAt.toISOString() : null,
        internalNotes: may(caller, 'placement.write') ? status.internalNotes : null,
      })
    },
  },
  {
    method: 'POST', path: `${T}/{id}/approve-language`, operationId: 'evaluation.approveLanguage',
    summary: "A submitted evaluation's language recommendation approved; a student in a standby class next year is moved to the recommended class first.",
    permission: 'placement.write',
    allowed: async c => may(c.caller, 'placement.write'),
    response: S.obj({}),
    handle: async c => {
      const ev = await submittedEvaluation(c.tenant.id, c.params.id)
      if (!ev) return refused('Evaluation not found')
      if (ev.languageApprovedAt) return refused('Already approved')
      if (ev.recommendedCourseId) await swapStandbyToRecommended(c.tenant.id, ev.studentId, ev.recommendedCourseId, await enrollmentYearOf(c.tenant.id))
      await approveEvaluationLanguage(c.params.id)
      return ok({})
    },
  },
  {
    method: 'POST', path: `${T}/{id}/return`, operationId: 'evaluation.return',
    summary: 'An evaluation sent back to its teacher, unsubmitted; refused once its language is approved.',
    permission: 'placement.write',
    allowed: async c => may(c.caller, 'placement.write'),
    response: S.obj({}),
    handle: async c => {
      const ev = await evaluationApproval(c.tenant.id, c.params.id)
      if (!ev) return refused('Evaluation not found')
      if (ev.languageApprovedAt) return refused('Already approved — cannot return')
      await returnEvaluation(c.tenant.id, c.params.id)
      return ok({})
    },
  },
]
