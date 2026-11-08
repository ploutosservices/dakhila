/**
 * The email a teacher receives when their school account is created. One template; each send is the same
 * text with the teacher's own values, and no per-email review.
 *
 * Replies go to the school's lead-teacher-email value.
 *
 * The temporary password travels in this same email
 * rather than in a separate message: one email carries both, and changePasswordAtNextLogin makes the value dead the
 * moment it is used.
 */
import { platformEmail } from './email-template'
import { filled } from './school-words'

// The host's public, no-login teacher-account help page — how to use the account on a device — lives in whichever
// environment sent the mail: callers pass teacherAccountHelpUrl(tenant).

export type TeacherAccountEmailInput = {
  /** Teacher's first name, for the greeting. */
  firstName: string
  /** School year label — always from schoolYearLabel(), never built by hand. */
  schoolYear: string
  /** Class short codes this teacher is assigned to, e.g. ['X1']. */
  classes: string[]
  /** The address just created, on the school's directory domain. */
  schoolAddress: string
  /** The school's name, its mails' colour, its thanks, who reads the replies and the mail's own sentences in the
   *  school's voice — teacherMailWords(tenantId), which also carries the account sentences below. */
  schoolName: string
  colour: string
  thanks: string
  repliesReadBy: string
  housekeeping: string
  /** What the directory's rule on outside addresses in a class is, and the school's note after it. */
  addressRule: string
  ruleNote: string
  replyAsk: string
  closing: string
  /** The account sentences in the school's voice: why the address is needed, which address the roster's mail and
   *  sign-in keep ({roster} filled), the ask to add a phone, the line before the help page, and what to remember
   *  ({domain}, {school} filled). */
  whyAddress: string
  signInRule: string
  phoneAsk: string
  helpLead: string
  remember: string
  /** Temporary password. Dead on first use — changePasswordAtNextLogin is set. Off production no account is made
   *  and no password exists: the statement of what was not made stands in its place. */
  temporaryPassword: string | { notMade: string }
  /** Public, no-login help page in THIS environment — teacherAccountHelpUrl(tenant). */
  helpUrl: string
  /** The lead teacher's address, for the contact line — leadTeacherEmail(tenantId). */
  contactEmail: string
  /** The school's directory domain — workspaceDomain(tenantId). */
  domain: string
  /** The roster's public address in THIS environment — rosterPublicUrl(tenant). */
  rosterUrl: string
}

export function teacherAccountEmail(input: TeacherAccountEmailInput) {
  const { firstName, schoolYear, classes, schoolAddress, schoolName, temporaryPassword } = input
  const passwordLine = typeof temporaryPassword === 'string'
    ? `Temporary password: <strong style="font-family:monospace;font-size:15px;">${temporaryPassword}</strong>`
    : `<strong style="color:#b91c1c;">The account was not made: ${temporaryPassword.notMade}</strong>`
  const helpUrl = input.helpUrl
  const rosterHost = new URL(input.rosterUrl).host

  const taught = classes.length === 1
    ? `<strong>${classes[0]}</strong>`
    : classes.slice(0, -1).map(c => `<strong>${c}</strong>`).join(', ') + ` and <strong>${classes.at(-1)}</strong>`

  const p = 'margin:0 0 16px;font-size:16px;line-height:1.6;color:#1f2937;'
  const colour = input.colour
  const h = `margin:28px 0 12px;font-size:15px;font-weight:bold;color:${colour};letter-spacing:.02em;`

  const body = `
    <p style="${p}">Dear ${firstName},</p>

    <p style="${p}">${filled(input.thanks, { classes: taught, school: schoolName, year: schoolYear })}</p>

    <p style="${p}">${input.housekeeping}</p>

    <h3 style="${h}">Why you are getting a ${input.domain} address</h3>

    <p style="${p}">${input.addressRule} ${input.ruleNote} ${input.whyAddress}</p>

    <p style="${p}">So we have created one for you. It exists so that Classroom and Meet
    work properly. ${filled(input.signInRule, { roster: rosterHost })} Google itself is the one exception: if you ever need
    to reset your password, or confirm it is really you, the code goes to that mailbox
    — so it is worth knowing how to open it.</p>

    <h3 style="${h}">Your sign-in details</h3>

    <table cellpadding="0" cellspacing="0" style="width:100%;background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;margin:0 0 16px;">
      <tr>
        <td style="padding:16px 20px;font-family:Georgia,serif;font-size:15px;color:#1f2937;line-height:1.8;">
          Address: <strong style="font-family:monospace;font-size:15px;">${schoolAddress}</strong><br>
          ${passwordLine}
        </td>
      </tr>
    </table>

    <p style="${p}">Sign in once at
    <a href="https://accounts.google.com" style="color:${colour};">accounts.google.com</a>
    and Google will ask you to choose your own password straight away — the temporary
    one above stops working the moment you do. Google will also ask you to add your
    mobile number, which is how it confirms it is really you if you ever lose the
    password. ${input.phoneAsk}</p>

    <h3 style="${h}">Using it on your computer and your phone</h3>

    <p style="${p}">You do not need to give up your own email account or sign out of it.
    On a computer you can be signed into both at once and switch between them; on a
    phone you add this as a second account. ${input.helpLead}</p>

    <p style="${p}"><a href="${helpUrl}" style="color:${colour};font-weight:bold;">${helpUrl}</a></p>

    <p style="${p}">${filled(input.remember, { domain: input.domain, school: schoolName })}</p>

    <h3 style="${h}">If anything here does not work</h3>

    <p style="${p}">${input.replyAsk} ${filled(input.repliesReadBy, { school: schoolName })}</p>

    <p style="${p}">${input.closing}</p>
  `

  return {
    subject: `Your ${schoolName} Google Classroom account — ${schoolYear}`,
    // The unwrapped body, so a caller can show the exact text a teacher will receive
    // rather than a retyped copy of it that could drift from this.
    contentFragment: body,
    ...platformEmail(body, {
      tagline: schoolName,
      contactEmail: input.contactEmail,
    }),
  }
}
