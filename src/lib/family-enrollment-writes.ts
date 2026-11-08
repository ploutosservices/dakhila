// ONE FAMILY'S ENROLLMENT, WRITTEN. The caller decides WHO may (enrollment.write, or the family itself); these do the
// work and answer with plain results.
import type { Actor } from './outward-act'
import { familyRecipients } from './family-recipients'
import { db } from './db'
import {
  familyEnrollments,
  incomingPayments,
  cashEnrollmentPayments,
  rosterFamilies,
  persons,
  PAYMENT_CHARACTER_TUITION,
} from '../tables'
import { eq, and, inArray, isNull } from 'drizzle-orm'
import { enrollmentUrl, requireTenant } from './roster-public-url'
import { catalogValue } from './message-catalog'
import { schoolYearLabel, gradeLevel, gradeWord } from './enrollment'
import { enrollmentYearOf } from './year-context'
import { feeContext } from './fee-context'
import { courseRules, tenantRules } from './rules-context'
import { eligibleKids, enrollableGrade } from './eligible-kids'
import { creditCardFee, feeRuleWords, feeSchedule, feeTierNote, money, moneyCents, type FeeContext, type FeeScheduleRow } from './fees'
import { ports } from '../ports'
import { maybeMarkEnrollmentPaid } from './enrollment-ops'
import { sendEmail } from './mail'
import { getEnrollment, getEnrolledStudentCount, setEnrolledStudents } from './family-enrollment'
import { birthId, dropIds } from './registry-id'
import { accountRow, bookEntry, removeEntry } from './ledger'
import { filled, schoolWord } from './school-words'

type SimpleResult = { error: string } | { success: true }

/** A fee tier's colours by where it sits: the first (a discount) green, the last (a surcharge) red, between blue. */
const TIER_COLOR: Record<FeeScheduleRow['place'], { text: string; bg: string }> = {
  first:  { text: '#059669', bg: '#ecfdf5' },
  middle: { text: '#1d4ed8', bg: '#eff6ff' },
  last:   { text: '#dc2626', bg: '#fef2f2' },
}

/** The tier in force, as a mail's note: its words from the fee rules, its colour by where it sits. */
function tierNoteHtml(c: FeeContext, at: Date): string {
  const note = feeTierNote(c, at)
  const rest = note.rest ? ` ${note.rest}` : ''
  return `<p style="margin:0 0 16px;font-size:14px;color:${TIER_COLOR[note.place].text};line-height:1.6;"><strong>${note.strong}</strong>${rest}</p>`
}

function formatKidNames(names: string[]): string {
  if (names.length === 0) return 'your children'
  if (names.length === 1) return names[0]
  return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1]
}

async function getEligibleKids(tenantId: string, familyId: string, year: number): Promise<string[]> {
  const members = await db
    .select({ firstName: persons.firstName, role: persons.role, firstGradeYear: persons.firstGradeYear })
    .from(persons)
    .where(and(eq(persons.familyId, familyId), isNull(persons.deletedAt)))
  return eligibleKids(members, year, (await courseRules(tenantId)).grades).map(m => m.firstName)
}


/** The family says no for the year: its enrollment row is written (or turned) opted_out. */
export async function optOutFamilyEnrollment(tenantId: string, familyId: string, year: number): Promise<void> {
  // An enrollment is a record id: the id is born first, and when the year's row already existed the upsert
  // answers that row's id — the unused record id goes in the same transaction, so nothing is left resolving to nothing.
  await db.transaction(async tx => {
    const born = await birthId(tx, 'enrollment', tenantId)
    const [row] = await tx.insert(familyEnrollments)
      .values({ id: born, tenantId, familyId, year, status: 'opted_out' })
      .onConflictDoUpdate({
        target: [familyEnrollments.tenantId, familyEnrollments.familyId, familyEnrollments.year],
        set: { status: 'opted_out' },
      })
      .returning({ id: familyEnrollments.id })
    if (row.id !== born) await dropIds(tx, [born])
  })
}

