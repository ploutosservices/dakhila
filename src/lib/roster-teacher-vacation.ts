// Teacher vacation marks: a teacher marks the school days they are
// not available to teach; the principal sees the marks.
//
// The school year's class days are DISCRETE — never a continuous range — so a
// mark is one (teacher, date) row against a date that carries a school-day
// event in roster_events. setTeacherVacation() (teacher-vacation-mark.ts, called by the roster API) is the ONE door
// for writes and refuses any other date; unmarking deletes the row (the mark is the datum). This file only reads.

import { db } from './db'
import { courseRules, nameOrder } from './rules-context'
import { rosterTeacherUnavailability, rosterEvents, rosterTeachers, rosterAvailableClasses, rosterCourseCatalog, persons } from '../tables'
import { and, eq, gte, lte, sql, asc, isNull, inArray } from 'drizzle-orm'
import { schoolYearBounds } from './years'
import { yearRules } from './year-context'

export type SchoolDay = { date: string; weekNumber: number | null }
export type VacationMark = { date: string }
export type TeacherVacationRow = { personId: string; teacherName: string; date: string; weekNumber: number | null }

// The school year's class days, from the roster calendar (the one source).
export async function getSchoolDays(tenantId: string, startYear: number): Promise<SchoolDay[]> {
  const y = await yearRules(tenantId)
  const { startDate, endDate } = schoolYearBounds(y, startYear)
  const rows = await db
    .selectDistinct({ date: rosterEvents.date, weekNumber: rosterEvents.weekNumber })
    .from(rosterEvents)
    .where(and(
      eq(rosterEvents.tenantId, tenantId),
      sql`${rosterEvents.eventType} & ${y.calendar.eventTypes.schoolDay} > 0`,
      gte(rosterEvents.date, startDate),
      lte(rosterEvents.date, endDate),
    ))
    .orderBy(asc(rosterEvents.date))
  return rows
}

// The signed-in teacher's person row, resolved the same way the roster derives the
// teacher relationship: persons.email match + a teaching assignment this year.
export async function getTeacherPerson(
  tenantId: string, email: string, schoolYear: number
): Promise<{ personId: string; name: string } | null> {
  const [row] = await db
    .selectDistinct({
      personId: persons.id,
      firstName: persons.firstName,
      lastName: persons.lastName,
    })
    .from(persons)
    .innerJoin(rosterTeachers, eq(rosterTeachers.personId, persons.id))
    .innerJoin(rosterAvailableClasses, eq(rosterAvailableClasses.id, rosterTeachers.classId))
    .where(and(
      eq(persons.tenantId, tenantId),
      sql`lower(${persons.email}) = lower(${email})`,
      eq(rosterAvailableClasses.year, schoolYear),
      isNull(persons.deletedAt),
    ))
    .limit(1)
  if (!row) return null
  return { personId: row.personId, name: [row.firstName, row.lastName].filter(Boolean).join(' ') }
}

// A teacher's own marks for the school year.
export async function getTeacherVacations(
  tenantId: string, personId: string, startYear: number
): Promise<VacationMark[]> {
  const { startDate, endDate } = schoolYearBounds(await yearRules(tenantId), startYear)
  return db
    .select({ date: rosterTeacherUnavailability.date })
    .from(rosterTeacherUnavailability)
    .where(and(
      eq(rosterTeacherUnavailability.tenantId, tenantId),
      eq(rosterTeacherUnavailability.personId, personId),
      gte(rosterTeacherUnavailability.date, startDate),
      lte(rosterTeacherUnavailability.date, endDate),
    ))
    .orderBy(asc(rosterTeacherUnavailability.date))
}

// Every teacher's marks for the school year — the principal's view.
export async function getAllTeacherVacations(
  tenantId: string, startYear: number
): Promise<TeacherVacationRow[]> {
  const { startDate, endDate } = schoolYearBounds(await yearRules(tenantId), startYear)
  const rows = await db
    .select({
      personId: rosterTeacherUnavailability.personId,
      firstName: persons.firstName,
      lastName: persons.lastName,
      date: rosterTeacherUnavailability.date,
    })
    .from(rosterTeacherUnavailability)
    .innerJoin(persons, eq(persons.id, rosterTeacherUnavailability.personId))
    .where(and(
      eq(rosterTeacherUnavailability.tenantId, tenantId),
      gte(rosterTeacherUnavailability.date, startDate),
      lte(rosterTeacherUnavailability.date, endDate),
    ))
    .orderBy(asc(rosterTeacherUnavailability.date), asc(persons.lastName))

  if (rows.length === 0) return []

  // Week numbers come from the calendar, joined in — never derived by a reader.
  const days = await getSchoolDays(tenantId, startYear)
  const weekByDate = new Map(days.map(d => [d.date, d.weekNumber]))

  return rows.map(r => ({
    personId: r.personId,
    teacherName: [r.firstName, r.lastName].filter(Boolean).join(' '),
    date: r.date,
    weekNumber: weekByDate.get(r.date) ?? null,
  }))
}

// Marks by date for a set of dates — lets a reader of the year's teachers show upcoming absences without a second
// bespoke query shape.
export async function getVacationsByDate(
  tenantId: string, dates: string[]
): Promise<Map<string, string[]>> {
  if (dates.length === 0) return new Map()
  const rows = await db
    .select({
      date: rosterTeacherUnavailability.date,
      firstName: persons.firstName,
      lastName: persons.lastName,
    })
    .from(rosterTeacherUnavailability)
    .innerJoin(persons, eq(persons.id, rosterTeacherUnavailability.personId))
    .where(and(
      eq(rosterTeacherUnavailability.tenantId, tenantId),
      inArray(rosterTeacherUnavailability.date, dates),
    ))
  const out = new Map<string, string[]>()
  for (const r of rows) {
    const name = [r.firstName, r.lastName].filter(Boolean).join(' ')
    out.set(r.date, [...(out.get(r.date) ?? []), name])
  }
  return out
}

