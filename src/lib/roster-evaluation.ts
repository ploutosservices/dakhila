// ONE CLASS'S EVALUATIONS: the class, its template and comment codes, the courses a teacher may recommend, and the
// students and their saved evaluations.
import type { Actor } from './outward-act'
import { familyRecipients } from './family-recipients'
import { rosterClassCode } from './roster-class-code'
import { db } from './db'
import {
  rosterEvaluations,
  rosterAvailableClasses,
  rosterCourseCatalog,
  rosterEnrollments,
  rosterTeacherCommentCodes,
  rosterEvalTemplates,
  persons,
} from '../tables'
import { eq, and, asc, inArray, isNull, isNotNull } from 'drizzle-orm'
import { sendEmail } from './mail'
import { schoolWord } from './school-words'
import { courseRules, tenantRules } from './rules-context'
import type { Tenant } from './tenant'

/** The tenant's class with its catalog fields — what the evaluation form is built for; null when not the tenant's. */
export async function classForEvaluation(tenantId: string, classId: string) {
  const [cls] = await db
    .select({
      id:         rosterAvailableClasses.id,
      year:       rosterAvailableClasses.year,
      section:    rosterAvailableClasses.section,
      shortCode:   rosterCourseCatalog.shortCode,
      fullName:    rosterCourseCatalog.fullName,
      level:       rosterCourseCatalog.level,
      department:  rosterCourseCatalog.department,
      department2: rosterCourseCatalog.department2,
    })
    .from(rosterAvailableClasses)
    .leftJoin(rosterCourseCatalog, eq(rosterCourseCatalog.id, rosterAvailableClasses.courseId))
    .where(and(
      eq(rosterAvailableClasses.id, classId),
      eq(rosterAvailableClasses.tenantId, tenantId),
    ))
    .limit(1)
  return cls ?? null
}

/** The evaluation template's sections for a course level; null when the tenant has none for it. */
export async function evaluationTemplateSections(tenantId: string, level: number): Promise<{ name: string; criteria: string[] }[] | null> {
  const [template] = await db
    .select({ sections: rosterEvalTemplates.sections })
    .from(rosterEvalTemplates)
    .where(and(
      eq(rosterEvalTemplates.tenantId, tenantId),
      eq(rosterEvalTemplates.courseLevel, level),
    ))
    .limit(1)
  return template ? template.sections as { name: string; criteria: string[] }[] : null
}

/** The tenant's teacher comment codes, by id. */
export function teacherCommentCodes(tenantId: string) {
  return db
    .select({ id: rosterTeacherCommentCodes.id, text: rosterTeacherCommentCodes.text })
    .from(rosterTeacherCommentCodes)
    .where(eq(rosterTeacherCommentCodes.tenantId, tenantId))
    .orderBy(asc(rosterTeacherCommentCodes.id))
}

/** The courses a teacher may recommend from a class: same department and department2, this level or the next. */
export function recommendableCourses(tenantId: string, department: string, department2: number, level: number) {
  return db
    .select({ id: rosterCourseCatalog.id, shortCode: rosterCourseCatalog.shortCode, level: rosterCourseCatalog.level })
    .from(rosterCourseCatalog)
    .where(and(
      eq(rosterCourseCatalog.tenantId, tenantId),
      eq(rosterCourseCatalog.department, department),
      eq(rosterCourseCatalog.department2, department2),
      inArray(rosterCourseCatalog.level, [level, level + 1]),
      isNotNull(rosterCourseCatalog.shortCode),
    ))
    .orderBy(asc(rosterCourseCatalog.level))
}

