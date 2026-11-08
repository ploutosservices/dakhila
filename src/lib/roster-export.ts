// THE ROSTER EXPORT'S ROWS. Each type answers one sheet — its name, its rows
// as the spreadsheet's columns — and the file's name; the door writes the workbook. The query parameters are the
// door's: type, year, id (a class), status (a tracker group or code).
import { teacherMark } from './teacher-type'
import { gradeLabel, type Grades } from './enrollment'
import { currentAcademicYear, enrollmentYear } from './years'
import { yearRules } from './year-context'
import { ports } from '../ports'
import { db } from './db'
import {
  persons,
  rosterFamilies,
  rosterAvailableClasses,
  rosterCourseCatalog,
  rosterEnrollments,
  rosterTeachers,
  rosterFamilyTracker,
  familyEnrollments,
} from '../tables'
import { eq, and, asc, isNull, sql, inArray } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { enrollmentStatusGroups, type EnrollmentStatusGroup } from './roster-enrollment-status'
import { tenantRules } from './rules-context'
import { timeWords } from './zoned'
import { resolveStudentAddress } from './student-address'
import { workspaceDomain } from './role-mailbox'
import { requireTenant } from './roster-public-url'

export type ExportParams = { type: string; year: string | null; id: string | null; status: string | null }
export type ExportSheet = { sheet: string; rows: Record<string, unknown>[]; filename: string }
export type ExportRefusal = { status: 400 | 404; error: string }


/** A child's grade in a sheet: the school's word before first grade and past its last grade, its sheet prefix and the number between. */
function calcGrade(grades: Grades, firstGradeYear: number | null, schoolYear: number): string {
  if (!firstGradeYear) return ''
  const label = gradeLabel(grades, schoolYear, firstGradeYear)
  return /^\d+$/.test(label) ? `${grades.sheetPrefix}${label}` : label
}

/** The file's name, from the sheet's name as the workbook will carry it. */
function fileName(slug: string, type: string, sheet: string, year: number): string {
  const sheetName = sheet.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase()
  return type === 'class'
    ? `${slug}-class-${sheetName}.xlsx`
    : `${slug}-roster-${type}${type === 'classes' || type === 'tracker' ? `-${year}` : ''}.xlsx`
}

