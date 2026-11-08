// Fetch all data needed to build an evaluation PDF for a given evaluation ID.

import { familyRecipients } from './family-recipients'
import { rosterClassCode } from './roster-class-code'
import { db } from './db'
import {
  rosterEvaluations, rosterAvailableClasses, rosterCourseCatalog,
  rosterEvalTemplates, rosterTeacherCommentCodes, rosterTeachers,
  persons, rosterFamilies,
} from '../tables'
import { eq, and, inArray, or } from 'drizzle-orm'
import { schoolYearLabel } from './enrollment'
import { ports } from '../ports'
import { courseRules } from './rules-context'

/** What an evaluation's PDF draws (the host's evaluation PDF renderer draws it). */
export type EvalPdfData = {
  schoolYear: string          // "YYYY–YY", from schoolYearLabel()
  studentName: string
  parentNames: string         // the parents' first names, then the surname: "Ann / Bob Example"
  currentClass: string         // the class's code and course title
  recommendedClass: string     // the recommended class's code and course title (empty if no recommendation)
  recommendedClassCode: string // its short code only (empty if no recommendation)
  teacherName: string
  sections: Array<{
    name: string
    criteria: Array<{ text: string; rating: string }>
  }>
  comments: string[]          // comment texts (from comment codes)
  logoPath: string | null     // the tenant's logo as a file (the configuration port); null when it has none
}

export type EvalEmailTarget = {
  evalId: string
  studentId: string
  studentName: string
  parentNames: string
  parentEmails: string[]
  parents: { id: string; name: string }[]
  teacherPersonId: string | null
  familyId: string | null
  pdfData: EvalPdfData
}