/** The class's live students, by last then first name. */
export function classStudentsToEvaluate(tenantId: string, classId: string) {
  return db
    .select({
      personId:  persons.id,
      firstName: persons.firstName,
      lastName:  persons.lastName,
    })
    .from(rosterEnrollments)
    .innerJoin(persons, eq(persons.id, rosterEnrollments.studentId))
    .where(and(
      eq(rosterEnrollments.classId, classId),
      eq(rosterEnrollments.tenantId, tenantId),
      isNull(persons.deletedAt),
      isNull(rosterEnrollments.droppedOutAt),
      isNull(rosterEnrollments.deletedAt),
    ))
    .orderBy(asc(persons.lastName), asc(persons.firstName))
}

/** The evaluations already saved for a class in its year. */
export function classEvaluations(tenantId: string, classId: string, year: number) {
  return db
    .select({
      studentId:            rosterEvaluations.studentId,
      responses:            rosterEvaluations.responses,
      recommendedCourseId:  rosterEvaluations.recommendedCourseId,
      teacherCommentCode:   rosterEvaluations.teacherCommentCode,
      internalNotes:        rosterEvaluations.internalNotes,
      submittedAt:          rosterEvaluations.submittedAt,
    })
    .from(rosterEvaluations)
    .where(and(
      eq(rosterEvaluations.classId, classId),
      eq(rosterEvaluations.year, year),
      eq(rosterEvaluations.tenantId, tenantId),
    ))
}

/** Everything an evaluation form draws for one class: the class, its level's template sections, the comment codes, the
 *  courses a teacher may recommend, the class's live students and their saved evaluations. Null when the class is not the tenant's. */
export async function evaluationForm(tenantId: string, classId: string) {
  const cls = await classForEvaluation(tenantId, classId)
  if (!cls) return null
  // A course with no level takes the template of the level a new child starts at.
  const level = cls.level ?? (await courseRules(tenantId)).noviceStartLevel
  const department2 = cls.department2 ?? null
  return {
    cls,
    sections: (await evaluationTemplateSections(tenantId, level)) ?? [],
    commentCodes: await teacherCommentCodes(tenantId),
    recommendableCourses: cls.department && department2 !== null ? await recommendableCourses(tenantId, cls.department, department2, level) : [],
    students: await classStudentsToEvaluate(tenantId, classId),
    evaluations: (await classEvaluations(tenantId, classId, cls.year)).map(e => ({
      ...e,
      responses: (e.responses as Record<string, string>) ?? {},
      submittedAt: e.submittedAt ? e.submittedAt.toISOString() : null,
    })),
  }
}

export type EvaluationForm = NonNullable<Awaited<ReturnType<typeof evaluationForm>>>

/** The tenant's class and its course level, for saving an evaluation; null when not the tenant's. */
export async function classLevel(tenantId: string, classId: string) {
  const [cls] = await db
    .select({ id: rosterAvailableClasses.id, level: rosterCourseCatalog.level })
    .from(rosterAvailableClasses)
    .leftJoin(rosterCourseCatalog, eq(rosterCourseCatalog.id, rosterAvailableClasses.courseId))
    .where(and(
      eq(rosterAvailableClasses.id, classId),
      eq(rosterAvailableClasses.tenantId, tenantId),
    ))
    .limit(1)
  return cls ?? null
}

// Saving an evaluation (the draft, its submission, its language approval) is evaluation-save.ts.

