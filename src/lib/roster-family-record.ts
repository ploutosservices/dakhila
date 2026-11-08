// The record layer of the ONE family read: everything the roster
// holds about a family, assembled once, for both readers: the family itself and the principal viewing it.

import type { TeacherType } from './teacher-type'
import { rosterClassCode } from './roster-class-code'
import { db } from './db'
import {
  rosterFamilyTracker,
  rosterEnrollments, rosterAvailableClasses, rosterCourseCatalog,
  rosterTeachers, rosterEvaluations,
  familyEnrollments, cashEnrollmentPayments,
  rosterFamilies, persons,
} from '../tables'
import { courseOf } from './classroom-mirror'
import { usersByIds } from './record-history'
import { eq, and, isNull, isNotNull, desc, inArray, sql } from 'drizzle-orm'
import { schoolYearLabel } from './enrollment'
import { currentAcademicYear, enrollmentYear } from './years'
import { enrollmentYearOf, yearRules } from './year-context'
import { ports } from '../ports'
import { owedAndPaidOf } from './tuition-owed-store'
import { getFamily, getPersonsByIds, getFamilyMembers } from './roster-families'
import { setEnrollmentStatus, getEnrollment, getEnrollmentStudents } from './family-enrollment'
import { tenantRules } from './rules-context'
import { moneyIn, moneyRules } from './fees'
import { tenantTimezone } from './tenant'
import { byCode, isoDayIn } from './zoned'

export type ClassRef = {
  classId: string; shortCode: string; section: string | null; department: string
  /** The day they left this class, or null while they are in it. A teacher reference never carries
   *  one — a teacher is assigned or not, with no third state. */
  droppedOutAt?: string | null
}
export type PersonYearEntry = { personId: string; year: number; studentClasses: ClassRef[]; teacherClasses: ClassRef[] }

export type TeacherClassRef = {
  personId: string
  classId: string
  shortCode: string
  section: string | null
  fullName: string
  department: string
  typeOfTeacher: TeacherType
  classroomCourseId: string | null
  classroomName: string | null
  meet: string | null
  startTime: string | null
  endTime: string | null
}

export type EnrollmentData = {
  enrollmentId: string
  year: number
  status: string
  fee: number
  totalPaid: number
  students: {
    enrollmentStudentId: string
    studentId: string
    name: string
    droppedOutAt: Date | null
    classes: { rosterEnrollmentId: string; classId: string; shortCode: string; section: string | null; fullName: string; department: string }[]
  }[]
  availableClasses: { id: string; shortCode: string; fullName: string; department: string; startTime: string | null; endTime: string | null; section: string | null }[]
}

export type ActivityItem = {
  type: 'enrollment_created' | 'payment' | 'class_assigned'
  timestamp: Date
  description: string
  actor: string | null
}

export type FamilyRecord = {
  family: NonNullable<Awaited<ReturnType<typeof getFamily>>>
  members: Awaited<ReturnType<typeof getFamilyMembers>>
  tracker: (typeof rosterFamilyTracker.$inferSelect)[]
  personYearHistory: PersonYearEntry[]
  currentTeacherClasses: TeacherClassRef[]
  evalStatus: Record<string, { submitted: number; total: number }>
  enrollmentData: EnrollmentData | null
  activityItems: ActivityItem[]
}

/**
 * THE RETROACTIVE FIX, AS ITS OWN ACT: a family's enrollment for the enrollment
 * year still pending though its fee is above nothing and paid in full is marked enrolled. A caller asks for this before
 * it reads the record; a read writes nothing. Answers whether it marked.
 */
export async function markPaidEnrollment(tenantId: string, familyId: string): Promise<boolean> {
  const feeEnrollment = await getEnrollment(tenantId, familyId, await enrollmentYearOf(tenantId))
  if (!feeEnrollment || feeEnrollment.status !== 'pending') return false
  const { owed: fee, paid: totalPaid } = await owedAndPaidOf(feeEnrollment.id)
  if (!(fee > 0 && totalPaid >= fee)) return false
  await setEnrollmentStatus(tenantId, feeEnrollment.id, 'enrolled')
  return true
}

