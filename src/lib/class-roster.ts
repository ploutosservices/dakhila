// ONE ROSTER CLASS, as a reader shows it and as the class's email carries it: both read this, so
// what the sender sends is what they are looking at.
//
// It also decides the two things about COLUMNS that are facts about the rows, not about a screen:
//   - a column no row fills is dropped;
//   - a student attribute every row shares is an attribute of the class, and moves up to it. When
//     the rows differ it stays a column: it is each student's own preferred language, not the class's.
import type { TeacherType } from './teacher-type'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { db } from './db'
import {
  persons, rosterAvailableClasses, rosterCourseCatalog, rosterEnrollments,
  rosterFamilies, rosterTeachers,
} from '../tables'
import { gradeLabel, type Grades } from './enrollment'
import { academicYearOf } from './year-context'
import { formatPhone } from './format-phone'
import { phoneRules } from './rules-context'
import { resolveStudentAddress } from './student-address'
import { requireTenant } from './roster-public-url'
import { classFamilies, type DepartmentFamily } from './department-roster'
import { joinedIndex, type JoinedIndex, type JoinedState } from './student-joined'
import { courseRules } from './rules-context'
import { workspaceDomain } from './role-mailbox'
import { courseOf } from './classroom-mirror'

/** A child's grade as printed, in the school's words (enrollment.ts gradeLabel). */
export function calcGrade(grades: Grades, firstGradeYear: number | null, schoolYear: number): string {
  return gradeLabel(grades, schoolYear, firstGradeYear)
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ')

export type ClassRosterStudent = {
  personId: string
  name: string
  grade: string
  language: string | null
  familyId: string | null
  familyNumber: number | null
  email: string | null          // the emission rule: own, else the guardian-named parent's
  phone: string | null
  joined: JoinedState
}
export type ClassRosterTeacher = { personId: string; name: string; typeOfTeacher: TeacherType; isChild: boolean; phone: string | null; email: string | null }

export type ClassRoster = {
  cls: {
    id: string; year: number; section: string | null; startTime: string | null; endTime: string | null
    meet: string | null; classroomCourseId: string | null; classroomName: string | null
    classroomUrl: string | null; enrollmentCode: string | null
    shortCode: string | null; department: string | null; level: number | null; department2: number | null
  }
  department: string | null     // for display: the department's name, capitalised
  /** A standby class is a waiting room, not a class: its page and its mail are the students and their
   *  families, and the ask is to evaluate and place them. */
  standby: boolean
  zone: string
  teachers: ClassRosterTeacher[]
  students: ClassRosterStudent[]
  families: DepartmentFamily[]
  joined: JoinedIndex
  /** Every student's preferred language when all share one — shown on the class, not per row. */
  sharedLanguage: string | null
  /** Which optional student columns any row fills. */
  columns: { language: boolean; email: boolean; phone: boolean; joined: boolean }
  teacherColumns: { phone: boolean; email: boolean }
}

export async function classRoster(tenantId: string, classId: string): Promise<ClassRoster | null> {
  const [row] = await db
    .select({
      id: rosterAvailableClasses.id,
      year: rosterAvailableClasses.year,
      section: rosterAvailableClasses.section,
      startTime: rosterAvailableClasses.startTime,
      endTime: rosterAvailableClasses.endTime,
      classroomCourseId: rosterAvailableClasses.classroomCourseId,
      shortCode: rosterCourseCatalog.shortCode,
      department: rosterCourseCatalog.department,
      level: rosterCourseCatalog.level,
      department2: rosterCourseCatalog.department2,
    })
    .from(rosterAvailableClasses)
    .leftJoin(rosterCourseCatalog, eq(rosterCourseCatalog.id, rosterAvailableClasses.courseId))
    .where(and(eq(rosterAvailableClasses.id, classId), eq(rosterAvailableClasses.tenantId, tenantId)))
    .limit(1)
  if (!row) return null
  const c = (await courseOf([row]))(row)
  const cls = {
    id: row.id, year: row.year, section: row.section, startTime: row.startTime, endTime: row.endTime,
    meet: c?.meet ?? null,   // the Google Classroom's — the one Meet store
    classroomCourseId: row.classroomCourseId,
    classroomName: c?.name ?? null,
    classroomUrl: c?.alternateLink ?? null,
    enrollmentCode: c?.enrollmentCode ?? null,
    shortCode: row.shortCode, department: row.department, level: row.level, department2: row.department2,
  }

  const teacherRows = await db
    .select({
      personId: persons.id, firstName: persons.firstName, lastName: persons.lastName,
      typeOfTeacher: rosterTeachers.typeOfTeacher, phone: persons.phone, email: persons.email, role: persons.role,
    })
    .from(rosterTeachers)
    .innerJoin(persons, eq(persons.id, rosterTeachers.personId))
    .where(and(eq(rosterTeachers.classId, classId), eq(rosterTeachers.tenantId, tenantId)))
    .orderBy(asc(persons.lastName), asc(persons.firstName))

  const motherPersons = alias(persons, 'mother_person')
  const fatherPersons = alias(persons, 'father_person')
  const enrollments = await db
    .select({
      personId: persons.id, firstName: persons.firstName, lastName: persons.lastName,
      firstGradeYear: persons.firstGradeYear, preferredLanguage: persons.preferredLanguage,
      email: persons.email, phone: persons.phone, guardian: persons.guardian, familyId: persons.familyId,
      legacyFamilyId: rosterFamilies.legacyFamilyId,
      motherId: rosterFamilies.motherId, fatherId: rosterFamilies.fatherId,
      motherEmail: motherPersons.email, fatherEmail: fatherPersons.email,
    })
    .from(rosterEnrollments)
    .innerJoin(persons, eq(persons.id, rosterEnrollments.studentId))
    .leftJoin(rosterFamilies, eq(rosterFamilies.id, persons.familyId))
    .leftJoin(motherPersons, eq(motherPersons.id, rosterFamilies.motherId))
    .leftJoin(fatherPersons, eq(fatherPersons.id, rosterFamilies.fatherId))
    .where(and(
      eq(rosterEnrollments.classId, classId),
      eq(rosterEnrollments.tenantId, tenantId),
      isNull(persons.deletedAt),
      isNull(rosterEnrollments.droppedOutAt),
      isNull(rosterEnrollments.deletedAt),
    ))
    .orderBy(asc(persons.lastName), asc(persons.firstName))

  const [zone, joined, domain, phone, { grades }] = await Promise.all([requireTenant(tenantId).then(t => t.timezone), joinedIndex(tenantId), workspaceDomain(tenantId), phoneRules(tenantId), courseRules(tenantId)])
  // The families, as THE family card — one card wherever parents are shown.
  // ONLY FOR THE SESSION IN PROGRESS — a previous year's class does not need parent cards; parent
  // cards are relevant only for the current academic session. Decided here, so every reader agrees.
  const families = cls.year === await academicYearOf(tenantId) ? await classFamilies(tenantId, cls.year, classId, joined) : []

  const students: ClassRosterStudent[] = enrollments.map(e => ({
    personId: e.personId,
    name: [e.firstName, e.lastName].filter(Boolean).join(' '),
    grade: calcGrade(grades, e.firstGradeYear, cls.year),
    language: e.preferredLanguage ? capital(e.preferredLanguage) : null,
    familyId: e.familyId,
    familyNumber: e.legacyFamilyId ?? null,
    // The emission rule: own email first, else the guardian-named parent's.
    email: resolveStudentAddress({
      email: e.email, guardian: e.guardian, motherId: e.motherId, fatherId: e.fatherId,
      motherEmail: e.motherEmail, fatherEmail: e.fatherEmail, domain,
    }).email,
    phone: e.phone?.trim() ? formatPhone(e.phone, phone) : null,
    joined: joined.get(e.personId, classId),
  }))
  const teachers: ClassRosterTeacher[] = teacherRows.map(t => ({
    personId: t.personId,
    name: [t.firstName, t.lastName].filter(Boolean).join(' '),
    typeOfTeacher: t.typeOfTeacher,
    isChild: t.role === 'boy' || t.role === 'girl',
    phone: t.phone?.trim() ? formatPhone(t.phone, phone) : null,
    email: t.email?.trim() || null,
  }))

  const languages = new Set(students.map(s => s.language))
  const sharedLanguage = students.length > 0 && languages.size === 1 ? [...languages][0] : null

  return {
    cls,
    department: cls.department ? capital(cls.department) : null,
    standby: cls.department2 === (await courseRules(tenantId)).standbyDepartment2,
    zone,
    teachers,
    students,
    families,
    joined,
    sharedLanguage,
    columns: {
      language: !sharedLanguage && students.some(s => s.language),
      // A student with no address is a follow-up — so the column stays while any row is missing one.
      email: students.length > 0,
      phone: students.some(s => s.phone),
      // "No classroom" on every row is a fact about the class — said once for the class, not as a column.
      joined: students.some(s => s.joined.state !== 'unknown' && s.joined.state !== 'no-classroom'),
    },
    teacherColumns: { phone: teachers.some(t => t.phone), email: teachers.some(t => t.email) },
  }
}