// Mails one submitted evaluation to the student's family.
export async function sendEvaluationEmail(opts: {
  tenant: Tenant
  classId: string
  studentId: string
  year: number
  responses: Record<string, string>
  teacherCommentCode: number | null
  recommendedCourseId: string | null
  userEmail: string
}, actor: Actor) {
  const { tenant, classId, studentId, year, responses, teacherCommentCode, recommendedCourseId, userEmail } = opts

  // Fetch class + course info
  const [cls] = await db
    .select({
      shortCode: rosterCourseCatalog.shortCode,
      section:   rosterAvailableClasses.section,
      fullName:  rosterCourseCatalog.fullName,
      level:     rosterCourseCatalog.level,
    })
    .from(rosterAvailableClasses)
    .leftJoin(rosterCourseCatalog, eq(rosterCourseCatalog.id, rosterAvailableClasses.courseId))
    .where(and(
      eq(rosterAvailableClasses.id, classId),
      eq(rosterAvailableClasses.tenantId, tenant.id),
    ))
    .limit(1)
  if (!cls) return

  // Fetch student and their family
  const [student] = await db
    .select({ firstName: persons.firstName, lastName: persons.lastName, familyId: persons.familyId })
    .from(persons)
    .where(eq(persons.id, studentId))
    .limit(1)
  if (!student) return

  // An evaluation email: the family emits its list — the student evaluated and the parents (lib/family-recipients).
  const parentEmails = student.familyId ? await familyRecipients(tenant.id, student.familyId, 'evaluation', { studentId }) : []
  if (parentEmails.length === 0) return

  // Fetch comment text
  let commentText: string | null = null
  if (teacherCommentCode !== null) {
    const [code] = await db
      .select({ text: rosterTeacherCommentCodes.text })
      .from(rosterTeacherCommentCodes)
      .where(and(
        eq(rosterTeacherCommentCodes.id, teacherCommentCode),
        eq(rosterTeacherCommentCodes.tenantId, tenant.id),
      ))
      .limit(1)
    commentText = code?.text ?? null
  }

  // Fetch recommended course
  let recommendedCourse: { shortCode: string; fullName: string } | null = null
  if (recommendedCourseId) {
    const [rec] = await db
      .select({ shortCode: rosterCourseCatalog.shortCode, fullName: rosterCourseCatalog.fullName })
      .from(rosterCourseCatalog)
      .where(eq(rosterCourseCatalog.id, recommendedCourseId))
      .limit(1)
    if (rec) recommendedCourse = rec
  }

  // Fetch eval template to get section ordering
  const level = cls.level ?? (await courseRules(tenant.id)).noviceStartLevel
  const [template] = await db
    .select({ sections: rosterEvalTemplates.sections })
    .from(rosterEvalTemplates)
    .where(and(
      eq(rosterEvalTemplates.tenantId, tenant.id),
      eq(rosterEvalTemplates.courseLevel, level),
    ))
    .limit(1)
  const sections = (template?.sections ?? []) as { name: string; criteria: string[] }[]

  const studentName = [student.firstName, student.lastName].filter(Boolean).join(' ')
  const classLabel  = [rosterClassCode(cls), cls.fullName].filter(Boolean).join(' — ')
  const name        = await schoolWord(tenant.id, 'name')
  const subject     = `${name} Evaluation — ${studentName} — ${rosterClassCode(cls)} ${year}`
  // A stored value reads as the school's label for it; a value off its scale reads as itself.
  const scale       = (await tenantRules(tenant.id)).codes.evaluation
  const scaleLabel  = (val: string) => scale.find(v => v.value === val)?.label ?? val

  // Build plain-text body
  const lines: string[] = [
    `Dear Parent,`,
    ``,
    `The evaluation for ${studentName} (${classLabel}, ${year}) has been submitted.`,
    ``,
  ]

  if (sections.length > 0) {
    for (const section of sections) {
      lines.push(section.name)
      for (const criterion of section.criteria) {
        const val = responses[criterion] ?? '—'
        const label = scaleLabel(val)
        lines.push(`  ${criterion}: ${label}`)
      }
      lines.push(``)
    }
  } else {
    for (const [criterion, val] of Object.entries(responses)) {
      const label = scaleLabel(val)
      lines.push(`  ${criterion}: ${label}`)
    }
    lines.push(``)
  }

  if (commentText) {
    lines.push(`Teacher comment: ${commentText}`)
    lines.push(``)
  }

  if (recommendedCourse) {
    lines.push(`Recommended next course: ${recommendedCourse.shortCode} — ${recommendedCourse.fullName}`)
    lines.push(``)
  }

  lines.push(name)

  await sendEmail(tenant.id, {
    to: parentEmails,
    subject,
    body: lines.join('\n'),
  }, actor)
}

