import { hostPage } from './host'
import { filled } from './school-words'
import type { SchoolRules } from '../ports'

// The HELP TEXT of the roster — as data, so a page and a reader of the family context read the same words. The
// site's address is not named here: it is the tenant's, read per environment.
//
// Two audiences, because one person may be both a teacher and a parent and sign in with one address. So
// `schoolHelp()` carries both sets and every section says which audience it answers; a reader picks by the question,
// not by a role. Nothing here is about one person.
//
// ONE OWNER. Help prose a page shows comes from here, never from a copy in the page.
//
// WHAT BELONGS HERE: durable explanation — how placement works, what an evaluation is, how to donate. WHAT DOES NOT:
// anything about one family (their status, their children, their money); that is the family context's, and this
// module takes no family id and touches no database.
//
// The admission address is passed in rather than written down: it is the tenant's own datum.

export type HelpAudience = 'family' | 'teacher'

export type HelpSection = {
  id: string
  audience: HelpAudience
  title: string
  body: string
  /** One line for a feature table — no second person: generally avoid "you/your". */
  feature?: string
}

/** The culture classes in words: one per grade from the first to the school's last class, a higher grade placed in the
 *  last ("X1–X4 by grade; grade 4 and above in X4" for prefix X and a last class of 4); a last class at the school's last
 *  grade places no grade above it. */
export function cultureClassWords(courses: CultureClassRules): string {
  const p = courses.cultureCodePrefix, last = courses.lastCultureGrade
  return last >= courses.grades.last
    ? `${p}1–${p}${last} by grade`
    : `${p}1–${p}${last} by grade; grade ${last} and above in ${p}${last}`
}

// Every string a family may be shown. `id` is stable and citable — a chatbot answer can
// name the section it came from, and a reader keys its cards by the same value.
// `schoolName` is the school's name word (schoolWord(tenantId, 'name')), handed in by the caller; `courses` are the
// school's course rules (SchoolRules.courses), so the sentence says the school's own culture classes; `paymentWays`
// are the names of the ways it takes money (SchoolRules.fees.ways) and `donationStatus` what it says of itself after its
// name (schoolWord 'donation-status').
export type CultureClassRules = Pick<SchoolRules['courses'], 'cultureCodePrefix' | 'lastCultureGrade' | 'grades' | 'departmentWords'>
export type FamilyHelpWords = {
  admissionEmail: string; schoolName: string; courses: CultureClassRules; paymentWays: string[]; donationStatus: string
  /** How the school places a child (schoolWord 'placement-basis'). */
  placementBasis: string
  /** What the school calls the receipt a donor is mailed (schoolWord 'receipt-name'). */
  receiptName: string
  /** The host's controls and places the help points a family to (schoolWords 'pay-button', 'enrollment-place',
   *  'home-place', 'edit-button'). */
  controls: HelpControls
}

/** The host's controls and places as the help names them: the control that opens payment, where the enrollment's state
 *  shows, the family's own page, and the control that corrects a record; the word a family reads once enrolled
 *  (schoolWord 'enrolled-word') and the account a person signs in with (schoolWord 'sign-in-account'); the record
 *  section's feature line, `{edit}` filled (schoolWord 'family-record-feature'), and what the family's own page shows
 *  (schoolWord 'family-record-shows'). */
export type HelpControls = {
  payButton: string; enrollmentPlace: string; homePlace: string; editButton: string; enrolledWord: string; signInAccount: string
  recordFeature: string; recordShows: string
}

