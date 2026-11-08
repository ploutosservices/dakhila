// THE EVALUATIONS BOARD'S READS: each language classroom's evaluation status, the
// submitted recommendations awaiting the principal, and what the report mails need to know. Approving or returning one is roster-evaluation-writes.ts, the roster API's.
import { db } from './db'
import {
  rosterAvailableClasses, rosterCourseCatalog, rosterEnrollments,
  rosterEvaluations, rosterEvalTemplates, rosterTeachers, persons,
  familyEnrollments,
} from '../tables'
import { eq, and, inArray, isNotNull, isNull } from 'drizzle-orm'
import { courseRules, nameOrder, tenantRules } from './rules-context'
import { byCode } from './zoned'

export type ClassEvalStatus = {
  groupKey: string                   // classroomCourseId ?? first classId
  classroomCourseId: string | null
  classIds: string[]
  shortCodes: string[]
  fullName: string
  department: string
  teachers: { personId: string; name: string; email: string | null }[]
  enrolled: number
  submitted: number
  submittedEvals: { evalId: string; studentId: string; name: string; hasRecommendation: boolean }[]
  pending:  { studentId: string; name: string }[]
  returned: { studentId: string; name: string }[]
}

/** Each language classroom's evaluation status for the year — classes grouped by Google Classroom, empty ones dropped. */
export async function evalStatusForYear(tenantId: string, year: number): Promise<ClassEvalStatus[]> {
  // Language classes for current year
  const classes = await db
    .select({
      classId: rosterAvailableClasses.id,
      classroomCourseId: rosterAvailableClasses.classroomCourseId,
      shortCode: rosterCourseCatalog.shortCode,
      fullName: rosterCourseCatalog.fullName,
      department: rosterCourseCatalog.department,
    })
    .from(rosterAvailableClasses)
    .leftJoin(rosterCourseCatalog, eq(rosterCourseCatalog.id, rosterAvailableClasses.courseId))
    .where(and(
      eq(rosterAvailableClasses.tenantId, tenantId),
      eq(rosterAvailableClasses.year, year),
      inArray(rosterCourseCatalog.department, (await courseRules(tenantId)).languages),
    ))

  if (classes.length === 0) return []

  const classIds = classes.map(c => c.classId)

  // Enrolled students per class
  const enrollments = await db
    .select({
      classId: rosterEnrollments.classId,
      studentId: rosterEnrollments.studentId,
      firstName: persons.firstName,
      lastName: persons.lastName,
    })
    .from(rosterEnrollments)
    .leftJoin(persons, eq(persons.id, rosterEnrollments.studentId))
    .where(and(
      eq(rosterEnrollments.tenantId, tenantId),
      inArray(rosterEnrollments.classId, classIds),
      isNull(rosterEnrollments.droppedOutAt),
    ))

  // All evals that are submitted or returned (excludes in-progress drafts)
  const evalRows = await db
    .select({
      id:                  rosterEvaluations.id,
      classId:             rosterEvaluations.classId,
      studentId:           rosterEvaluations.studentId,
      recommendedCourseId: rosterEvaluations.recommendedCourseId,
      submittedAt:         rosterEvaluations.submittedAt,
      returnedAt:          rosterEvaluations.returnedAt,
    })
    .from(rosterEvaluations)
    .where(and(
      eq(rosterEvaluations.tenantId, tenantId),
      eq(rosterEvaluations.year, year),
      inArray(rosterEvaluations.classId, classIds),
    ))

  const submitted    = evalRows.filter(e => e.submittedAt !== null)
  const returnedRows = evalRows.filter(e => e.returnedAt !== null && e.submittedAt === null)

  const submittedSet = new Set(submitted.map(s => `${s.classId}:${s.studentId}`))
  const returnedSet  = new Set(returnedRows.map(r => `${r.classId}:${r.studentId}`))
  const evalByKey    = new Map(submitted.map(s => [`${s.classId}:${s.studentId}`, s]))

  // Teachers per class
  const teachers = await db
    .select({
      classId: rosterTeachers.classId,
      personId: rosterTeachers.personId,
      firstName: persons.firstName,
      lastName: persons.lastName,
      email: persons.email,
    })
    .from(rosterTeachers)
    .leftJoin(persons, eq(persons.id, rosterTeachers.personId))
    .where(inArray(rosterTeachers.classId, classIds))

  const teachersByClass = new Map<string, { personId: string; name: string; email: string | null }[]>()
  for (const t of teachers) {
    const list = teachersByClass.get(t.classId) ?? []
    list.push({ personId: t.personId, name: `${t.firstName} ${t.lastName ?? ''}`.trim(), email: t.email })
    teachersByClass.set(t.classId, list)
  }

  // Group classes by classroomCourseId (or individual classId if no GC link)
  const groupMap = new Map<string, typeof classes>()
  for (const c of classes) {
    const key = c.classroomCourseId ?? c.classId
    const list = groupMap.get(key) ?? []
    list.push(c)
    groupMap.set(key, list)
  }

  return Array.from(groupMap.entries()).map(([groupKey, groupClasses]) => {
    const groupClassIds = groupClasses.map(c => c.classId)
    const groupEnrollments = enrollments.filter(e => groupClassIds.includes(e.classId))
    const returnedStudents = groupEnrollments.filter(e => returnedSet.has(`${e.classId}:${e.studentId}`))
    const pendingStudents  = groupEnrollments.filter(e => !submittedSet.has(`${e.classId}:${e.studentId}`) && !returnedSet.has(`${e.classId}:${e.studentId}`))

    // Union teachers across all classes in group, deduplicated by personId
    const teacherMap = new Map<string, { personId: string; name: string; email: string | null }>()
    for (const cid of groupClassIds) {
      for (const t of teachersByClass.get(cid) ?? []) {
        if (!teacherMap.has(t.personId)) teacherMap.set(t.personId, t)
      }
    }

    return {
      groupKey,
      classroomCourseId: groupClasses[0].classroomCourseId,
      classIds: groupClassIds,
      shortCodes: groupClasses.map(c => c.shortCode!),
      fullName: groupClasses[0].fullName!,
      department: groupClasses[0].department!,
      teachers: [...teacherMap.values()],
      enrolled: groupEnrollments.length,
      submitted: groupEnrollments.length - pendingStudents.length,
      submittedEvals: groupEnrollments
        .filter(e => submittedSet.has(`${e.classId}:${e.studentId}`))
        .map(e => {
          const ev = evalByKey.get(`${e.classId}:${e.studentId}`)!
          return {
            evalId: ev.id,
            studentId: e.studentId,
            name: `${e.firstName} ${e.lastName ?? ''}`.trim(),
            hasRecommendation: !!ev.recommendedCourseId,
          }
        }),
      pending: pendingStudents.map(e => ({
        studentId: e.studentId,
        name: `${e.firstName} ${e.lastName ?? ''}`.trim(),
      })),
      returned: returnedStudents.map(e => ({
        studentId: e.studentId,
        name: `${e.firstName} ${e.lastName ?? ''}`.trim(),
      })),
    }
  }).filter(g => g.enrolled > 0).sort((a, b) => byCode(a.shortCodes[0], b.shortCodes[0]))
}

