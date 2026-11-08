// THE ENROLLMENT INVITATION — one family's mail for a year, and which families still await one. The caller checks who
// may; this does the work.
import type { Actor } from './outward-act'
import { familyRecipients } from './family-recipients'
import { db } from './db'
import { rosterFamilyTracker, rosterFamilies, persons } from '../tables'
import { eq, and, isNull } from 'drizzle-orm'
import { schoolYearLabel } from './enrollment'
import { eligibleKids } from './eligible-kids'
import { sendEmail } from './mail'
import { enrollmentUrl } from './roster-public-url'
import { requireTenant } from './roster-public-url'
import { catalogValue } from './message-catalog'
import { schoolWord, filled, invitationWords } from './school-words'
import { tenantRules } from './rules-context'

function formatKidNames(names: string[]): string {
  if (names.length === 0) return 'your children'
  if (names.length === 1) return names[0]
  return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1]
}

function buildInvitationFragment(opts: {
  parentName: string
  kidNames: string
  year: number
  familyId: string
  // The environment names itself: the address is the composing environment's, never another's.
  enrollUrl: string
  name: string
  tagline: string
  signature: string
  colour: string
  words: { welcome: string; warmth: string; ask: string; signOff: string }
}): string {
  const { parentName, kidNames, year, enrollUrl, name, tagline, signature, colour, words } = opts

  return `
            <p style="margin:0 0 20px;font-size:16px;color:#1f2937;">Dear ${parentName},</p>
            <p style="margin:0 0 16px;font-size:15px;color:#374151;line-height:1.7;">
              ${filled(words.welcome, { kids: `<strong>${kidNames}</strong>`, year: `<strong>${schoolYearLabel(year)}</strong>`, school: name })}
              ${filled(words.warmth, { kids: kidNames })}
            </p>
            <p style="margin:0 0 24px;font-size:15px;color:#374151;line-height:1.7;">
              ${words.ask}
            </p>
            <table cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
              <tr>
                <td style="background:${colour};border-radius:6px;padding:14px 28px;">
                  <a href="${enrollUrl}" style="color:#ffffff;font-size:15px;font-weight:bold;text-decoration:none;font-family:Arial,sans-serif;">
                    Enroll for ${schoolYearLabel(year)} →
                  </a>
                </td>
              </tr>
            </table>
            <p style="margin:0 0 8px;font-size:14px;color:#6b7280;">If the button does not work, copy and paste this link into your browser:</p>
            <p style="margin:0 0 28px;font-size:13px;"><a href="${enrollUrl}" style="color:${colour};">${enrollUrl}</a></p>
            <p style="margin:0 0 8px;font-size:15px;color:#374151;line-height:1.7;">If you have any questions or need assistance, please reply to this email.</p>
            <p style="margin:28px 0 0;font-size:15px;color:#374151;">
              ${words.signOff}<br>
              <strong>${signature}</strong><br>
              <span style="color:#6b7280;">${tagline}</span>
            </p>`
}

/** Mail one family its enrollment invitation for the year; a family awaiting one moves to invited (the school's
 *  status codes, SchoolRules.codes.enrollmentStatus). */
export async function sendInvitationForFamily(
  tenantId: string,
  familyId: string,
  year: number, actor: Actor,
): Promise<void> {
  const [family] = await db
    .select({ motherId: rosterFamilies.motherId, fatherId: rosterFamilies.fatherId })
    .from(rosterFamilies)
    .where(eq(rosterFamilies.id, familyId))
    .limit(1)
  if (!family) throw new Error('Family not found')

  const members = await db
    .select({ id: persons.id, firstName: persons.firstName, role: persons.role,
              email: persons.email, firstGradeYear: persons.firstGradeYear })
    .from(persons)
    .where(and(eq(persons.familyId, familyId), isNull(persons.deletedAt)))

  const mother = members.find(m => m.id === family.motherId)
  const father = members.find(m => m.id === family.fatherId)
  const kids = eligibleKids(members, year, (await tenantRules(tenantId)).courses.grades)

  const parentName = [mother?.firstName, father?.firstName].filter(Boolean).join(' & ')
  // An enrollment email: the family emits its list — the parents (lib/family-recipients).
  const familyEmails = await familyRecipients(tenantId, familyId, 'enrollment')
  const kidNames = formatKidNames(kids.map(k => k.firstName))

  if (familyEmails.length === 0) throw new Error('No email address in the family')

  const admissionEmail = await catalogValue(tenantId, 'admissions-contact')
  const enrollUrl = await enrollmentUrl(await requireTenant(tenantId), familyId)
  const name = await schoolWord(tenantId, 'name')
  const tagline = await schoolWord(tenantId, 'tagline')
  const motto = await schoolWord(tenantId, 'motto')
  const signature = await schoolWord(tenantId, 'signature')
  const words = await invitationWords(tenantId)
  const subject = `${name} — Enrollment Invitation ${schoolYearLabel(year)}`
  const plain = `Dear ${parentName},

${filled(words.welcome, { kids: kidNames, year: schoolYearLabel(year), school: name })}

Please complete your enrollment at:
${enrollUrl}

If you have any questions, please email ${admissionEmail}.

${words.signOff}
${signature}
${tagline}`

  const colour = await schoolWord(tenantId, 'colour')
  const contentFragment = buildInvitationFragment({ parentName, kidNames, year, familyId, enrollUrl, name, tagline, signature, colour, words })

  await sendEmail(tenantId, { to: familyEmails, subject, body: plain, contentFragment, templateOpts: { tagline: `${tagline} · ${motto}`, contactEmail: admissionEmail }, replyTo: admissionEmail }, actor)

  // Only a row still awaiting its invitation moves: setTrackerStatus sets whatever the row holds, so the update here
  // carries the guard on the current value.
  const status = (await tenantRules(tenantId)).codes.enrollmentStatus
  await db
    .update(rosterFamilyTracker)
    .set({ enrollmentStatus: status.invited })
    .where(and(
      eq(rosterFamilyTracker.familyId, familyId),
      eq(rosterFamilyTracker.tenantId, tenantId),
      eq(rosterFamilyTracker.year, year),
      eq(rosterFamilyTracker.enrollmentStatus, status.awaitingInvitation),
    ))
}

/** One invitation per family awaiting one (the tracker's "invite all"): a
 *  family whose send throws is counted and the next is tried. The roster API runs it as one batch. */
export async function inviteAllAwaiting(tenantId: string, year: number, actor: Actor): Promise<{ sent: number; errors: number }> {
  const familyIds = await familiesAwaitingInvitation(tenantId, year)
  let sent = 0, errors = 0
  for (const familyId of familyIds) {
    try {
      await sendInvitationForFamily(tenantId, familyId, year, actor)
      sent++
    } catch {
      errors++
    }
  }
  return { sent, errors }
}

/** The families whose tracker row for the year still awaits an invitation. */
export async function familiesAwaitingInvitation(tenantId: string, year: number): Promise<string[]> {
  const { awaitingInvitation } = (await tenantRules(tenantId)).codes.enrollmentStatus
  const rows = await db
    .select({ familyId: rosterFamilyTracker.familyId })
    .from(rosterFamilyTracker)
    .where(and(
      eq(rosterFamilyTracker.tenantId, tenantId),
      eq(rosterFamilyTracker.year, year),
      eq(rosterFamilyTracker.enrollmentStatus, awaitingInvitation),
    ))
  return rows.map(r => r.familyId)
}
