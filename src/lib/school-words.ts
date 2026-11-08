import { ports, type SchoolWord } from '../ports'

/** One of the school's own words (SCHOOL_WORDS), as the host holds it for the tenant. */
export const schoolWord = (tenantId: string, key: SchoolWord) => ports().tenants.schoolWord(tenantId, key)

/** A school word that names things the roster fills, `{key}` by `values[key]`; a placeholder with no value stays as
 *  written. */
export function filled(word: string, values: Record<string, string>): string {
  return word.replace(/\{(\w+)\}/g, (all, k: string) => values[k] ?? all)
}

/** The school's words the teacher's welcome mail carries (teacher-account-email.ts). */
export async function teacherMailWords(tenantId: string): Promise<{
  schoolName: string; colour: string; thanks: string; repliesReadBy: string
  housekeeping: string; addressRule: string; ruleNote: string; replyAsk: string; closing: string
  whyAddress: string; signInRule: string; phoneAsk: string; helpLead: string; remember: string
}> {
  const [schoolName, colour, thanks, repliesReadBy, housekeeping, addressRule, ruleNote, replyAsk, closing,
    whyAddress, signInRule, phoneAsk, helpLead, remember] = await Promise.all([
    schoolWord(tenantId, 'name'), schoolWord(tenantId, 'colour'), schoolWord(tenantId, 'teacher-thanks'), schoolWord(tenantId, 'replies-read-by'),
    schoolWord(tenantId, 'teacher-mail-housekeeping'), schoolWord(tenantId, 'teacher-mail-address-rule'), schoolWord(tenantId, 'teacher-mail-rule-note'),
    schoolWord(tenantId, 'teacher-mail-reply-ask'), schoolWord(tenantId, 'teacher-mail-closing'),
    schoolWord(tenantId, 'teacher-mail-why-address'), schoolWord(tenantId, 'teacher-mail-sign-in-rule'),
    schoolWord(tenantId, 'teacher-mail-phone-ask'), schoolWord(tenantId, 'teacher-mail-help-lead'), schoolWord(tenantId, 'teacher-mail-remember'),
  ])
  return { schoolName, colour, thanks, repliesReadBy, housekeeping, addressRule, ruleNote, replyAsk, closing, whyAddress, signInRule, phoneAsk, helpLead, remember }
}

/** The host's controls and places the help names (help.ts HelpControls). */
export async function helpControls(tenantId: string): Promise<{
  payButton: string; enrollmentPlace: string; homePlace: string; editButton: string; enrolledWord: string; signInAccount: string
  recordFeature: string; recordShows: string
}> {
  const [payButton, enrollmentPlace, homePlace, editButton, enrolledWord, signInAccount, recordFeature, recordShows] = await Promise.all([
    schoolWord(tenantId, 'pay-button'), schoolWord(tenantId, 'enrollment-place'), schoolWord(tenantId, 'home-place'), schoolWord(tenantId, 'edit-button'),
    schoolWord(tenantId, 'enrolled-word'), schoolWord(tenantId, 'sign-in-account'),
    schoolWord(tenantId, 'family-record-feature'), schoolWord(tenantId, 'family-record-shows'),
  ])
  return { payButton, enrollmentPlace, homePlace, editButton, enrolledWord, signInAccount, recordFeature, recordShows }
}

/** The school's words for its teacher account the teacher help carries (help.ts TeacherHelpWords). */
export async function teacherHelpWords(tenantId: string): Promise<{ purpose: string; use: string; setupTitle: string; setup: string; firstSignIn: string }> {
  const [purpose, use, setupTitle, setup, firstSignIn] = await Promise.all([
    schoolWord(tenantId, 'teacher-account-purpose'), schoolWord(tenantId, 'teacher-account-use'),
    schoolWord(tenantId, 'teacher-account-setup-title'), schoolWord(tenantId, 'teacher-account-setup'),
    schoolWord(tenantId, 'teacher-account-first-sign-in'),
  ])
  return { purpose, use, setupTitle, setup, firstSignIn }
}

/** The school's words the enrollment invitation carries: its welcome and warmth ({kids}, {year}, {school}) and the
 *  sign-off the enrollment mails close with (enrollment-invitation.ts, family-enrollment-writes.ts). */
export async function invitationWords(tenantId: string): Promise<{ welcome: string; warmth: string; ask: string; signOff: string }> {
  const [welcome, warmth, ask, signOff] = await Promise.all([
    schoolWord(tenantId, 'invitation-welcome'), schoolWord(tenantId, 'invitation-warmth'),
    schoolWord(tenantId, 'invitation-ask'), schoolWord(tenantId, 'mail-sign-off'),
  ])
  return { welcome, warmth, ask, signOff }
}

/** What the family context says of each kind of data it does not carry (family-context.ts Unavailable). */
export async function unavailableWords(tenantId: string): Promise<{ attendance: string; announcements: string; calendar: string }> {
  const [attendance, announcements, calendar] = await Promise.all([
    schoolWord(tenantId, 'attendance-unavailable'), schoolWord(tenantId, 'announcements-unavailable'), schoolWord(tenantId, 'calendar-unavailable'),
  ])
  return { attendance, announcements, calendar }
}