export async function buildEvalEmailTarget(
  evalId: string,
  tenantId: string,
): Promise<EvalEmailTarget | null> {
  // Load evaluation
  const evals = await db
    .select()
    .from(rosterEvaluations)
    .where(and(eq(rosterEvaluations.id, evalId), eq(rosterEvaluations.tenantId, tenantId)))
    .limit(1)
  const ev = evals[0]
  if (!ev) return null

  // Load class + course
  const classes = await db
    .select({
      shortCode: rosterCourseCatalog.shortCode,
      section: rosterAvailableClasses.section,
      fullName: rosterCourseCatalog.fullName,
      courseLevel: rosterCourseCatalog.level,
    })
    .from(rosterAvailableClasses)
    .leftJoin(rosterCourseCatalog, eq(rosterCourseCatalog.id, rosterAvailableClasses.courseId))
    .where(eq(rosterAvailableClasses.id, ev.classId))
    .limit(1)
  const cls = classes[0]

  // Load recommended course
  let recommendedClass = ''
  let recommendedClassCode = ''
  if (ev.recommendedCourseId) {
    const recs = await db
      .select({ shortCode: rosterCourseCatalog.shortCode, fullName: rosterCourseCatalog.fullName })
      .from(rosterCourseCatalog)
      .where(eq(rosterCourseCatalog.id, ev.recommendedCourseId))
      .limit(1)
    if (recs[0]) {
      recommendedClass = `${recs[0].shortCode} ${recs[0].fullName}`
      recommendedClassCode = recs[0].shortCode
    }
  }

  // Load student
  const students = await db
    .select({ firstName: persons.firstName, lastName: persons.lastName, familyId: persons.familyId })
    .from(persons)
    .where(eq(persons.id, ev.studentId))
    .limit(1)
  const student = students[0]
  if (!student) return null
  const studentName = `${student.firstName} ${student.lastName}`.trim()

  // Load family (parents via motherId/fatherId → persons)
  let parentNames = ''
  let parentEmails: string[] = []
  let parentList: { id: string; name: string }[] = []
  if (student.familyId) {
    const families = await db
      .select({ motherId: rosterFamilies.motherId, fatherId: rosterFamilies.fatherId })
      .from(rosterFamilies)
      .where(eq(rosterFamilies.id, student.familyId))
      .limit(1)
    const fam = families[0]
    if (fam) {
      const parentIds = [fam.motherId, fam.fatherId].filter(Boolean) as string[]
      if (parentIds.length > 0) {
        const parents = await db
          .select({ id: persons.id, firstName: persons.firstName, lastName: persons.lastName, email: persons.email })
          .from(persons)
          .where(inArray(persons.id, parentIds))
        const firstNames = parents.map(p => p.firstName).filter(Boolean).join(' / ')
        const lastName = parents[0]?.lastName ?? student.lastName ?? ''
        parentNames = firstNames ? `${firstNames} ${lastName}`.trim() : lastName
        parentEmails = parents.map(p => p.email).filter(Boolean) as string[]
        parentList = parents.map(p => ({ id: p.id, name: `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim() }))
      }
    }
  }

  // An evaluation email: the family emits its list — the student evaluated and the parents (lib/family-recipients).
  // The field keeps its name for its callers.
  if (student.familyId) parentEmails = await familyRecipients(tenantId, student.familyId, 'evaluation', { studentId: ev.studentId })

  // Load teacher name
  const teachers = await db
    .select({ personId: rosterTeachers.personId, firstName: persons.firstName, lastName: persons.lastName })
    .from(rosterTeachers)
    .leftJoin(persons, eq(persons.id, rosterTeachers.personId))
    .where(and(
      eq(rosterTeachers.tenantId, tenantId),
      eq(rosterTeachers.classId, ev.classId),
    ))
    .limit(1)
  const teacherName = teachers[0]
    ? `${teachers[0].firstName ?? ''} ${teachers[0].lastName ?? ''}`.trim()
    : ''
  const teacherPersonId = teachers[0]?.personId ?? null

  // Load eval template for this class's course level
  const templates = await db
    .select({ sections: rosterEvalTemplates.sections, courseLevel: rosterEvalTemplates.courseLevel })
    .from(rosterEvalTemplates)
    .where(eq(rosterEvalTemplates.tenantId, tenantId))
  // A course with no level takes the template of the level a new child starts at.
  const level = cls?.courseLevel ?? (await courseRules(tenantId)).noviceStartLevel
  const template = templates.find(t => t.courseLevel === level) ?? templates[0]
  const sections = (template?.sections as Array<{ name: string; criteria: string[] }>) ?? []

  // Load comment code texts
  const responses = ev.responses as Record<string, string>
  let comments: string[] = []
  if (ev.teacherCommentCode) {
    const codes = await db
      .select({ text: rosterTeacherCommentCodes.text })
      .from(rosterTeacherCommentCodes)
      .where(and(
        eq(rosterTeacherCommentCodes.tenantId, tenantId),
        inArray(rosterTeacherCommentCodes.id, [ev.teacherCommentCode]),
      ))
    comments = codes.map(c => c.text)
  }

  const schoolYear = schoolYearLabel(ev.year)
  const currentClass = cls ? `${rosterClassCode(cls)} ${cls.fullName}` : ''

  const pdfData: EvalPdfData = {
    schoolYear,
    studentName,
    parentNames,
    currentClass,
    recommendedClass,
    recommendedClassCode,
    teacherName,
    sections: sections.map(s => ({
      name: s.name,
      criteria: s.criteria.map(c => ({
        text: c,
        rating: responses[c] ?? '',
      })),
    })),
    comments,
    logoPath: await ports().tenants.logoFile(tenantId),
  }

  return { evalId, studentId: ev.studentId, studentName, parentNames, parentEmails, parents: parentList, teacherPersonId, familyId: student.familyId, pdfData }
}

/**
 * May an address's family see an evaluation — the family check of an evaluation's read, its PDF and the API's
 * evaluation.target. `null` when the tenant has no such evaluation; otherwise whether the address's person and the
 * evaluated student share a family.
 */
export async function evaluationFamilyMayView(tenantId: string, evalId: string, email: string): Promise<boolean | null> {
  const [ev] = await db
    .select({ studentId: rosterEvaluations.studentId })
    .from(rosterEvaluations)
    .where(and(eq(rosterEvaluations.id, evalId), eq(rosterEvaluations.tenantId, tenantId)))
    .limit(1)
  if (!ev) return null

  const [userPerson] = await db
    .select({ familyId: persons.familyId })
    .from(persons)
    .where(and(eq(persons.email, email), eq(persons.tenantId, tenantId)))
    .limit(1)
  const [studentPerson] = await db
    .select({ familyId: persons.familyId })
    .from(persons)
    .where(and(eq(persons.id, ev.studentId), eq(persons.tenantId, tenantId)))
    .limit(1)

  return !!userPerson?.familyId && userPerson.familyId === studentPerson?.familyId
}

/** An evaluation's language-approval time and internal notes; null when the tenant has no such evaluation. */
export async function evaluationStatus(tenantId: string, evalId: string) {
  const [evalStatus] = await db
    .select({ languageApprovedAt: rosterEvaluations.languageApprovedAt, internalNotes: rosterEvaluations.internalNotes })
    .from(rosterEvaluations)
    .where(and(eq(rosterEvaluations.id, evalId), eq(rosterEvaluations.tenantId, tenantId)))
    .limit(1)
  return evalStatus ?? null
}