/** The id of the family's enrollment for the year, or null. */
export async function familyEnrollmentId(tenantId: string, familyId: string, year: number): Promise<string | null> {
  const [row] = await db.select({ id: familyEnrollments.id })
    .from(familyEnrollments)
    .where(and(
      eq(familyEnrollments.tenantId, tenantId),
      eq(familyEnrollments.familyId, familyId),
      eq(familyEnrollments.year, year),
    ))
    .limit(1)
  return row?.id ?? null
}

/**
 * The family's chosen students for the year: validated, the enrollment row found or created, the student list
 * replaced and the fee locked at the current rate (not on an already-enrolled row).
 */
export async function saveFamilyEnrollment(tenantId: string, familyId: string, year: number, studentIds: string[]): Promise<{ error: string } | { success: true; enrollmentId: string }> {

  // Validate all submitted students are in a grade the school teaches and have preferredLanguage set — AGAINST THE
  // YEAR BEING ENROLLED, the same year getEligibleKids() offers a child by, so a child offered is never refused here.
  if (studentIds.length > 0) {
    const { grades } = await courseRules(tenantId)
    const studentRecords = await db
      .select({ id: persons.id, firstGradeYear: persons.firstGradeYear, preferredLanguage: persons.preferredLanguage, firstName: persons.firstName })
      .from(persons)
      .where(and(eq(persons.tenantId, tenantId), inArray(persons.id, studentIds)))
    for (const s of studentRecords) {
      if (!s.firstGradeYear) return { error: 'One or more students do not have a grade year set.' }
      const g = gradeLevel(year, s.firstGradeYear)
      if (!enrollableGrade(g, grades)) return { error: `Only students in grades ${gradeWord(grades, grades.enrollsFrom)}–${grades.last} can be enrolled.` }
      if (!s.preferredLanguage) return { error: `${s.firstName} does not have a preferred language set. Please update the student record before enrolling.` }
    }
  }

  // Upsert enrollment row
  const existing = await db
    .select({ id: familyEnrollments.id })
    .from(familyEnrollments)
    .where(and(
      eq(familyEnrollments.tenantId, tenantId),
      eq(familyEnrollments.familyId, familyId),
      eq(familyEnrollments.year, year),
    ))
    .limit(1)

  let enrollmentId: string
  if (existing.length > 0) {
    enrollmentId = existing[0].id
  } else {
    const [row] = await db.transaction(async tx => tx.insert(familyEnrollments).values({
      id: await birthId(tx, 'enrollment', tenantId),
      tenantId: tenantId,
      familyId,
      year,
      status: 'pending',
    }).returning({ id: familyEnrollments.id }))
    enrollmentId = row.id
  }

  // Replace the student list. No fee is stored: what the enrollment owes is the one rule (tuition-owed.ts), read
  // when asked; nothing reads the `fee` column, and only a cancellation writes it (0.00).
  await setEnrolledStudents(enrollmentId, tenantId, studentIds)

  return { success: true, enrollmentId }
}