export async function getFamilyRecord(
  tenantId: string,
  familyId: string,
  opts: { includeActivity?: boolean } = {},
): Promise<FamilyRecord | null> {
  const family = await getFamily(tenantId, familyId)
  if (!family) return null
  const moneyOf = moneyRules(await tenantRules(tenantId))
  const zone = await tenantTimezone(tenantId)
  if (!zone) throw new Error(`no live tenant ${tenantId}, so no time zone to date its record in`)

  const members = await getFamilyMembers(tenantId, familyId)
  const parentIds = [family.motherId, family.fatherId].filter(Boolean) as string[]
  const parents = await getPersonsByIds(tenantId, parentIds)
  const memberIdSet = new Set(members.map(m => m.id))
  const allMembers = [...members, ...parents.filter(p => !memberIdSet.has(p.id))]
  const memberIds = allMembers.map(m => m.id)

  const tracker = await db
    .select()
    .from(rosterFamilyTracker)
    .where(and(
      eq(rosterFamilyTracker.familyId, familyId),
      eq(rosterFamilyTracker.tenantId, tenantId),
    ))
    .orderBy(desc(rosterFamilyTracker.year))

  const personYearHistory: PersonYearEntry[] = []
  if (memberIds.length > 0) {
    const [enrollments, teaching] = await Promise.all([
      db.select({
        personId: rosterEnrollments.studentId,
        classId: rosterAvailableClasses.id,
        year: rosterAvailableClasses.year,
        shortCode: rosterCourseCatalog.shortCode,
        section: rosterAvailableClasses.section,
        department: rosterCourseCatalog.department,
        // WHETHER THEY ARE STILL IN IT: a class's own list leaves out a dropped child, and without this a dropped row
        // would read here as a class the child attends. The row is still HISTORY and is still shown; what it may not do
        // is read as current.
        droppedOutAt: rosterEnrollments.droppedOutAt,
      })
        .from(rosterEnrollments)
        .leftJoin(rosterAvailableClasses, eq(rosterAvailableClasses.id, rosterEnrollments.classId))
        .leftJoin(rosterCourseCatalog, eq(rosterCourseCatalog.id, rosterAvailableClasses.courseId))
        // A deleted enrollment is not history.
        .where(and(inArray(rosterEnrollments.studentId, memberIds), isNull(rosterEnrollments.deletedAt))),
      db.select({
        personId: rosterTeachers.personId,
        classId: rosterAvailableClasses.id,
        year: rosterAvailableClasses.year,
        shortCode: rosterCourseCatalog.shortCode,
        section: rosterAvailableClasses.section,
        department: rosterCourseCatalog.department,
      })
        .from(rosterTeachers)
        .leftJoin(rosterAvailableClasses, eq(rosterAvailableClasses.id, rosterTeachers.classId))
        .leftJoin(rosterCourseCatalog, eq(rosterCourseCatalog.id, rosterAvailableClasses.courseId))
        .where(inArray(rosterTeachers.personId, memberIds)),
    ])

    const map = new Map<string, PersonYearEntry>()
    const key = (personId: string, year: number) => `${personId}:${year}`

    for (const e of enrollments) {
      if (!e.year || !e.shortCode || !e.classId) continue
      const k = key(e.personId, e.year)
      const entry = map.get(k) ?? { personId: e.personId, year: e.year, studentClasses: [], teacherClasses: [] }
      entry.studentClasses.push({
        classId: e.classId, shortCode: e.shortCode, section: e.section, department: e.department ?? '',
        droppedOutAt: e.droppedOutAt ? isoDayIn(e.droppedOutAt, zone) : null,
      })
      map.set(k, entry)
    }
    for (const t of teaching) {
      if (!t.year || !t.shortCode || !t.classId) continue
      const k = key(t.personId, t.year)
      const entry = map.get(k) ?? { personId: t.personId, year: t.year, studentClasses: [], teacherClasses: [] }
      entry.teacherClasses.push({ classId: t.classId, shortCode: t.shortCode, section: t.section, department: t.department ?? '' })
      map.set(k, entry)
    }

    personYearHistory.push(...Array.from(map.values()).sort((a, b) => b.year - a.year || byCode(a.personId, b.personId)))
  }

  const y = await yearRules(tenantId)
  const at = ports().clock.now()
  const currentYear = enrollmentYear(y, at)
  const academicYear = currentAcademicYear(y, at)
  const teacherClassRows = memberIds.length > 0
    ? await db
      .select({
        personId: rosterTeachers.personId,
        classId: rosterAvailableClasses.id,
        shortCode: rosterCourseCatalog.shortCode,
        section: rosterAvailableClasses.section,
        fullName: rosterCourseCatalog.fullName,
        department: rosterCourseCatalog.department,
        typeOfTeacher: rosterTeachers.typeOfTeacher,
        classroomCourseId: rosterAvailableClasses.classroomCourseId,
        startTime: rosterAvailableClasses.startTime,
        endTime: rosterAvailableClasses.endTime,
      })
      .from(rosterTeachers)
      .leftJoin(rosterAvailableClasses, eq(rosterAvailableClasses.id, rosterTeachers.classId))
      .leftJoin(rosterCourseCatalog, eq(rosterCourseCatalog.id, rosterAvailableClasses.courseId))
      .where(and(
        inArray(rosterTeachers.personId, memberIds),
        eq(rosterAvailableClasses.year, academicYear),
      ))
      // By level, then department.
      .orderBy(rosterCourseCatalog.level, rosterCourseCatalog.department, rosterAvailableClasses.section)
    : []
  const courseOfClass = await courseOf(teacherClassRows)
  const teacherRows = teacherClassRows.map(r => ({
    ...r,
    classroomName: courseOfClass(r)?.name ?? null,   // Google's own name for the room
    meet: courseOfClass(r)?.meet ?? null,   // the Google Classroom's — the one Meet store
  }))
  const currentTeacherClasses: TeacherClassRef[] = teacherRows
    .filter(c => c.classId && c.shortCode)
    .map(c => ({
      personId: c.personId,
      classId: c.classId!,
      shortCode: c.shortCode!,
      section: c.section ?? null,
      fullName: c.fullName ?? '',
      department: c.department ?? '',
      typeOfTeacher: c.typeOfTeacher,
      classroomCourseId: c.classroomCourseId ?? null,
      classroomName: c.classroomName ?? null,
      meet: c.meet ?? null,
      startTime: c.startTime ?? null,
      endTime: c.endTime ?? null,
    }))

  // Evaluation status per class (submitted count + total enrolled)
  const teacherClassIds = currentTeacherClasses.map(c => c.classId)
  const evalStatus: Record<string, { submitted: number; total: number }> = {}

  if (teacherClassIds.length > 0) {
    const [totals, submitted] = await Promise.all([
      db.select({ classId: rosterEnrollments.classId, total: sql<number>`COUNT(*)::int` })
        .from(rosterEnrollments)
        .where(and(
          inArray(rosterEnrollments.classId, teacherClassIds),
          isNull(rosterEnrollments.droppedOutAt),
          isNull(rosterEnrollments.deletedAt),
        ))
        .groupBy(rosterEnrollments.classId),
      db.select({ classId: rosterEvaluations.classId, count: sql<number>`COUNT(*)::int` })
        .from(rosterEvaluations)
        .where(and(
          inArray(rosterEvaluations.classId, teacherClassIds),
          eq(rosterEvaluations.year, academicYear),
          isNotNull(rosterEvaluations.submittedAt),
        ))
        .groupBy(rosterEvaluations.classId),
    ])
    for (const r of totals) evalStatus[r.classId] = { total: r.total, submitted: 0 }
    for (const r of submitted) {
      if (evalStatus[r.classId]) evalStatus[r.classId].submitted = r.count
      else evalStatus[r.classId] = { total: 0, submitted: r.count }
    }
  }

  // Current-year fee enrollment
  const feeEnrollment = await getEnrollment(tenantId, familyId, currentYear)

  let enrollmentData: EnrollmentData | null = null

  if (feeEnrollment) {
    const enrollmentStudents = await getEnrollmentStudents(feeEnrollment.id)
    const allStudentIds = enrollmentStudents.map(r => r.studentId)

    // What it owes and has paid: the one rule (tuition-owed-store.ts).
    const { owed: fee, paid: totalPaid } = await owedAndPaidOf(feeEnrollment.id)

    // Fetches ALL assignments (active + preserved-on-dropout) so the UI can show both states.
    const classAssignments = allStudentIds.length > 0
      ? await db
        .select({
          rosterEnrollmentId: rosterEnrollments.id,
          studentId: rosterEnrollments.studentId,
          classId: rosterAvailableClasses.id,
          shortCode: rosterCourseCatalog.shortCode,
          section: rosterAvailableClasses.section,
          fullName: rosterCourseCatalog.fullName,
          department: rosterCourseCatalog.department,
        })
        .from(rosterEnrollments)
        .innerJoin(rosterAvailableClasses, and(
          eq(rosterAvailableClasses.id, rosterEnrollments.classId),
          eq(rosterAvailableClasses.year, currentYear),
        ))
        .leftJoin(rosterCourseCatalog, eq(rosterCourseCatalog.id, rosterAvailableClasses.courseId))
        .where(and(
          inArray(rosterEnrollments.studentId, allStudentIds),
          isNull(rosterEnrollments.deletedAt),
        ))
      : []

    const availableClasses = await db
      .select({
        id: rosterAvailableClasses.id,
        shortCode: rosterCourseCatalog.shortCode,
        fullName: rosterCourseCatalog.fullName,
        department: rosterCourseCatalog.department,
        startTime: rosterAvailableClasses.startTime,
        endTime: rosterAvailableClasses.endTime,
        section: rosterAvailableClasses.section,
      })
      .from(rosterAvailableClasses)
      .leftJoin(rosterCourseCatalog, eq(rosterCourseCatalog.id, rosterAvailableClasses.courseId))
      .where(and(
        eq(rosterAvailableClasses.tenantId, tenantId),
        eq(rosterAvailableClasses.year, currentYear),
      ))

    enrollmentData = {
      enrollmentId: feeEnrollment.id,
      year: currentYear,
      status: feeEnrollment.status,
      fee,
      totalPaid,
      students: enrollmentStudents.map(es => {
        const student = allMembers.find(m => m.id === es.studentId)
        const name = student ? `${student.firstName}${student.lastName ? ' ' + student.lastName : ''}` : es.studentId
        return {
          enrollmentStudentId: es.id,
          studentId: es.studentId,
          name,
          droppedOutAt: es.droppedOutAt,
          classes: classAssignments
            .filter(c => c.studentId === es.studentId)
            .map(c => ({
              rosterEnrollmentId: c.rosterEnrollmentId,
              classId: c.classId!,
              shortCode: c.shortCode ?? '',
              section: c.section ?? null,
              fullName: c.fullName ?? '',
              department: c.department ?? '',
            })),
        }
      }),
      availableClasses: availableClasses.map(c => ({
        id: c.id,
        shortCode: c.shortCode ?? '',
        fullName: c.fullName ?? '',
        department: c.department ?? '',
        startTime: c.startTime ?? null,
        endTime: c.endTime ?? null,
        section: c.section ?? null,
      })),
    }

    // The retroactive fix is its own act, markPaidEnrollment below: a read writes nothing.
  }

  const activityItems: ActivityItem[] = []
  if (opts.includeActivity) {
    const allEnrollments = await db
      .select({ id: familyEnrollments.id, year: familyEnrollments.year, createdAt: familyEnrollments.createdAt })
      .from(familyEnrollments)
      .where(and(eq(familyEnrollments.tenantId, tenantId), eq(familyEnrollments.familyId, familyId)))

    for (const e of allEnrollments) {
      activityItems.push({ type: 'enrollment_created', timestamp: e.createdAt, description: `Enrollment started (${schoolYearLabel(e.year)})`, actor: null })
    }

    const allEnrollmentIds = allEnrollments.map(e => e.id)
    if (allEnrollmentIds.length > 0) {
      const payments = await db
        .select({
          amount: cashEnrollmentPayments.amount,
          method: cashEnrollmentPayments.method,
          paidAt: cashEnrollmentPayments.paidAt,
          notes: cashEnrollmentPayments.notes,
          createdAt: cashEnrollmentPayments.createdAt,
          recordedBy: cashEnrollmentPayments.recordedBy,
          year: familyEnrollments.year,
        })
        .from(cashEnrollmentPayments)
        .innerJoin(familyEnrollments, eq(familyEnrollments.id, cashEnrollmentPayments.enrollmentId))
        .where(inArray(cashEnrollmentPayments.enrollmentId, allEnrollmentIds))
      // Who recorded each payment: the host's users, by id (the record port).
      const recorders = [...new Set(payments.map(p => p.recordedBy).filter((id): id is string => !!id))]
      const emailOf = new Map((await usersByIds(recorders)).map(u => [u.id, u.email]))

      for (const p of payments.map(r => ({ ...r, actorEmail: r.recordedBy ? emailOf.get(r.recordedBy) ?? null : null }))) {
        const amt = moneyIn(moneyOf, parseFloat(p.amount as string))
        const via = p.method
        const pd = p.paidAt ? ` (paid ${p.paidAt})` : ''
        const note = p.notes ? ` — ${p.notes}` : ''
        const by = p.actorEmail ? ` · by ${p.actorEmail}` : ''
        activityItems.push({ type: 'payment', timestamp: p.createdAt, description: `${amt} via ${via}${pd}${note}${by}`, actor: null })
      }
    }

    if (memberIds.length > 0) {
      const classActivity = await db
        .select({
          studentId: rosterEnrollments.studentId,
          shortCode: rosterCourseCatalog.shortCode,
          section: rosterAvailableClasses.section,
          year: rosterAvailableClasses.year,
          createdAt: rosterEnrollments.createdAt,
        })
        .from(rosterEnrollments)
        .innerJoin(rosterAvailableClasses, eq(rosterAvailableClasses.id, rosterEnrollments.classId))
        .leftJoin(rosterCourseCatalog, eq(rosterCourseCatalog.id, rosterAvailableClasses.courseId))
        .where(inArray(rosterEnrollments.studentId, memberIds))

      for (const c of classActivity) {
        const student = allMembers.find(m => m.id === c.studentId)
        const name = student ? student.firstName : '?'
        activityItems.push({ type: 'class_assigned', timestamp: c.createdAt, description: `${name} → ${c.shortCode ? rosterClassCode(c) : '?'} (${schoolYearLabel(c.year ?? 0)})`, actor: null })
      }
    }

    activityItems.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
  }

  return {
    family,
    members: allMembers,
    tracker,
    personYearHistory,
    currentTeacherClasses,
    evalStatus,
    enrollmentData,
    activityItems,
  }
}
