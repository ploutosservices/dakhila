// THE DEPARTMENT ROSTER — one data structure for each department's enrollment, which every reader presents in its
// own way and computes nothing of its own: a card, a table, an export, a mail list.
//
// It answers, for one department in one session: which families have a child in it, how to reach both parents, which
// of their children sit in which class at which grade — and whether the family volunteers (`volunteers`): a member
// teaching a class this session, where the school counts teaching as volunteering
// (SchoolRules.courses.teachingCountsAsVolunteering); otherwise no family is marked. Other volunteer work is the
// volunteering lists' (volunteering.ts), not counted here.

import { db } from './db'
import { persons, rosterAvailableClasses, rosterCourseCatalog, rosterEnrollments, rosterFamilies, rosterTeachers } from '../tables'
import { and, asc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm'
import { gradeLabel } from './enrollment'
import { rosterClassCode } from './roster-class-code'
import { byCode } from './zoned'
import { courseRules, nameOrder } from './rules-context'
import type { JoinedIndex, JoinedState } from './student-joined'

export type RosterParent = { personId: string; role: 'mother' | 'father'; name: string; email: string | null; phone: string | null }
export type RosterChild = { personId: string; name: string; grade: string; classId: string; classCode: string; joined?: JoinedState }
export type DepartmentFamily = {
  familyId: string
  familyNumber: number | null
  parents: RosterParent[]
  children: RosterChild[]
  volunteers: boolean
}
export type DepartmentRoster = { department: string; year: number; families: DepartmentFamily[] }

const nameOf = (p: { firstName: string | null; lastName: string | null }) => [p.firstName, p.lastName].filter(Boolean).join(' ')

/** The departments that have a class in this session (standby excluded), in name order. */
export async function rosterDepartments(tenantId: string, year: number): Promise<string[]> {
  const rows = await db.selectDistinct({ department: rosterCourseCatalog.department })
    .from(rosterAvailableClasses)
    .innerJoin(rosterCourseCatalog, eq(rosterCourseCatalog.id, rosterAvailableClasses.courseId))
    .where(and(
      eq(rosterAvailableClasses.tenantId, tenantId),
      eq(rosterAvailableClasses.year, year),
      sql`coalesce(${rosterCourseCatalog.department2}, 0) <> ${(await courseRules(tenantId)).standbyDepartment2}`,
    ))
    .orderBy(asc(rosterCourseCatalog.department))
  return rows.map(r => r.department).filter((d): d is string => !!d)
}

// The children: live enrolments in live classes of this session, narrowed by `scope` — a department
// (standby excluded) or one class.
function kidsIn(tenantId: string, year: number, scope: SQL) {
  return db
    .select({
      personId: persons.id, firstName: persons.firstName, lastName: persons.lastName,
      firstGradeYear: persons.firstGradeYear, familyId: persons.familyId,
      classId: rosterAvailableClasses.id, shortCode: rosterCourseCatalog.shortCode, section: rosterAvailableClasses.section,
    })
    .from(rosterEnrollments)
    .innerJoin(rosterAvailableClasses, eq(rosterAvailableClasses.id, rosterEnrollments.classId))
    .innerJoin(rosterCourseCatalog, eq(rosterCourseCatalog.id, rosterAvailableClasses.courseId))
    .innerJoin(persons, eq(persons.id, rosterEnrollments.studentId))
    .where(and(
      eq(rosterEnrollments.tenantId, tenantId),
      eq(rosterAvailableClasses.year, year),
      scope,
      isNull(rosterEnrollments.deletedAt),
      isNull(rosterEnrollments.droppedOutAt),
      isNull(persons.deletedAt),
    ))
}

/** `joined`, when the caller holds it, marks each child's Google Classroom join (lib/student-joined.ts). */
export async function departmentRoster(tenantId: string, year: number, department: string, joined?: JoinedIndex): Promise<DepartmentRoster> {
  const standby = (await courseRules(tenantId)).standbyDepartment2
  const kids = await kidsIn(tenantId, year, sql`${rosterCourseCatalog.department} = ${department} and coalesce(${rosterCourseCatalog.department2}, 0) <> ${standby}`)
  return { department, year, families: await familiesOf(tenantId, year, kids, joined) }
}

/** The same family structure for ONE class — a class's family cards (the parents are
 *  one card). Children are the family's children in this class. */
export async function classFamilies(tenantId: string, year: number, classId: string, joined?: JoinedIndex): Promise<DepartmentFamily[]> {
  return familiesOf(tenantId, year, await kidsIn(tenantId, year, sql`${rosterAvailableClasses.id} = ${classId}`), joined)
}

// A child's join, for the card — except "no classroom", which is a fact about the class, said once where the
// class is shown, not on every child (a value every row shares belongs to the class).
function joinedOf(joined: JoinedIndex | undefined, studentId: string, classId: string): { joined?: JoinedState } {
  const s = joined?.get(studentId, classId)
  return s && s.state !== 'no-classroom' ? { joined: s } : {}
}

async function familiesOf(tenantId: string, year: number, kids: Awaited<ReturnType<typeof kidsIn>>, joined?: JoinedIndex): Promise<DepartmentFamily[]> {
  const familyIds = [...new Set(kids.map(k => k.familyId).filter((f): f is string => !!f))]
  if (familyIds.length === 0) return []
  const { grades, teachingCountsAsVolunteering } = await courseRules(tenantId)

  const [families, parents, teaching] = await Promise.all([
    db.select({ id: rosterFamilies.id, number: rosterFamilies.legacyFamilyId }).from(rosterFamilies)
      .where(inArray(rosterFamilies.id, familyIds)),
    db.select({ personId: persons.id, familyId: persons.familyId, role: persons.role, firstName: persons.firstName, lastName: persons.lastName, email: persons.email, phone: persons.phone })
      .from(persons)
      .where(and(inArray(persons.familyId, familyIds), inArray(persons.role, ['mother', 'father']), isNull(persons.deletedAt))),
    // Who in these families teaches anything this session — any department, any member.
    db.selectDistinct({ familyId: persons.familyId })
      .from(rosterTeachers)
      .innerJoin(rosterAvailableClasses, eq(rosterAvailableClasses.id, rosterTeachers.classId))
      .innerJoin(persons, eq(persons.id, rosterTeachers.personId))
      .where(and(
        eq(rosterTeachers.tenantId, tenantId),
        eq(rosterAvailableClasses.year, year),
        inArray(persons.familyId, familyIds),
        isNull(persons.deletedAt),
      )),
  ])
  const teachingFamilies = new Set(teaching.map(t => t.familyId))
  const names = await nameOrder(tenantId)

  const out: DepartmentFamily[] = families.map(f => ({
    familyId: f.id,
    familyNumber: f.number ?? null,
    parents: parents
      .filter(p => p.familyId === f.id)
      .sort((a, b) => (a.role === 'mother' ? 0 : 1) - (b.role === 'mother' ? 0 : 1))
      .map(p => ({ personId: p.personId, role: p.role as 'mother' | 'father', name: nameOf(p), email: p.email, phone: p.phone })),
    children: kids
      .filter(k => k.familyId === f.id)
      .map(k => ({ personId: k.personId, name: nameOf(k), grade: gradeLabel(grades, year, k.firstGradeYear), classId: k.classId, classCode: rosterClassCode({ shortCode: k.shortCode ?? '', section: k.section }), ...joinedOf(joined, k.personId, k.classId) }))
      .sort((a, b) => byCode(a.classCode, b.classCode) || names(a.name, b.name)),
    volunteers: teachingCountsAsVolunteering && teachingFamilies.has(f.id),
  }))
  // Families not marked as volunteering first, then by the first parent's name.
  out.sort((a, b) => Number(a.volunteers) - Number(b.volunteers) || names(a.parents[0]?.name ?? '', b.parents[0]?.name ?? ''))
  return out
}