/** Record a Zelle payment toward an enrollment; answers the enrollment's family. */
export async function recordZelleEnrollmentPayment(
  tenantId: string, userId: string, enrollmentId: string, amountDollars: number,
  paidAt: string | null, referenceId: string | null, notes: string | null,
): Promise<{ error: string } | { familyId: string }> {

  const [enrollment] = await db
    .select({ id: familyEnrollments.id, familyId: familyEnrollments.familyId, year: familyEnrollments.year })
    .from(familyEnrollments)
    .where(and(eq(familyEnrollments.id, enrollmentId), eq(familyEnrollments.tenantId, tenantId)))
    .limit(1)
  if (!enrollment) return { error: 'Enrollment not found.' }

  const zelleAccount = await accountRow(tenantId, 'zelle')

  await db.transaction(async (tx) => {
    const txn = { id: await bookEntry(tx, {
      id: await birthId(tx, 'ledger_entry', tenantId),
      tenantId,
      bankAccountId: zelleAccount?.id ?? null,
      amount: amountDollars.toFixed(2),
      direction: 'in',
      type: 'enrollment_payment',
      paidAt: paidAt ?? null,
      referenceId: referenceId ?? null,
      notes,
      recordedBy: userId,
    }) }

    await tx.insert(cashEnrollmentPayments).values({
      tenantId,
      enrollmentId,
      transactionId: txn.id,
      amount: amountDollars.toFixed(2),
      character: PAYMENT_CHARACTER_TUITION,
      method: 'zelle',
      notes,
      recordedBy: userId,
      bankAccountId: zelleAccount?.id ?? null,
      processingFee: '0.00',
      paidAt: paidAt ?? null,
      referenceId: referenceId ?? null,
    })
  })

  await maybeMarkEnrollmentPaid(tenantId, enrollmentId)

  return { familyId: enrollment.familyId }
}

/** Remove a manually recorded payment, its cash transaction, and give the bank's row back to the queue. */
export async function deleteManualEnrollmentPayment(tenantId: string, paymentId: string): Promise<SimpleResult> {

  const [payment] = await db
    .select({
      enrollmentId: cashEnrollmentPayments.enrollmentId,
      paypalOrderId: cashEnrollmentPayments.paypalOrderId,
      transactionId: cashEnrollmentPayments.transactionId,
      referenceId: cashEnrollmentPayments.referenceId,
    })
    .from(cashEnrollmentPayments)
    .where(and(eq(cashEnrollmentPayments.id, paymentId), eq(cashEnrollmentPayments.tenantId, tenantId)))
    .limit(1)
  if (!payment) return { error: 'Payment not found.' }
  if (payment.paypalOrderId) return { error: 'Cannot delete SDK-captured PayPal payments.' }

  await db.transaction(async (tx) => {
    await tx.delete(cashEnrollmentPayments).where(
      and(eq(cashEnrollmentPayments.id, paymentId), eq(cashEnrollmentPayments.tenantId, tenantId))
    )
    if (payment.transactionId) {
      // A cash transaction is a record id: the payment that named it went first, the row goes, then its record id —
      // which the database refuses if anything else (an attachment) still names it.
      await removeEntry(tx, payment.transactionId)
      await dropIds(tx, [payment.transactionId], tenantId)
    }

    // THE QUEUE ROW COMES BACK. A payment applied to the wrong family and then removed from it
    // must show again as unapplied. Settling marks the incoming payment matched; undoing the settlement has to undo
    // that, or the bank's money vanishes from the queue with nothing recorded against it — the
    // one state from which there is no way back through any screen.
    //
    // Matched by the enrolment it was applied to AND the reference the bank gave, which is the
    // pair the settlement wrote.
    if (payment.referenceId) {
      await tx.update(incomingPayments)
        .set({ status: 'unmatched', matchedToType: null, matchedToId: null })
        .where(and(
          eq(incomingPayments.tenantId, tenantId),
          eq(incomingPayments.referenceId, payment.referenceId),
          eq(incomingPayments.matchedToType, 'enrollment'),
          eq(incomingPayments.matchedToId, payment.enrollmentId),
        ))
    }
  })

  return { success: true }
}