export type LanguageUpdate = {
  evalId: string
  studentId: string
  studentName: string
  evalYear: number
  currentClassShortCode: string
  recommendedShortCode: string | null
  recommendedCourseId: string | null
  approvedAt: string | null
  isComplete: boolean            // all criteria rated + comment code + recommendation set
  missingCriteria: number        // count of unrated criteria
  missingComment: boolean        // true if no comment code selected
  missingRecommendation: boolean // true if no next-year course selected
  submittedBy: string | null      // person ID of who clicked Submit
  submittedByEmail: string | null // email of submitter
}

/** The year's submitted evaluations with what each lacks for completeness, by student name. */
export async function languageUpdatesForYear(tenantId: string, year: number): Promise<LanguageUpdate[]> {
  const names = await nameOrder(tenantId)
  const rows = await db
    .select({
      evalId:              rosterEvaluations.id,
      studentId:           rosterEvaluations.studentId,
      evalYear:            rosterEvaluations.year,
      approvedAt:          rosterEvaluations.languageApprovedAt,
      recommendedCourseId: rosterEvaluations.recommendedCourseId,
      responses:           rosterEvaluations.responses,
      teacherCommentCode:  rosterEvaluations.teacherCommentCode,
      submittedBy:         rosterEvaluations.submittedBy,
      firstName:           persons.firstName,
      lastName:            persons.lastName,
      currentShortCode:    rosterCourseCatalog.shortCode,
      courseLevel:         rosterCourseCatalog.level,
    })
    .from(rosterEvaluations)
    .leftJoin(persons, eq(persons.id, rosterEvaluations.studentId))
    .leftJoin(rosterAvailableClasses, eq(rosterAvailableClasses.id, rosterEvaluations.classId))
    .leftJoin(rosterCourseCatalog, eq(rosterCourseCatalog.id, rosterAvailableClasses.courseId))
    .where(and(
      eq(rosterEvaluations.tenantId, tenantId),
      eq(rosterEvaluations.year, year),
      isNotNull(rosterEvaluations.submittedAt),
    ))

  if (rows.length === 0) return []

  // Load submitter emails
  const submitterIds = [...new Set(rows.map(r => r.submittedBy).filter(Boolean) as string[])]
  const submitterMap = submitterIds.length > 0
    ? new Map((await db
        .select({ id: persons.id, email: persons.email })
        .from(persons)
        .where(inArray(persons.id, submitterIds))
      ).map(p => [p.id, p.email ?? null]))
    : new Map<string, string | null>()

  // Load recommended course names for rows that have one
  const courseIds = [...new Set(rows.map(r => r.recommendedCourseId).filter(Boolean) as string[])]
  const courseMap = courseIds.length > 0
    ? new Map((await db
        .select({ id: rosterCourseCatalog.id, shortCode: rosterCourseCatalog.shortCode })
        .from(rosterCourseCatalog)
        .where(inArray(rosterCourseCatalog.id, courseIds))
      ).map(c => [c.id, c]))
    : new Map<string, { id: string; shortCode: string | null }>()

  // The school's evaluation scale: a criterion is answered when it holds one of its values.
  const scale = new Set((await tenantRules(tenantId)).codes.evaluation.map(v => v.value))

  // Load all eval templates once to check criteria completeness
  const templates = await db
    .select({ courseLevel: rosterEvalTemplates.courseLevel, sections: rosterEvalTemplates.sections })
    .from(rosterEvalTemplates)
    .where(eq(rosterEvalTemplates.tenantId, tenantId))
  const templateByLevel = new Map(templates.map(t => [t.courseLevel, t.sections as { name: string; criteria: string[] }[]]))
  // A course with no level takes the template of the level a new child starts at.
  const startLevel = (await courseRules(tenantId)).noviceStartLevel

  return rows
    .map(r => {
      const rec      = r.recommendedCourseId ? courseMap.get(r.recommendedCourseId) : null
      const tmpl     = templateByLevel.get(r.courseLevel ?? startLevel) ?? (templates[0]?.sections as { name: string; criteria: string[] }[] ?? [])
      const responses = (r.responses ?? {}) as Record<string, string>
      const VALID    = scale
      let missing    = 0
      for (const section of tmpl) {
        for (const criterion of section.criteria) {
          if (!VALID.has(responses[criterion])) missing++
        }
      }
      const hasComment        = !!r.teacherCommentCode
      const hasRecommendation = !!r.recommendedCourseId
      const isComplete        = missing === 0 && hasComment && hasRecommendation
      return {
        evalId: r.evalId,
        studentId: r.studentId,
        studentName: `${r.firstName ?? ''} ${r.lastName ?? ''}`.trim(),
        evalYear: r.evalYear,
        currentClassShortCode:  r.currentShortCode ?? '—',
        recommendedShortCode:   rec?.shortCode ?? null,
        recommendedCourseId:    r.recommendedCourseId ?? null,
        approvedAt:             r.approvedAt ? r.approvedAt.toISOString() : null,
        isComplete,
        missingCriteria:        missing,
        missingComment:         !hasComment,
        missingRecommendation:  !hasRecommendation,
        submittedBy:            r.submittedBy ?? null,
        submittedByEmail:       r.submittedBy ? (submitterMap.get(r.submittedBy) ?? null) : null,
      }
    })
    .sort((a, b) => names(a.studentName, b.studentName))
}

