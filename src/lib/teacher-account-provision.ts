// A TEACHER'S SCHOOL ACCOUNT, MADE — for a person a principal names, or a teacher's own. The caller decides who may;
// this finds the person, chooses the address, creates the account, records it and mails it.
import type { Actor } from './outward-act'
import { db } from './db'
import { persons, rosterTeachers, rosterAvailableClasses, rosterCourseCatalog } from '../tables'
import { and, eq, isNull } from 'drizzle-orm'
import { teacherClassroomAddress, assignedTeacherClassroomAddresses } from './teacher-classroom-address'
import { chooseAddress, takenAddresses, createGoogleAccount } from './teacher-account'
import { tenantRules } from './rules-context'
import { teacherAccountEmail } from './teacher-account-email'
import { requireTenant, teacherAccountHelpUrl, rosterPublicUrl } from './roster-public-url'
import { sendEmail } from './mail'
import { leadTeacherEmail } from './google-school'
import { schoolYearLabel } from './enrollment'
import { isNotMade } from './not-made'
import { workspaceDomain } from './role-mailbox'
import { schoolWord, teacherMailWords } from './school-words'

/** `notMade`: off production the account was not made — the statement, shown where the address would be. */
export type ProvisionResult = { address?: string; sentTo?: string; notMade?: string; error?: string }

/**
 * Create a school account for a person and mail its temporary password to their PERSONAL address — one act
 * or neither. Refuses a person who already holds a classroom address or has no personal address.
 */
export async function provisionTeacherAccount(tenantId: string, personId: string, year: number, actor: Actor): Promise<ProvisionResult> {
  const [person] = await db
    .select({ id: persons.id, firstName: persons.firstName, lastName: persons.lastName, email: persons.email, classroomEmail: persons.classroomEmail })
    .from(persons)
    .where(and(eq(persons.id, personId), eq(persons.tenantId, tenantId), isNull(persons.deletedAt)))
    .limit(1)
  if (!person) return { error: 'Person not found' }
  const domain = await workspaceDomain(tenantId)
  const has = teacherClassroomAddress(person, domain)
  if (has) return { error: `Already has ${has}` }
  if (!person.email?.trim()) return { error: 'No personal email on the roster — the account could not be sent anywhere' }

  // The classes they teach this year — named in the welcome email.
  const classRows = await db
    .select({ shortCode: rosterCourseCatalog.shortCode })
    .from(rosterTeachers)
    .innerJoin(rosterAvailableClasses, eq(rosterAvailableClasses.id, rosterTeachers.classId))
    .leftJoin(rosterCourseCatalog, eq(rosterCourseCatalog.id, rosterAvailableClasses.courseId))
    .where(and(
      eq(rosterTeachers.tenantId, tenantId),
      eq(rosterTeachers.personId, person.id),
      eq(rosterAvailableClasses.year, year),
    ))
  const classes = [...new Set(classRows.map(r => r.shortCode).filter(Boolean))] as string[]

  // Taken = existing directory accounts AND classroom_email values already
  // assigned (the chooseAddress contract).
  const taken = await takenAddresses(tenantId)
  for (const a of await assignedTeacherClassroomAddresses(tenantId)) taken.add(a)

  const address = chooseAddress((await tenantRules(tenantId)).codes.teacherAddresses, person.firstName, person.lastName ?? '', taken, domain)
  const created = await createGoogleAccount(tenantId, address, person.firstName, person.lastName ?? '', actor)
  // Stored only when made: an address no account answers to is not kept.
  if (!isNotMade(created)) await db.update(persons).set({ classroomEmail: created.address }).where(eq(persons.id, person.id))

  // The password exists only in this moment — the account and the email that
  // carries it are one act or neither.
  const lead = await leadTeacherEmail(tenantId)
  const mail = teacherAccountEmail({
    contactEmail: lead,
    firstName: person.firstName, schoolYear: schoolYearLabel(year), classes,
    schoolAddress: address, ...await teacherMailWords(tenantId), temporaryPassword: isNotMade(created) ? { notMade: created.statement } : created.password, helpUrl: await teacherAccountHelpUrl(await requireTenant(tenantId)),
      domain: await workspaceDomain(tenantId), rosterUrl: await rosterPublicUrl(await requireTenant(tenantId)),
  })
  await sendEmail(tenantId, {
    to: person.email, subject: mail.subject, body: mail.subject,
    htmlBody: mail.html, cidLogo: mail.cidLogo, replyTo: lead,
  }, actor)

  return { address, sentTo: person.email, ...(isNotMade(created) ? { notMade: created.statement } : {}) }
}

/**
 * The signed-in person, when they teach in the year: their person id, or the sentence that says why not.
 * Matched by the sign-in address exactly as written.
 */
export async function sessionYearTeacher(tenantId: string, email: string, year: number): Promise<{ personId: string } | { error: string }> {
  const [me] = await db
    .select({ id: persons.id })
    .from(persons)
    .where(and(eq(persons.tenantId, tenantId), eq(persons.email, email), isNull(persons.deletedAt)))
    .limit(1)
  if (!me) return { error: `Your account is not linked to a ${await schoolWord(tenantId, 'name')} record` }

  const [teaches] = await db
    .select({ id: rosterTeachers.id })
    .from(rosterTeachers)
    .innerJoin(rosterAvailableClasses, eq(rosterAvailableClasses.id, rosterTeachers.classId))
    .where(and(
      eq(rosterTeachers.tenantId, tenantId),
      eq(rosterTeachers.personId, me.id),
      eq(rosterAvailableClasses.year, year),
    ))
    .limit(1)
  if (!teaches) return { error: `Only a current-year teacher can get a ${await workspaceDomain(tenantId)} account here` }
  return { personId: me.id }
}