/** Record a PayPal payment received outside the SDK button; answers the enrollment's family. */
export async function recordManualPaypalEnrollmentPayment(
  tenantId: string, userId: string, enrollmentId: string, amountDollars: number, processingFeeDollars: number | null,
  paidAt: string | null, referenceId: string | null, notes: string | null,
): Promise<{ error: string } | { familyId: string }> {

  const [enrollment] = await db
    .select({ id: familyEnrollments.id, familyId: familyEnrollments.familyId })
    .from(familyEnrollments)
    .where(and(eq(familyEnrollments.id, enrollmentId), eq(familyEnrollments.tenantId, tenantId)))
    .limit(1)
  if (!enrollment) return { error: 'Enrollment not found.' }

  const paypalAccount = await accountRow(tenantId, 'paypal')

  // The card rate the checkout charges (SchoolRules.fees.cardRates, through the fee engine): one rule, never a copy.
  const defaultFee = creditCardFee(await feeContext(tenantId), amountDollars)
  const fee = processingFeeDollars ?? defaultFee

  await db.transaction(async (tx) => {
    const txn = { id: await bookEntry(tx, {
      id: await birthId(tx, 'ledger_entry', tenantId),
      tenantId,
      bankAccountId: paypalAccount?.id ?? null,
      amount: amountDollars.toFixed(2),
      direction: 'in',
      type: 'enrollment_payment',
      paidAt: paidAt ?? null,
      referenceId: referenceId ?? null,
      notes,
      recordedBy: userId,
    }) }

    await tx.insert(cashEnrollmentPayments).values({
      tenantId,
      enrollmentId,
      transactionId: txn.id,
      amount: amountDollars.toFixed(2),
      character: PAYMENT_CHARACTER_TUITION,
      method: 'paypal',
      notes,
      recordedBy: userId,
      bankAccountId: paypalAccount?.id ?? null,
      processingFee: fee.toFixed(2),
      paidAt: paidAt ?? null,
      referenceId: referenceId ?? null,
    })
  })

  await maybeMarkEnrollmentPaid(tenantId, enrollmentId)

  return { familyId: enrollment.familyId }
}

/** Set the date a payment was made. */
export async function setEnrollmentPaymentDate(tenantId: string, paymentId: string, date: string): Promise<SimpleResult> {

  const [payment] = await db
    .select({ id: cashEnrollmentPayments.id })
    .from(cashEnrollmentPayments)
    .where(and(eq(cashEnrollmentPayments.id, paymentId), eq(cashEnrollmentPayments.tenantId, tenantId)))
    .limit(1)
  if (!payment) return { error: 'Payment not found.' }

  await db.update(cashEnrollmentPayments)
    .set({ paidAt: date })
    .where(and(eq(cashEnrollmentPayments.id, paymentId), eq(cashEnrollmentPayments.tenantId, tenantId)))

  return { success: true }
}

/** Override the processing fee on a PayPal payment. */
export async function setEnrollmentPaymentProcessingFee(tenantId: string, paymentId: string, processingFeeDollars: number): Promise<SimpleResult> {

  const [payment] = await db
    .select({ enrollmentId: cashEnrollmentPayments.enrollmentId, method: cashEnrollmentPayments.method })
    .from(cashEnrollmentPayments)
    .where(and(eq(cashEnrollmentPayments.id, paymentId), eq(cashEnrollmentPayments.tenantId, tenantId)))
    .limit(1)
  if (!payment) return { error: 'Payment not found.' }
  const { fees } = await tenantRules(tenantId)
  if (payment.method !== fees.cardFeeMethod) {
    const way = fees.ways.find(w => w.method === fees.cardFeeMethod)?.name ?? fees.cardFeeMethod
    return { error: `Processing fee only applies to ${way}.` }
  }

  await db.update(cashEnrollmentPayments)
    .set({ processingFee: processingFeeDollars.toFixed(2) })
    .where(and(eq(cashEnrollmentPayments.id, paymentId), eq(cashEnrollmentPayments.tenantId, tenantId)))

  return { success: true }
}