/** The ids of the year's submitted evaluations. */
export async function submittedEvaluationIds(tenantId: string, year: number): Promise<string[]> {
  const submitted = await db
    .select({ id: rosterEvaluations.id })
    .from(rosterEvaluations)
    .where(and(
      eq(rosterEvaluations.tenantId, tenantId),
      eq(rosterEvaluations.year, year),
      isNotNull(rosterEvaluations.submittedAt),
    ))
  return submitted.map(r => r.id)
}

/** Whether the family holds an enrollment marked enrolled for the year. */
export async function familyEnrolledIn(tenantId: string, familyId: string, year: number): Promise<boolean> {
  return (await db.select({ id: familyEnrollments.id })
    .from(familyEnrollments)
    .where(and(
      eq(familyEnrollments.tenantId, tenantId),
      eq(familyEnrollments.familyId, familyId),
      eq(familyEnrollments.year, year),
      eq(familyEnrollments.status, 'enrolled'),
    ))
    .limit(1)).length > 0
}

/** A submitted evaluation's student, recommendation, approval and comment; null when the tenant has none submitted by that id. */
export async function submittedEvaluation(tenantId: string, evalId: string) {
  const [ev] = await db
    .select({
      studentId:           rosterEvaluations.studentId,
      recommendedCourseId: rosterEvaluations.recommendedCourseId,
      languageApprovedAt:  rosterEvaluations.languageApprovedAt,
      teacherCommentCode:  rosterEvaluations.teacherCommentCode,
    })
    .from(rosterEvaluations)
    .where(and(
      eq(rosterEvaluations.id, evalId),
      eq(rosterEvaluations.tenantId, tenantId),
      isNotNull(rosterEvaluations.submittedAt),
    ))
    .limit(1)
  return ev ?? null
}

/** An evaluation's language-approval time; null when the tenant has no such evaluation. */
export async function evaluationApproval(tenantId: string, evalId: string) {
  const [ev] = await db
    .select({ languageApprovedAt: rosterEvaluations.languageApprovedAt })
    .from(rosterEvaluations)
    .where(and(eq(rosterEvaluations.id, evalId), eq(rosterEvaluations.tenantId, tenantId)))
    .limit(1)
  return ev ?? null
}