export function familyHelp(opts: FamilyHelpWords): HelpSection[] {
  const ways = opts.paymentWays.join(' or ')
  const c = opts.controls
  return [
    {
      id: 'not-linked',
      audience: 'family',
      title: 'If your account is not linked to a family',
      body:
        'You are signed in but your account is not yet linked to a family record. ' +
        `If you are a ${opts.schoolName} family, please contact ${opts.admissionEmail} to link your ${c.signInAccount} to your family. ` +
        `Use the same ${c.signInAccount} that is on file with the school — the one where you receive school communications. ` +
        `Signing in with a different ${c.signInAccount} creates a second, empty family record rather than opening the one you already have.`,
    },
    {
      id: 'enrollment',
      audience: 'family',
      title: 'Enrollment',
      feature: `Once a year: choose the children and pay by ${ways}. Until the payment is confirmed the status is a ${c.payButton} button, then it reads ${c.enrolledWord}.`,
      body:
        `Enrollment opens once a year. While it is open you select your children and pay by ${ways} to secure your spot. ` +
        `Until your payment is confirmed, ${c.enrollmentPlace} shows a "${c.payButton}" button; it opens the page to pay by ${ways}. If you have already paid another way, it shows here once the school confirms it — do not pay twice.` +
        `When the payment is confirmed your family is "${c.enrolledWord}" for the school year and your children's class assignments appear on ${c.homePlace}.`,
    },
    {
      id: 'classes',
      audience: 'family',
      title: 'Family classes',
      feature: `Each child's ${opts.courses.departmentWords.culture.toLowerCase()} and ${opts.courses.departmentWords.language.toLowerCase()} class, with a link to join its Meet or open its Classroom.`,
      body:
        `Each child is placed in a ${opts.courses.departmentWords.culture.toLowerCase()} class (${cultureClassWords(opts.courses)}) and a ${opts.courses.departmentWords.language.toLowerCase()} class ${opts.placementBasis}. ` +
        'The Meet link opens the Google Meet for the class. Where a class has no Meet link, the Classroom link opens its Google Classroom instead.',
    },
    {
      id: 'calendar',
      audience: 'family',
      title: 'School calendar',
      feature: 'Every school day of the year.',
      body:
        "The school's calendar lists every school day of the year.",
    },
    {
      id: 'family-record',
      audience: 'family',
      title: 'Family record',
      feature: filled(c.recordFeature, { edit: c.editButton }),
      body:
        `${c.recordShows} ` +
        `If any information is incorrect, use the ${c.editButton} button to update it.`,
    },
    {
      id: 'evaluations',
      audience: 'family',
      title: 'Evaluation reports',
      feature: "Each year's report, emailed as a PDF and downloadable any time.",
      body:
        'Teachers submit an evaluation for each student. You will receive a PDF by email, and you can also view and download reports here at any time. ' +
        "Each report shows criteria scores, the teacher's comment, and the recommended course for next year.",
    },
    {
      id: 'donate',
      audience: 'family',
      title: 'Donating',
      feature: `${ways}, with an automatic ${opts.receiptName}.`,
      body:
        `${opts.schoolName} ${opts.donationStatus} ` +
        `You can donate by ${ways} — a ${opts.receiptName} is emailed automatically once confirmed.`,
    },
    {
      id: 'questions',
      audience: 'family',
      title: 'Questions',
      feature: `Email ${opts.admissionEmail}.`,
      body: `Anything this does not answer: email ${opts.admissionEmail}.`,
    },
  ]
}

// ---------------------------------------------------------------------------
// Teacher
// ---------------------------------------------------------------------------
//
// How a teacher signs in to the school's Google account and uses it, as prose a reader asking one question reads. What
// the account is for, which address to use where and how to add it on a device are the school's words; the
// step-by-step version is the host's public teacher-account page, which the setup section links to.
//
// The temporary password is NOT here and must never be: it is per-teacher, it arrives in
// their own welcome mail, and this text goes into a model prompt.

/** The school's words for its teacher account (schoolWords 'teacher-account-purpose', 'teacher-account-use',
 *  'teacher-account-setup-title', 'teacher-account-setup', 'teacher-account-first-sign-in'). */
export type TeacherHelpWords = { purpose: string; use: string; setupTitle: string; setup: string; firstSignIn: string }

export function teacherHelp(opts: { admissionEmail: string; domain: string; schoolName: string; teacherWords: TeacherHelpWords }): HelpSection[] {
  // The school's directory domain is the tenant's (workspaceDomain()), handed in by the caller.
  const at = `@${opts.domain}`
  const w = opts.teacherWords
  const fill = { at, school: opts.schoolName, domain: opts.domain, page: hostPage('teacher-account') }
  return [
    {
      id: 'teacher-classroom-login',
      audience: 'teacher',
      title: 'Signing in to your Google Classroom',
      body:
        `Sign in to Google Classroom with your ${at} address — not your personal one. ` +
        `${filled(w.purpose, fill)} ` +
        `Go to classroom.google.com, check that the account shown at the top right is your ${at} one, and your class appears there. ` +
        `If you have never used it, the temporary password is in your welcome email; ${w.firstSignIn}`,
    },
    {
      id: 'teacher-which-account',
      audience: 'teacher',
      title: 'Which address to use where',
      body: filled(w.use, fill),
    },
    {
      id: 'teacher-add-account',
      audience: 'teacher',
      title: w.setupTitle,
      body: filled(w.setup, fill),
    },
    {
      id: 'teacher-starting-the-class',
      audience: 'teacher',
      title: 'Starting your class meeting',
      body:
        `Open meet.google.com signed in as your ${at} account, and you can host the meeting and admit students. ` +
        'Signed in as your personal address you will not be the host and may not be able to let students in.',
    },
    {
      id: 'teacher-check-the-mailbox',
      audience: 'teacher',
      title: 'Checking the school mailbox',
      body:
        `Open the ${at} account now and then through the year. Anything Google Classroom needs to tell you about your class arrives there, and it is easy to miss an account you rarely check.`,
    },
    {
      id: 'teacher-stuck',
      audience: 'teacher',
      title: 'If you are stuck',
      body:
        `Reply to your welcome email describing what happened, or write to ${opts.admissionEmail} — either reaches someone who can help.`,
    },
  ]
}

// What a reader asking for the signed-in person receives, SCOPED TO THE PERSON the verified
// token names, never everything to everyone. Family help always; teacher help
// only for someone who actually teaches this year. Both, for one who is both: a teacher who is
// also a parent signs in with one address and asks from either hat in one conversation.
export function schoolHelp(opts: FamilyHelpWords & { domain: string; teaches: boolean; teacherWords: TeacherHelpWords }): HelpSection[] {
  const sections = familyHelp(opts)
  return opts.teaches ? [...sections, ...teacherHelp(opts)] : sections
}
