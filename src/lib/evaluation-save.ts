// A TEACHER'S EVALUATION, SAVED AND MAYBE SUBMITTED, with the three writes it makes (apart from roster-evaluation.ts,
// so a reader of evaluations reaches no write). `saved` says whether the draft was written.
import { db } from './db'
import { now } from './host'
import { rosterEvaluations, persons } from '../tables'
import { birthId } from './registry-id'
import { and, eq } from 'drizzle-orm'
import { classLevel, evaluationTemplateSections } from './roster-evaluation'
import { enrollmentYearOf } from './year-context'
import { swapStandbyToRecommended } from './roster-swap'

export type EvaluationInput = {
  classId: string
  studentId: string
  year: number
  responses: Record<string, string>
  recommendedCourseId: string | null
  teacherCommentCode: number | null
  internalNotes: string | null
  submit: boolean
}

type EvaluationDraft = {
  responses: Record<string, string>
  recommendedCourseId: string | null
  teacherCommentCode: number | null
  internalNotes: string | null
}

/** Save a student's evaluation for a class and year — update the row, or issue a record id and create it unsubmitted. */
async function saveEvaluationDraft(tenantId: string, classId: string, studentId: string, year: number, draft: EvaluationDraft): Promise<void> {
  const { responses, recommendedCourseId, teacherCommentCode, internalNotes } = draft
  const [existing] = await db
    .select({ id: rosterEvaluations.id })
    .from(rosterEvaluations)
    .where(and(
      eq(rosterEvaluations.classId, classId),
      eq(rosterEvaluations.studentId, studentId),
      eq(rosterEvaluations.year, year),
      eq(rosterEvaluations.tenantId, tenantId),
    ))
    .limit(1)

  if (existing) {
    await db
      .update(rosterEvaluations)
      .set({
        responses,
        recommendedCourseId: recommendedCourseId ?? null,
        teacherCommentCode:  teacherCommentCode ?? null,
        internalNotes,
      })
      .where(and(
        eq(rosterEvaluations.id, existing.id),
        eq(rosterEvaluations.tenantId, tenantId),
      ))
  } else {
    // Issue a record id first
    const id = await birthId(db, 'evaluation', tenantId)

    await db.insert(rosterEvaluations).values({
      id,
      tenantId,
      classId,
      studentId,
      year,
      responses,
      recommendedCourseId: recommendedCourseId ?? null,
      teacherCommentCode:  teacherCommentCode ?? null,
      internalNotes,
      submittedAt: null,
    })
  }
}

/** Mark a student's evaluation submitted now, by the person whose address is the submitter's (null when none). */
async function markEvaluationSubmitted(tenantId: string, classId: string, studentId: string, year: number, submitterEmail: string): Promise<void> {
  const [submitter] = await db
    .select({ id: persons.id })
    .from(persons)
    .where(and(eq(persons.email, submitterEmail), eq(persons.tenantId, tenantId)))
    .limit(1)
  await db.update(rosterEvaluations)
    .set({ submittedAt: now(), submittedBy: submitter?.id ?? null })
    .where(and(
      eq(rosterEvaluations.classId, classId),
      eq(rosterEvaluations.studentId, studentId),
      eq(rosterEvaluations.year, year),
      eq(rosterEvaluations.tenantId, tenantId),
    ))
}

/** Record that a student's language recommendation was applied now. */
async function markLanguageApproved(tenantId: string, classId: string, studentId: string, year: number): Promise<void> {
  await db.update(rosterEvaluations)
    .set({ languageApprovedAt: now() })
    .where(and(
      eq(rosterEvaluations.classId, classId),
      eq(rosterEvaluations.studentId, studentId),
      eq(rosterEvaluations.year, year),
      eq(rosterEvaluations.tenantId, tenantId),
    ))
}

// CLASS ASSIGNMENT SIDE EFFECT
// When an evaluation is submitted (submit=1, submittedAt set) and recommendedCourseId is present,
// check if the student is enrolled for the next year and currently in the standby language class.
// If so, re-run language class assignment to move them from standby to the recommended class.
// The assignment rules are auto-assign.ts's.
export async function saveEvaluationAct(tenantId: string, email: string, input: EvaluationInput): Promise<{ error?: string; ok?: boolean; saved: boolean }> {
  const { classId, studentId, year, responses, recommendedCourseId, teacherCommentCode, internalNotes, submit } = input

  // Verify class belongs to this tenant
  const cls = await classLevel(tenantId, classId)
  if (!cls) return { error: 'Class not found', saved: false }

  // Always save first — validate submit conditions after
  await saveEvaluationDraft(tenantId, classId, studentId, year, { responses, recommendedCourseId, teacherCommentCode, internalNotes })

  // Now check submit conditions — return error if not met (data is already saved).
  if (submit) {
    if (!recommendedCourseId) return { error: 'Saved. Please select the recommended course to submit.', saved: true }
    if (!teacherCommentCode) return { error: 'Saved. Please select a teacher comment to submit.', saved: true }
    if (cls.level !== null) {
      const sections = await evaluationTemplateSections(tenantId, cls.level)
      if (sections) {
        const missing = sections.flatMap(s => s.criteria).filter(c => !responses[c])
        if (missing.length > 0) return { error: `Saved. ${missing.length} criterion${missing.length === 1 ? '' : 'a'} not rated — complete all items to submit.`, saved: true }
      }
    }
    // All conditions met — mark as submitted
    await markEvaluationSubmitted(tenantId, classId, studentId, year, email)
  }

  // Auto-swap standby: if teacher submitted a recommendation and student is enrolled next year
  // in a standby language class, move them to the recommended class immediately.
  if (submit && recommendedCourseId) {
    const swapped = await swapStandbyToRecommended(tenantId, studentId, recommendedCourseId, await enrollmentYearOf(tenantId))
    if (swapped) {
      await markLanguageApproved(tenantId, classId, studentId, year)
    }
  }

  return { ok: true, saved: true }
}