// The teacher's own vacation surface is gated by the roster API (vacation.mine, vacation.setMine): the caller
// must BE a teacher this school year, found by getTeacherPerson from the address they signed in with, so a mark can
// only ever land on the signed-in teacher's own row.

// The principal's coverage view: each mark carries the
// classes that teacher covers this year, and a class is UNCOVERED on a date when
// EVERY teacher assigned to it has marked that date away. Computed here — a reader
// never derives coverage.
export type MarkedClass = { classId: string; shortCode: string; section: string | null; department: string; uncovered: boolean }
export type CoverageRow = TeacherVacationRow & { classes: MarkedClass[] }

export async function getVacationCoverage(
  tenantId: string, startYear: number
): Promise<CoverageRow[]> {
  const marks = await getAllTeacherVacations(tenantId, startYear)
  if (marks.length === 0) return []

  // Every teaching assignment for the year: class ↔ teacher, with short codes.
  const assignments = await db
    .select({
      classId: rosterAvailableClasses.id,
      shortCode: rosterCourseCatalog.shortCode,
      section: rosterAvailableClasses.section,
      department: rosterCourseCatalog.department,
      personId: rosterTeachers.personId,
    })
    .from(rosterTeachers)
    .innerJoin(rosterAvailableClasses, eq(rosterAvailableClasses.id, rosterTeachers.classId))
    .innerJoin(rosterCourseCatalog, eq(rosterCourseCatalog.id, rosterAvailableClasses.courseId))
    .where(and(
      eq(rosterAvailableClasses.tenantId, tenantId),
      eq(rosterAvailableClasses.year, startYear),
    ))

  const classesByTeacher = new Map<string, { classId: string; shortCode: string; section: string | null; department: string }[]>()
  const teachersByClass = new Map<string, string[]>()
  for (const a of assignments) {
    classesByTeacher.set(a.personId, [...(classesByTeacher.get(a.personId) ?? []), { classId: a.classId, shortCode: a.shortCode, section: a.section, department: a.department }])
    teachersByClass.set(a.classId, [...(teachersByClass.get(a.classId) ?? []), a.personId])
  }

  // Who is away on each date — for the uncovered test.
  const awayByDate = new Map<string, Set<string>>()
  for (const m of marks) {
    awayByDate.set(m.date, (awayByDate.get(m.date) ?? new Set()).add(m.personId))
  }

  return marks.map(m => ({
    ...m,
    classes: (classesByTeacher.get(m.personId) ?? []).map(c => ({
      ...c,
      // uncovered: every teacher of this class is away on this date
      uncovered: (teachersByClass.get(c.classId) ?? []).every(t => awayByDate.get(m.date)?.has(t)),
    })),
  }))
}

// The call-list: standby teachers, people who can be called to stand in, held as
// standby classrooms. The standby is at department level, not class level — a
// standby teacher covers the DEPARTMENT.
// The standby class (the school's standby marker) is just the container that holds them.
export type StandbyTeachers = { department: string; teachers: string[] }

export async function getStandbyTeachers(tenantId: string, startYear: number): Promise<StandbyTeachers[]> {
  const rows = await db
    .select({
      department: rosterCourseCatalog.department,
      firstName: persons.firstName,
      lastName: persons.lastName,
    })
    .from(rosterAvailableClasses)
    .innerJoin(rosterCourseCatalog, and(
      eq(rosterCourseCatalog.id, rosterAvailableClasses.courseId),
      eq(rosterCourseCatalog.department2, (await courseRules(tenantId)).standbyDepartment2),
    ))
    .leftJoin(rosterTeachers, eq(rosterTeachers.classId, rosterAvailableClasses.id))
    .leftJoin(persons, eq(persons.id, rosterTeachers.personId))
    .where(and(
      eq(rosterAvailableClasses.tenantId, tenantId),
      eq(rosterAvailableClasses.year, startYear),
    ))
    .orderBy(asc(rosterCourseCatalog.department), asc(persons.lastName))

  const byDept = new Map<string, StandbyTeachers>()
  for (const r of rows) {
    const entry = byDept.get(r.department) ?? { department: r.department, teachers: [] }
    const name = [r.firstName, r.lastName].filter(Boolean).join(' ')
    if (name) entry.teachers.push(name)
    byDept.set(r.department, entry)
  }
  return [...byDept.values()]
}

// Every teacher of the school year, by name — who the principal may mark a vacation FOR,
// through the same door the teacher uses.
export type TeacherOption = { personId: string; name: string }

export async function getTeachersForYear(tenantId: string, startYear: number): Promise<TeacherOption[]> {
  const names = await nameOrder(tenantId)
  const rows = await db
    .selectDistinct({ personId: persons.id, firstName: persons.firstName, lastName: persons.lastName })
    .from(rosterTeachers)
    .innerJoin(rosterAvailableClasses, eq(rosterAvailableClasses.id, rosterTeachers.classId))
    .innerJoin(persons, eq(persons.id, rosterTeachers.personId))
    .where(and(
      eq(rosterTeachers.tenantId, tenantId),
      eq(rosterAvailableClasses.year, startYear),
      isNull(persons.deletedAt),
    ))
  return rows
    .map(r => ({ personId: r.personId, name: [r.firstName, r.lastName].filter(Boolean).join(' ') }))
    .sort((a, b) => names(a.name, b.name))
}