/** Mail a family whose enrollment is incomplete: what is missing, the fee schedule, and the link. */
export async function sendEnrollmentReminderMail(tenantId: string, familyId: string, actor: Actor): Promise<SimpleResult> {

  const [family] = await db
    .select({ motherId: rosterFamilies.motherId, fatherId: rosterFamilies.fatherId })
    .from(rosterFamilies)
    .where(and(eq(rosterFamilies.id, familyId), eq(rosterFamilies.tenantId, tenantId)))
    .limit(1)
  if (!family) return { error: 'Family not found.' }

  const parentIds = [family.motherId, family.fatherId].filter(Boolean) as string[]
  const parents = parentIds.length
    ? await db.select({ id: persons.id, firstName: persons.firstName, lastName: persons.lastName, email: persons.email })
        .from(persons).where(inArray(persons.id, parentIds))
    : []

  const year = await enrollmentYearOf(tenantId)

  const [enrollment, eligibleKids] = await Promise.all([
    getEnrollment(tenantId, familyId, year),
    getEligibleKids(tenantId, familyId, year),
  ])

  if (enrollment?.status === 'opted_out') return { error: 'Family has opted out of enrollment reminders.' }

  let studentCount = 0
  if (enrollment) {
    studentCount = await getEnrolledStudentCount(enrollment.id)
  }
  const kidNames = formatKidNames(eligibleKids)

  const parentNames = parents.map(p => p.firstName).filter(Boolean)
  const greeting = parentNames.length > 0 ? parentNames.join(' and ') : 'Parent/Guardian'

  // An enrollment email: the family emits its list — the parents (lib/family-recipients).
  const to = await familyRecipients(tenantId, familyId, 'enrollment')
  if (to.length === 0) return { error: 'No email address on file for this family.' }

  const enrollUrl = await enrollmentUrl(await requireTenant(tenantId), familyId)

  const displayCount = Math.max(studentCount, 1)
  const enrollmentPage = await schoolWord(tenantId, 'enrollment-page')
  const [opening, openingPlain, unselected, unselectedPlain, unpaid, unpaidPlain] = await Promise.all([
    schoolWord(tenantId, 'incomplete-opening'), schoolWord(tenantId, 'incomplete-opening-plain'),
    schoolWord(tenantId, 'incomplete-unselected'), schoolWord(tenantId, 'incomplete-unselected-plain'),
    schoolWord(tenantId, 'incomplete-unpaid'), schoolWord(tenantId, 'incomplete-unpaid-plain'),
  ])

  // Tier and every amount come from the fee engine — never derived here, so what the
  // family is quoted is what enrollment charges, grace windows included.
  const fc = await feeContext(tenantId)
  const now = ports().clock.now()
  const schedule = feeSchedule(fc, displayCount, now)

  const reasonHtml = studentCount === 0
    ? `<p style="margin:0 0 16px;font-size:15px;color:#374151;line-height:1.7;">
         ${filled(unselected, { kids: `<strong>${kidNames}</strong>`, year: schoolYearLabel(year), page: enrollmentPage })}
       </p>`
    : `<p style="margin:0 0 16px;font-size:15px;color:#374151;line-height:1.7;">
         ${filled(unpaid, { kids: `<strong>${kidNames}</strong>`, year: schoolYearLabel(year) })}
       </p>`

  const feeNote = tierNoteHtml(fc, now)

  // Only the current period and the ones still ahead of it — an expired period is never
  // shown, because a family cannot buy it.
  const feeTableRows = schedule.map(row => {
    const color = TIER_COLOR[row.place]
    const suffix = studentCount > 0 ? '' : ' (1 student)'
    return `
      <tr style="background:${row.current ? color.bg : '#ffffff'};">
        <td style="padding:8px 12px;font-size:14px;color:#374151;">${row.period}</td>
        <td style="padding:8px 12px;font-size:14px;color:#374151;">${row.label}${suffix}</td>
        <td style="padding:8px 12px;font-size:14px;font-weight:${row.current ? 'bold' : 'normal'};color:${row.current ? color.text : '#374151'};">${money(fc, row.amount)}${row.current ? ' ← current' : ''}</td>
      </tr>`
  }).join('')

  const name = await schoolWord(tenantId, 'name')
  const tagline = await schoolWord(tenantId, 'tagline')
  const colour = await schoolWord(tenantId, 'colour')
  const motto = await schoolWord(tenantId, 'motto')
  const signature = await schoolWord(tenantId, 'signature')
  const signOff = await schoolWord(tenantId, 'mail-sign-off')

  const contentFragment1 = `
            <p style="margin:0 0 20px;font-size:16px;color:#1f2937;">Dear ${greeting},</p>
            <p style="margin:0 0 16px;font-size:15px;color:#374151;line-height:1.7;">
              ${filled(opening, { year: `<strong>${schoolYearLabel(year)}</strong>`, school: name })}
            </p>
            ${reasonHtml}
            ${feeNote}
            <p style="margin:0 0 12px;font-size:14px;color:#374151;font-weight:bold;">Enrollment Fee Schedule${studentCount > 0 ? ` (${studentCount} student${studentCount !== 1 ? 's' : ''})` : ' (per student count)'}:</p>
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;margin:0 0 24px;">
              <tr style="background:#f3f4f6;">
                <th style="padding:8px 12px;font-size:13px;color:#6b7280;font-weight:600;text-align:left;">Period</th>
                <th style="padding:8px 12px;font-size:13px;color:#6b7280;font-weight:600;text-align:left;">Tier</th>
                <th style="padding:8px 12px;font-size:13px;color:#6b7280;font-weight:600;text-align:left;">Fee</th>
              </tr>
              ${feeTableRows}
            </table>
            <p style="margin:0 0 4px;font-size:13px;color:#6b7280;">${feeRuleWords(fc)}</p>
            <table cellpadding="0" cellspacing="0" style="margin:24px 0 28px;">
              <tr>
                <td style="background:${colour};border-radius:6px;padding:14px 28px;">
                  <a href="${enrollUrl}" style="color:#ffffff;font-size:15px;font-weight:bold;text-decoration:none;font-family:Arial,sans-serif;">
                    Complete Enrollment for ${schoolYearLabel(year)} →
                  </a>
                </td>
              </tr>
            </table>
            <p style="margin:0 0 8px;font-size:14px;color:#6b7280;">If the button does not work, copy and paste this link into your browser:</p>
            <p style="margin:0 0 28px;font-size:13px;"><a href="${enrollUrl}" style="color:${colour};">${enrollUrl}</a></p>
            <p style="margin:0 0 8px;font-size:15px;color:#374151;line-height:1.7;">If you have any questions or need assistance, please reply to this email.</p>
            <p style="margin:28px 0 0;font-size:15px;color:#374151;">
              ${signOff}<br>
              <strong>${signature}</strong><br>
              <span style="color:#6b7280;">${tagline}</span>
            </p>`

  const plainBody = [
    `Dear ${greeting},`,
    '',
    filled(openingPlain, { year: schoolYearLabel(year), school: name }),
    '',
    studentCount === 0
      ? filled(unselectedPlain, { kids: kidNames, year: schoolYearLabel(year), page: enrollmentPage })
      : filled(unpaidPlain, { kids: kidNames, year: schoolYearLabel(year) }),
    '',
    `Fee schedule${studentCount > 0 ? ` for ${kidNames}` : ''}:`,
    ...schedule.map(r => `  ${r.period.padEnd(18)} ${r.label}: ${money(fc, r.amount)}${r.current ? ' (current)' : ''}`),
    '',
    `Complete your enrollment: ${enrollUrl}`,
    '',
    signOff,
    signature,
    tagline,
  ].join('\n')

  try {
    await sendEmail(tenantId, {
      to,
      subject: `${name} ${schoolYearLabel(year)} Enrollment — Action Required`,
      body: plainBody,
      contentFragment: contentFragment1,
      templateOpts: { tagline: `${tagline} · ${motto}`, contactEmail: await catalogValue(tenantId, 'admissions-contact') },
      replyTo: await catalogValue(tenantId, 'admissions-contact'),
    }, actor)
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to send email.' }
  }

  return { success: true }
}

