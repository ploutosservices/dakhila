// WHO AN EMAIL TO A FAMILY GOES TO — the family emits its own list, by the kind of email.
//
// This file is the one implementation of the rules: a family tells who gets its emails — the recipient list sits
// inside the family object. Every family email asks this, and nothing else decides.
//
//   enrollment    the parents
//   event         the invited children and the parents — each child's address and each
//                 parent's. Sent for a rehearsal only — invitation, reminder, assignments; an ordinary event's page lists them and sends nothing.
//   evaluation    the student evaluated and the parents
//   school-year   an enrolled family's enrolled students and parents, together with any member who teaches
//                 this session
//
// Always the personal email field, never a school-issued address. A letter goes to the members its kind names, never
// to every member. Volunteers have no category in the roster, so they emit nothing.

import { db } from './db'
import {
  persons, rosterFamilies, rosterEnrollments, rosterTeachers, rosterAvailableClasses,
  familyEnrollments, familyEnrollmentStudents,
} from '../tables'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { isTeacherDomainAddress } from './teacher-classroom-address'
import { academicYearOf } from './year-context'
import { getTenantById } from './tenant'
import { workspaceDomain } from './role-mailbox'

export type FamilyEmailKind = 'enrollment' | 'event' | 'evaluation' | 'school-year'

export type FamilyRecipientOptions = {
  /** evaluation: the student the report is about. */
  studentId?: string
  /** event: the family's children in the event's audience (not withdrawn). */
  studentIds?: string[]
  /** school-year: the session; defaults to the tenant's current session. */
  year?: number
}

export async function familyRecipients(
  tenantId: string, familyId: string, kind: FamilyEmailKind, opts: FamilyRecipientOptions = {},
): Promise<string[]> {
  return (await familyRecipientPeople(tenantId, familyId, kind, opts)).map(r => r.email)
}

/** The same list, each address with the person it is — so a mail can speak about its own recipients (the texting
 *  preference block) without going back from an address to a person. */
export async function familyRecipientPeople(
  tenantId: string, familyId: string, kind: FamilyEmailKind, opts: FamilyRecipientOptions = {},
): Promise<{ personId: string; email: string }[]> {
  const domain = await workspaceDomain(tenantId)
  const [fam] = await db.select({ motherId: rosterFamilies.motherId, fatherId: rosterFamilies.fatherId })
    .from(rosterFamilies).where(and(eq(rosterFamilies.id, familyId), eq(rosterFamilies.tenantId, tenantId))).limit(1)
  if (!fam) return []
  const parentIds = [fam.motherId, fam.fatherId].filter((id): id is string => !!id)

  let personIds: string[]
  if (kind === 'enrollment') {
    personIds = parentIds
  } else if (kind === 'event') {
    personIds = [...(opts.studentIds ?? []), ...parentIds]
  } else if (kind === 'evaluation') {
    personIds = [...(opts.studentId ? [opts.studentId] : []), ...parentIds]
  } else {
    const year = opts.year ?? await sessionYear(tenantId)
    const [students, teachers] = await Promise.all([enrolledStudentIds(tenantId, familyId, year), teacherIds(tenantId, familyId, year)])
    personIds = [...(students.length > 0 ? [...students, ...parentIds] : []), ...teachers]
  }
  if (personIds.length === 0) return []

  const rows = await db.select({ id: persons.id, email: persons.email }).from(persons)
    .where(and(eq(persons.tenantId, tenantId), isNull(persons.deletedAt), inArray(persons.id, [...new Set(personIds)])))
  const byId = new Map(rows.map(r => [r.id, r.email]))
  const seen = new Set<string>()
  const out: { personId: string; email: string }[] = []
  for (const id of personIds) {                       // in the order the rule names them
    const e = (byId.get(id) ?? '').trim()
    if (!e || isTeacherDomainAddress(e, domain) || seen.has(e.toLowerCase())) continue
    seen.add(e.toLowerCase()); out.push({ personId: id, email: e })
  }
  return out
}

/** The school-year list of the family a person belongs to — for a letter about one student or teacher. */
export async function schoolYearRecipientsForPerson(tenantId: string, personId: string): Promise<string[]> {
  const [p] = await db.select({ familyId: persons.familyId }).from(persons).where(eq(persons.id, personId)).limit(1)
  if (!p?.familyId) return []
  return familyRecipients(tenantId, p.familyId, 'school-year')
}

async function sessionYear(tenantId: string): Promise<number> {
  return academicYearOf(tenantId)
}

/** Live members of the family enrolled this session — in a class, or on the year's enrollment. */
async function enrolledStudentIds(tenantId: string, familyId: string, year: number): Promise<string[]> {
  const [inClass, onEnrollment] = await Promise.all([
    db.select({ id: persons.id }).from(rosterEnrollments)
      .innerJoin(persons, eq(persons.id, rosterEnrollments.studentId))
      .innerJoin(rosterAvailableClasses, eq(rosterAvailableClasses.id, rosterEnrollments.classId))
      .where(and(
        eq(rosterEnrollments.tenantId, tenantId), eq(persons.familyId, familyId), isNull(persons.deletedAt),
        eq(rosterAvailableClasses.year, year), isNull(rosterEnrollments.droppedOutAt), isNull(rosterEnrollments.deletedAt),
      )),
    db.select({ id: familyEnrollmentStudents.studentId }).from(familyEnrollmentStudents)
      .innerJoin(familyEnrollments, eq(familyEnrollments.id, familyEnrollmentStudents.enrollmentId))
      .where(and(
        eq(familyEnrollments.tenantId, tenantId), eq(familyEnrollments.familyId, familyId),
        eq(familyEnrollments.year, year), isNull(familyEnrollmentStudents.droppedOutAt),
      )),
  ])
  return [...new Set([...inClass, ...onEnrollment].map(r => r.id))]
}

/** Members of the family who teach a class this session. */
async function teacherIds(tenantId: string, familyId: string, year: number): Promise<string[]> {
  const rows = await db.select({ id: persons.id }).from(rosterTeachers)
    .innerJoin(persons, eq(persons.id, rosterTeachers.personId))
    .innerJoin(rosterAvailableClasses, eq(rosterAvailableClasses.id, rosterTeachers.classId))
    .where(and(
      eq(rosterTeachers.tenantId, tenantId), eq(persons.familyId, familyId), isNull(persons.deletedAt),
      eq(rosterAvailableClasses.year, year),
    ))
  return [...new Set(rows.map(r => r.id))]
}