export async function rosterExport(tenantId: string, p: ExportParams): Promise<ExportSheet | ExportRefusal> {
  const type = p.type || 'persons'
  // The default year is the one in session, turning on the school's one first day: the module holds no date of its own.
  const y = await yearRules(tenantId)
  const { codes, courses: { grades }, locale: { language } } = await tenantRules(tenantId)
  const fmtTime = (t: string | null | undefined) => t ? timeWords(t, language) : ''
  const at = ports().clock.now()
  const schoolYear = currentAcademicYear(y, at)
  const year = parseInt(p.year ?? String(schoolYear))
  // The file names start with the tenant's slug.
  const { slug } = await requireTenant(tenantId)
  const done = (sheet: string, rows: Record<string, unknown>[]): ExportSheet => ({ sheet, rows, filename: fileName(slug, type, sheet, year) })

  if (type === 'persons') {
    const rows = await db
      .select({
        firstName: persons.firstName,
        lastName: persons.lastName,
        role: persons.role,
        email: persons.email,
        phone: persons.phone,
        preferredLanguage: persons.preferredLanguage,
        legacyFamilyId: rosterFamilies.legacyFamilyId,
        legacyId: persons.legacyId,
      })
      .from(persons)
      .leftJoin(rosterFamilies, eq(rosterFamilies.id, persons.familyId))
      .where(and(eq(persons.tenantId, tenantId), isNull(persons.deletedAt)))
      .orderBy(asc(persons.lastName), asc(persons.firstName))

    return done('Persons', rows.map(p => ({
      'First Name': p.firstName,
      'Last Name': p.lastName ?? '',
      'Role': p.role ?? '',
      'Family ID': p.legacyFamilyId ?? '',
      'Language': p.preferredLanguage ?? '',
      'Email': p.email ?? '',
      'Phone': p.phone ?? '',
      ...(codes.legacyIdColumn ? { [codes.legacyIdColumn]: p.legacyId ?? '' } : {}),
    })))
  }

  if (type === 'students') {
    // The tenant's directory domain: a student never stands on an address in it.
    const domain = await workspaceDomain(tenantId)
    const motherPersons = alias(persons, 'mother_person')
    const fatherPersons = alias(persons, 'father_person')

    const rows = await db
      .select({
        firstName: persons.firstName,
        lastName: persons.lastName,
        birthDate: persons.birthDate,
        firstGradeYear: persons.firstGradeYear,
        preferredLanguage: persons.preferredLanguage,
        email: persons.email,
        guardian: persons.guardian,
        legacyFamilyId: rosterFamilies.legacyFamilyId,
        motherId: rosterFamilies.motherId,
        fatherId: rosterFamilies.fatherId,
        motherEmail: motherPersons.email,
        fatherEmail: fatherPersons.email,
      })
      .from(persons)
      .leftJoin(rosterFamilies, eq(rosterFamilies.id, persons.familyId))
      .leftJoin(motherPersons, eq(motherPersons.id, rosterFamilies.motherId))
      .leftJoin(fatherPersons, eq(fatherPersons.id, rosterFamilies.fatherId))
      .where(and(
        eq(persons.tenantId, tenantId),
        inArray(persons.role, ['boy', 'girl']),
        isNull(persons.deletedAt),
      ))
      .orderBy(asc(persons.preferredLanguage), asc(persons.lastName), asc(persons.firstName))

    // The emission rule: own email first, else the
    // guardian-named parent's, else blank.
    function resolveEmail(p: typeof rows[number]): string {
      return resolveStudentAddress({
        email: p.email,
        guardian: p.guardian,
        motherId: p.motherId,
        fatherId: p.fatherId,
        motherEmail: p.motherEmail,
        fatherEmail: p.fatherEmail,
        domain,
      }).email ?? ''
    }

    return done('Students', rows.map(p => ({
      'First Name': p.firstName,
      'Last Name': p.lastName ?? '',
      'Grade': calcGrade(grades, p.firstGradeYear, schoolYear),
      'Language': p.preferredLanguage ?? '',
      'Birth Date': p.birthDate ?? '',
      'Email': resolveEmail(p),
      'Family ID': p.legacyFamilyId ?? '',
    })))
  }

  if (type === 'classes') {
    const classes = await db
      .select({
        id: rosterAvailableClasses.id,
        year: rosterAvailableClasses.year,
        section: rosterAvailableClasses.section,
        startTime: rosterAvailableClasses.startTime,
        endTime: rosterAvailableClasses.endTime,
        shortCode: rosterCourseCatalog.shortCode,
        fullName: rosterCourseCatalog.fullName,
        department: rosterCourseCatalog.department,
        level: rosterCourseCatalog.level,
        enrollmentCount: sql<number>`count(distinct ${rosterEnrollments.id})`.as('cnt'),
      })
      .from(rosterAvailableClasses)
      .leftJoin(rosterCourseCatalog, eq(rosterCourseCatalog.id, rosterAvailableClasses.courseId))
      .leftJoin(rosterEnrollments, eq(rosterEnrollments.classId, rosterAvailableClasses.id))
      .where(and(
        eq(rosterAvailableClasses.tenantId, tenantId),
        eq(rosterAvailableClasses.year, year),
      ))
      .groupBy(
        rosterAvailableClasses.id,
        rosterCourseCatalog.shortCode,
        rosterCourseCatalog.fullName,
        rosterCourseCatalog.department,
        rosterCourseCatalog.level,
      )
      .orderBy(rosterCourseCatalog.department, rosterCourseCatalog.level)

    const teachers = await db
      .select({
        classId: rosterTeachers.classId,
        firstName: persons.firstName,
        lastName: persons.lastName,
        typeOfTeacher: rosterTeachers.typeOfTeacher,
      })
      .from(rosterTeachers)
      .innerJoin(persons, eq(persons.id, rosterTeachers.personId))
      .innerJoin(rosterAvailableClasses, eq(rosterAvailableClasses.id, rosterTeachers.classId))
      .where(and(
        eq(rosterTeachers.tenantId, tenantId),
        eq(rosterAvailableClasses.year, year),
      ))

    const teachersByClass = new Map<string, string[]>()
    for (const t of teachers) {
      const name = [t.firstName, t.lastName].filter(Boolean).join(' ') + teacherMark(t.typeOfTeacher)
      teachersByClass.set(t.classId, [...(teachersByClass.get(t.classId) ?? []), name])
    }

    return done(`Classes ${year}`, classes.map(c => ({
      'Code': c.shortCode ?? '',
      'Department': c.department ?? '',
      'Level': c.level ?? '',
      'Name': c.fullName ?? '',
      'Section': c.section ?? '',
      'Time': c.startTime ? `${fmtTime(c.startTime)}${c.endTime ? ` - ${fmtTime(c.endTime)}` : ''}` : '',
      'Students': c.enrollmentCount || 0,
      'Teachers': (teachersByClass.get(c.id) ?? []).join(', '),
      'Year': c.year,
    })))
  }

  if (type === 'class') {
    // The tenant's directory domain: a student never stands on an address in it.
    const domain = await workspaceDomain(tenantId)
    // One class, full family contact detail: the export of the class being viewed.
    const id = p.id
    if (!id) return { status: 400, error: 'id required' }

    const [cls] = await db
      .select({
        year: rosterAvailableClasses.year,
        section: rosterAvailableClasses.section,
        shortCode: rosterCourseCatalog.shortCode,
      })
      .from(rosterAvailableClasses)
      .leftJoin(rosterCourseCatalog, eq(rosterCourseCatalog.id, rosterAvailableClasses.courseId))
      .where(and(eq(rosterAvailableClasses.id, id), eq(rosterAvailableClasses.tenantId, tenantId)))
      .limit(1)
    if (!cls) return { status: 404, error: 'Class not found' }

    const motherPersons = alias(persons, 'mother_person')
    const fatherPersons = alias(persons, 'father_person')

    const rows = await db
      .select({
        firstName: persons.firstName,
        lastName: persons.lastName,
        firstGradeYear: persons.firstGradeYear,
        preferredLanguage: persons.preferredLanguage,
        email: persons.email,
        phone: persons.phone,
        guardian: persons.guardian,
        legacyFamilyId: rosterFamilies.legacyFamilyId,
        motherId: rosterFamilies.motherId,
        fatherId: rosterFamilies.fatherId,
        motherFirstName: motherPersons.firstName,
        motherEmail: motherPersons.email,
        motherPhone: motherPersons.phone,
        fatherFirstName: fatherPersons.firstName,
        fatherEmail: fatherPersons.email,
        fatherPhone: fatherPersons.phone,
        addr1: rosterFamilies.addr1,
        addr2: rosterFamilies.addr2,
        city: rosterFamilies.city,
        state: rosterFamilies.state,
        zip: rosterFamilies.zip,
      })
      .from(rosterEnrollments)
      .innerJoin(persons, eq(persons.id, rosterEnrollments.studentId))
      .leftJoin(rosterFamilies, eq(rosterFamilies.id, persons.familyId))
      .leftJoin(motherPersons, eq(motherPersons.id, rosterFamilies.motherId))
      .leftJoin(fatherPersons, eq(fatherPersons.id, rosterFamilies.fatherId))
      .where(and(
        eq(rosterEnrollments.classId, id),
        eq(rosterEnrollments.tenantId, tenantId),
        isNull(persons.deletedAt),
        isNull(rosterEnrollments.droppedOutAt),
        isNull(rosterEnrollments.deletedAt),
      ))
      .orderBy(asc(persons.lastName), asc(persons.firstName))

    return done(`${cls.shortCode ?? 'Class'}${cls.section ? ` ${cls.section}` : ''} ${cls.year}`, rows.map((r, i) => ({
      '#': i + 1,
      'First Name': r.firstName,
      'Last Name': r.lastName ?? '',
      'Grade': calcGrade(grades, r.firstGradeYear, cls.year),
      'Language': r.preferredLanguage ?? '',
      'Family ID': r.legacyFamilyId ?? '',
      // The emission rule: own email, else guardian-named parent's.
      'Student Email': resolveStudentAddress({
        email: r.email, guardian: r.guardian,
        motherId: r.motherId, fatherId: r.fatherId,
        motherEmail: r.motherEmail, fatherEmail: r.fatherEmail, domain,
      }).email ?? '',
      'Student Phone': r.phone ?? '',
      'Mother': r.motherFirstName ?? '',
      'M Email': r.motherEmail ?? '',
      'M Phone': r.motherPhone ?? '',
      'Father': r.fatherFirstName ?? '',
      'F Email': r.fatherEmail ?? '',
      'F Phone': r.fatherPhone ?? '',
      'Address': [r.addr1, r.addr2, r.city, [r.state, r.zip].filter(Boolean).join(' ')].filter(Boolean).join(', '),
    })))
  }

  if (type === 'tracker') {
    const statusParam = p.status
    let statuses: readonly number[] | null = null
    if (statusParam) {
      // A filter within this one act, not a door of its own: a group's name from the one home of the
      // groups, else a status code.
      const groups = enrollmentStatusGroups(codes)
      if (Object.hasOwn(groups, statusParam)) statuses = groups[statusParam as EnrollmentStatusGroup]
      else { const n = parseInt(statusParam); if (!isNaN(n)) statuses = [n] }
    }
    const specificStatus = statusParam && /^\d+$/.test(statusParam) ? parseInt(statusParam) : null

    const exportYear = p.year ? year : enrollmentYear(y, at)

    const motherPersons = alias(persons, 'mother_person')
    const fatherPersons = alias(persons, 'father_person')

    const rawRows = await db
      .select({
        legacyFamilyId: rosterFamilies.legacyFamilyId,
        enrollmentStatus: rosterFamilyTracker.enrollmentStatus,
        feeEnrollmentStatus: familyEnrollments.status,
        registrationDate: rosterFamilyTracker.registrationDate,
        motherFirstName: motherPersons.firstName,
        motherEmail: motherPersons.email,
        motherPhone: motherPersons.phone,
        fatherFirstName: fatherPersons.firstName,
        fatherEmail: fatherPersons.email,
        fatherPhone: fatherPersons.phone,
      })
      .from(rosterFamilyTracker)
      .innerJoin(rosterFamilies, eq(rosterFamilies.id, rosterFamilyTracker.familyId))
      .leftJoin(motherPersons, eq(motherPersons.id, rosterFamilies.motherId))
      .leftJoin(fatherPersons, eq(fatherPersons.id, rosterFamilies.fatherId))
      .leftJoin(familyEnrollments, and(
        eq(familyEnrollments.familyId, rosterFamilyTracker.familyId),
        eq(familyEnrollments.tenantId, rosterFamilyTracker.tenantId),
        eq(familyEnrollments.year, rosterFamilyTracker.year),
      ))
      .where(and(
        eq(rosterFamilyTracker.tenantId, tenantId),
        eq(rosterFamilyTracker.year, exportYear),
      ))

    const rows = rawRows
      .map(r => ({ ...r, enrollmentStatus: r.feeEnrollmentStatus === 'enrolled' ? codes.enrollmentStatus.registered : (r.enrollmentStatus ?? 0) }))
      .filter(r => !statuses || statuses.includes(r.enrollmentStatus))
      .sort((a, b) => a.enrollmentStatus - b.enrollmentStatus || (a.legacyFamilyId ?? 0) - (b.legacyFamilyId ?? 0))

    return done(`Tracker ${exportYear}`, rows.map((r, i) => {
      const row: Record<string, unknown> = {
        '#': i + 1,
        'Family ID': r.legacyFamilyId ?? '',
      }
      if (specificStatus === null) row['Status'] = r.enrollmentStatus == null ? '' : codes.enrollmentStatus.labels[r.enrollmentStatus] ?? ''
      row['Date'] = r.registrationDate ?? ''
      if (r.motherFirstName) {
        row['Mother'] = r.motherFirstName
        row['M Email'] = r.motherEmail ?? ''
        row['M Phone'] = r.motherPhone ?? ''
      }
      if (r.fatherFirstName) {
        row['Father'] = r.fatherFirstName
        row['F Email'] = r.fatherEmail ?? ''
        row['F Phone'] = r.fatherPhone ?? ''
      }
      return row
    }))
  }

  return { status: 400, error: 'Unknown type' }
}