/** Mail a family that has not started enrollment: the invitation, the fee schedule for one and two students. */
export async function sendNotStartedReminderMail(tenantId: string, familyId: string, actor: Actor): Promise<SimpleResult> {

  const [family] = await db
    .select({ motherId: rosterFamilies.motherId, fatherId: rosterFamilies.fatherId })
    .from(rosterFamilies)
    .where(and(eq(rosterFamilies.id, familyId), eq(rosterFamilies.tenantId, tenantId)))
    .limit(1)
  if (!family) return { error: 'Family not found.' }

  const parentIds = [family.motherId, family.fatherId].filter(Boolean) as string[]
  const parents = parentIds.length
    ? await db.select({ firstName: persons.firstName, lastName: persons.lastName, email: persons.email })
        .from(persons).where(inArray(persons.id, parentIds))
    : []

  const year = await enrollmentYearOf(tenantId)

  // An enrollment email: the family emits its list — the parents (lib/family-recipients).
  const to = await familyRecipients(tenantId, familyId, 'enrollment')
  if (to.length === 0) return { error: 'No email address on file for this family.' }

  const eligibleKids = await getEligibleKids(tenantId, familyId, year)
  const kidNames = formatKidNames(eligibleKids)

  const parentNames = parents.map(p => p.firstName).filter(Boolean)
  const greeting = parentNames.length > 0 ? parentNames.join(' and ') : 'Parent/Guardian'
  const enrollUrl = await enrollmentUrl(await requireTenant(tenantId), familyId)

  // This family has not selected students yet, so the schedule is shown for 1 and 2
  // students. Tier and amounts come from the fee engine, and expired periods are dropped, so the
  // mail never names a period that is over.
  const fc = await feeContext(tenantId)
  const now = ports().clock.now()
  const schedule1 = feeSchedule(fc, 1, now)
  const schedule2 = feeSchedule(fc, 2, now)

  const inviteFeeNote = tierNoteHtml(fc, now)

  const inviteFeeRows = schedule1.map((row, i) => {
    const color = TIER_COLOR[row.place]
    const two = schedule2[i]
    return `
              <tr style="background:${row.current ? color.bg : '#ffffff'};">
                <td style="padding:8px 12px;font-size:14px;color:#374151;">${row.period}${row.current ? ` <strong style="color:${color.text};">← now</strong>` : ''}</td>
                <td style="padding:8px 12px;font-size:14px;font-weight:${row.current ? 'bold' : 'normal'};color:${row.current ? color.text : '#374151'};">${money(fc, row.amount)}</td>
                <td style="padding:8px 12px;font-size:14px;font-weight:${row.current ? 'bold' : 'normal'};color:${row.current ? color.text : '#374151'};">${money(fc, two.amount)}</td>
              </tr>`
  }).join('')

  const name = await schoolWord(tenantId, 'name')
  const tagline = await schoolWord(tenantId, 'tagline')
  const colour = await schoolWord(tenantId, 'colour')
  const motto = await schoolWord(tenantId, 'motto')
  const signature = await schoolWord(tenantId, 'signature')
  const signOff = await schoolWord(tenantId, 'mail-sign-off')
  const enrollmentPage = await schoolWord(tenantId, 'enrollment-page')
  const [opening, welcome, warmth, ask, optOut, optOutPlain] = await Promise.all([
    schoolWord(tenantId, 'reminder-opening'), schoolWord(tenantId, 'reminder-welcome'),
    schoolWord(tenantId, 'reminder-warmth'), schoolWord(tenantId, 'reminder-ask'),
    schoolWord(tenantId, 'reminder-opt-out'), schoolWord(tenantId, 'reminder-opt-out-plain'),
  ])

  const contentFragment2 = `
            <p style="margin:0 0 20px;font-size:16px;color:#1f2937;">Dear ${greeting},</p>
            <p style="margin:0 0 16px;font-size:15px;color:#374151;line-height:1.7;">
              ${opening} ${filled(welcome, { year: `<strong>${schoolYearLabel(year)}</strong>`, school: name })}
            </p>
            <p style="margin:0 0 16px;font-size:15px;color:#374151;line-height:1.7;">
              ${filled(warmth, { kids: `<strong>${kidNames}</strong>` })} ${ask}
            </p>
            ${inviteFeeNote}
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;margin:0 0 8px;">
              <tr style="background:#f3f4f6;">
                <th style="padding:8px 12px;font-size:13px;color:#6b7280;font-weight:600;text-align:left;">Period</th>
                <th style="padding:8px 12px;font-size:13px;color:#6b7280;font-weight:600;text-align:left;">1 student</th>
                <th style="padding:8px 12px;font-size:13px;color:#6b7280;font-weight:600;text-align:left;">2 students</th>
              </tr>
              ${inviteFeeRows}
            </table>
            <p style="margin:0 0 24px;font-size:13px;color:#6b7280;">${feeRuleWords(fc)}</p>
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
            <p style="margin:0 0 8px;font-size:15px;color:#374151;line-height:1.7;">${filled(optOut, { page: enrollmentPage })}</p>
            <p style="margin:0 0 8px;font-size:15px;color:#374151;line-height:1.7;">If you have any questions, please reply to this email.</p>
            <p style="margin:28px 0 0;font-size:15px;color:#374151;">
              ${signOff}<br>
              <strong>${signature}</strong><br>
              <span style="color:#6b7280;">${tagline}</span>
            </p>`

  const plainBody = [
    `Dear ${greeting},`,
    '',
    filled(welcome, { year: schoolYearLabel(year), school: name }),
    '',
    filled(warmth, { kids: kidNames }),
    '',
    `Fee: ${feeRuleWords(fc)}`,
    ...schedule1.map((r, i) => `  ${r.period.padEnd(18)} ${money(fc, r.amount)} (1 student) / ${money(fc, schedule2[i].amount)} (2 students)${r.current ? ' (current)' : ''}`),
    '',
    `Enroll now: ${enrollUrl}`,
    '',
    filled(optOutPlain, { page: enrollmentPage }),
    '',
    signOff,
    signature,
    tagline,
  ].join('\n')

  try {
    await sendEmail(tenantId, {
      to,
      subject: `${name} ${schoolYearLabel(year)} Enrollment — Open Now`,
      body: plainBody,
      contentFragment: contentFragment2,
      templateOpts: { tagline: `${tagline} · ${motto}`, contactEmail: await catalogValue(tenantId, 'admissions-contact') },
      replyTo: await catalogValue(tenantId, 'admissions-contact'),
    }, actor)
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to send email.' }
  }

  return { success: true }
}

/** An enrollment's family and when it was created — what a family's own Zelle check needs. */
export async function enrollmentForZelleCheck(tenantId: string, enrollmentId: string) {
  const [enrollment] = await db
    .select({
      id: familyEnrollments.id,
      familyId: familyEnrollments.familyId,
      createdAt: familyEnrollments.createdAt,
    })
    .from(familyEnrollments)
    .where(and(eq(familyEnrollments.id, enrollmentId), eq(familyEnrollments.tenantId, tenantId)))
    .limit(1)
  return enrollment ?? null
}

/** The unapplied Zelle and PayPal rows, labelled, oldest first. */
export async function unappliedIncomingPayments(tenantId: string): Promise<Array<{ id: string; label: string; amount: string; source: string; referenceId: string | null; receivedAt: string }>> {
  const rows = await db
    .select()
    .from(incomingPayments)
    .where(and(
      eq(incomingPayments.tenantId, tenantId),
      eq(incomingPayments.status, 'unmatched'),
    ))
    .orderBy(incomingPayments.receivedAt)
  const fc = await feeContext(tenantId)
  return rows.map(r => ({
    id: r.id,
    label: `${r.receivedAt} · ${r.source} · ${moneyCents(fc, Number(r.amount))} · ${r.senderName ?? 'unknown sender'}`,
    amount: String(r.amount),
    source: r.source,
    referenceId: r.referenceId ?? null,
    receivedAt: String(r.receivedAt),
  }))
}
