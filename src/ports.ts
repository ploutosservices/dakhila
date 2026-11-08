// THE PORTS: what the roster needs from the application that runs it (the host), declared here and filled by the host
// when it starts the server (index.ts `start`). The roster reads no environment variable and names no host: every
// value and service below is the host's, handed in. A test hands in fakes (`usePorts`).
import type { Pool } from 'pg'
import type { GoogleAuth, GoogleAuthOptions, JWT, JWTOptions } from 'google-auth-library'
import type { NewsletterFilter } from './lib/newsletter-filter'

/** Where the server listens: a loopback port, or a unix socket only the proxy may open. */
export type Listen = { port: number } | { socket: string }

/** Who may call, in the host's names. */
export type Identity = {
  /** The issuer of the tokens a person's call carries; a token whose `iss` is not this is refused. */
  issuer: string
  /** The one client whose exchanged tokens are taken (a token's `azp`). */
  callerClient: string
  /** The application whose certificate opens the operations marked public-door, and whose view-as and impersonation
   *  headers are believed. */
  hostApplication: string
  /** The header the proxy sets from a verified client certificate, overwritten on every request. */
  certificateHeader: string
  /** The headers the host application sends beside its certificate for its session's state: the user viewed as, that
   *  user's name, and the impersonator its sign-in named. Believed only from the host application. */
  viewHeaders: { viewedAs: string; viewedAsName: string; impersonator: string }
  /** Where the door's access token carries roles, as dotted claim paths tried in order (the first that holds a value
   *  is read; `{audience}` stands for the roster's audience): the roles the door gives for the roster, and the roles it
   *  gives across applications. */
  roleClaims: { roster: string[]; given: string[] }
  /** The deployment this process runs in, as the deployment's certificates name it. */
  ownDeployment(): string
  /** The deployment and the application a certificate subject names; each throws on a subject it cannot read. */
  deploymentOf(subject: string): string
  applicationOf(subject: string): string
}

/** Who or what approved an act, as the host records an outward act. A person carries the real signed-in user and,
 *  under view-as, the one viewed as; under the door's act-as, the impersonator the door's token named. A public door
 *  names its page, the event and its caller; a machine names its verb and credential; a schedule names itself. */
export type Actor =
  | { person: { userId: string; name?: string | null; viewedAs?: { userId: string; name: string } | null; impersonator?: string | null } }
  | { page: string; event: string; caller: string }
  | { verb: string; credential: string }
  | { schedule: string }

/** A text the roster decided to send: to whom, as a new text or the one automatic reply, under which consent, and where
 *  the provider reports its delivery. */
export type DecidedText = { to: string; kind: 'new' | 'auto'; consent: Consent; statusCallback: string | null }

/** Texting and calling: the school's number, a call placed from it to a parent, and a text sent from it (recorded as
 *  the actor's act; off production the host sends it to its own test recipient). Answers the provider's id and the number reached. */
export type Phone = {
  schoolNumber(): Promise<string>
  placeCall(tenantId: string, caller: string, parent: string, parentFirstName: string, actor: Actor): Promise<{ placed: boolean; dialled: string }>
  sendText(tenantId: string, text: DecidedText, body: string, actor: Actor): Promise<{ sid: string; sentTo: string }>
}

/** How a card paid, which decides its fee's rate: in the card fields, or through Apple Pay. */
export type CardWay = 'card' | 'apple_pay'
/** The card that paid, as the provider names it; only CREDIT carries the credit-card fee. */
export type CardType = 'CREDIT' | 'DEBIT' | 'PREPAID' | 'STORE' | 'UNKNOWN'

/** A captured order: the provider's transaction id, the amount, its fee (null when the provider stated none, never
 *  '0'), and the card (null for a wallet payment). */
export type OrderCapture = { captureId: string; capturedAmount: string; processingFee: string | null; cardType: CardType | null }
/** An order the payer approved and has not paid: its amount now, the amount it was made for, and the card. */
export type ApprovedOrder = { amount: string; enrollmentAmount: string; cardType: CardType | null; cardWay: CardWay }
/** A refund as the provider answers it; its fee returned, or null. */
export type RefundAnswer = { refundId: string; status: string; amount: string; refundedFee: string | null }
/** A dispute as the provider answers it. */
export type DisputeAnswer = {
  disputeId: string; transactionId: string | null; reason: string | null; status: string | null; amount: string | null; outcome: string | null
}
/** A payment in the provider's transaction report. `date` is the day in the school's zone; the fee is what it cost. */
export type PaypalTransaction = {
  transactionId: string; amount: string; processingFee: string | null; senderName: string; senderEmail: string | null
  date: string; receivedAtUtc: Date
}

/** The payment provider, with the roster's verbs. Each act that moves money is recorded as the actor's act. Amounts
 *  are decimal strings in the school's currency (SchoolRules.currency); the host tells its provider which. */
export type Payments = {
  createOrder(tenantId: string, amount: string, actor: Actor, owed?: string): Promise<{ id: string }>
  patchOrderAmount(tenantId: string, orderId: string, amount: string, actor: Actor): Promise<void>
  captureOrder(tenantId: string, orderId: string, actor: Actor): Promise<OrderCapture>
  readApprovedOrder(orderId: string): Promise<ApprovedOrder>
  readOrderCapture(orderId: string): Promise<OrderCapture | null>
  refundCapture(tenantId: string, captureId: string, amount: string, requestId: string, actor: Actor): Promise<RefundAnswer>
  readRefund(refundId: string): Promise<RefundAnswer | null>
  readRefundWithCapture(refundId: string): Promise<(RefundAnswer & { captureId: string | null }) | null>
  readCapture(captureId: string): Promise<{ status: string; orderId: string | null } | null>
  readDispute(disputeId: string): Promise<DisputeAnswer | null>
  readTransactions(sinceDate: string): Promise<PaypalTransaction[]>
}

/** A bank deposit the school received, as the host read it from its bank's notices: the amount (decimal string), the
 *  payer's name as the bank gives it, the bank's reference, the day it arrived in the school's zone ("YYYY-MM-DD"), the
 *  instant, and the notice's own id. */
export type Deposit = { amount: string; payer: string; reference: string; day: string; receivedAt: Date; noticeId: string }

/** The school's bank deposits: how they are read (a mailbox, a bank's feed) and its wording are the host's. */
export type Deposits = {
  /** Every deposit the host can read that arrived on or after `sinceDate` ("YYYY-MM-DD"). */
  since(tenantId: string, sinceDate: string): Promise<Deposit[]>
}

/** The signature headers a payment provider's notice carries. */
export type NoticeHeaders = {
  authAlgo: string; certUrl: string; transmissionId: string; transmissionSig: string; transmissionTime: string
}

/** A payment provider's notices: the hook this deployment listens on, and whether a notice is signed by the provider. */
export type PaymentNotices = {
  webhookId(): Promise<{ name: string; id: string | null }>
  verifyNotice(h: NoticeHeaders, rawBody: string, webhookId: string): Promise<boolean>
}

/** A mail the roster sends for a tenant, in the host's one template. */
export type MailMessage = {
  to: string | string[]
  cc?: string | string[]
  subject: string
  /** Plain text; sent as the text part when there is no HTML. */
  body: string
  /** Full HTML, or a fragment the host wraps in the tenant's template — one or the other. */
  htmlBody?: string
  contentFragment?: string
  templateOpts?: { tagline?: string; contactEmail?: string; footerNote?: string; referenceId?: string; familyRef?: FamilyRef }
  replyTo?: string
  cidLogo?: { url: string; contentId: string }
  attachments?: Array<{ filename: string; data: Buffer; contentType: string }>
}

/** Which family a mail is about: carried hidden in the page, never printed. */
export type FamilyRef = { id: string; url: string }

/** What the host's template wraps around a body: the header, the footer's lines, and the hidden references. */
export type PageOptions = {
  logoUrl?: string; brandName?: string; tagline?: string; contactEmail?: string; footerNote?: string
  referenceId?: string; familyRef?: FamilyRef
}

/** The mail sender: one message for a tenant, recorded as the actor's act, answering the sender's message id; and the
 *  host's one template, wrapped around a body for a page the roster shows or sends whole. */
export type Mail = {
  send(tenantId: string, message: MailMessage, actor: Actor): Promise<string>
  page(body: string, opts?: PageOptions): { html: string; cidLogo?: { url: string; contentId: string } }
}

/** An item of the host's secret store as a prefix read answers it. */
export type SecretItem = { name: string; username: string; password: string; uri: string; notes: string }

/** The secret reader: a named item of the host's secret store; by prefix, each item's login. */
export type Secrets = {
  read(name: string): Promise<string>
  readOrNull(name: string): Promise<string | null>
  byPrefix(prefix: string, tags?: string[]): Promise<SecretItem[]>
}

/** The clock. */
export type Clock = { now(): Date }

/** The host's pages the roster links to or names an act by. */
export const HOST_PAGES = [
  'dashboard', 'enrollment', 'family-enrollment', 'family-edit', 'evaluations', 'teachers', 'classes', 'class',
  'google-courses', 'google-course', 'donate', 'withdraw', 'join-school-board', 'teacher-account',
] as const
export type HostPage = typeof HOST_PAGES[number]
/** The host's own routes the roster names. */
export const HOST_ROUTES = ['evaluation-pdf', 'sms-status', 'sms-inbound'] as const
export type HostRoute = typeof HOST_ROUTES[number]

/** The host's values: whether this deployment is production (the one environment code may know, and only where an act
 *  is irreversible), and each outward call run under the host's declared bound for it. */
export type HostValues = {
  production(): boolean
  /** The name of this deployment's environment, opaque: for a message, never compared. */
  environment(): string
  /** The host's page of each kind the roster links to, as a path; `id` names the record the page shows. Where the host
   *  serves its pages and how it names them are the host's. */
  page(name: HostPage, id?: string): string
  /** The host's own route of each kind the roster names (a status callback, a PDF), as a path. */
  route(name: HostRoute, id?: string): string
  /** Whether the text provider can reach this deployment's routes, so a text asks it for a delivery status callback. */
  smsCallbacks(): boolean
  bounded<T>(call: string, run: (signal: AbortSignal) => Promise<T>): Promise<T>
}

/** The school's own words the roster asks its host for, each by what it is. */
export const SCHOOL_WORDS = [
  'name', 'tagline', 'motto', 'legal-name', 'tax-id', 'calendar-name',
  // The school's legal standing as its receipts and help state it: the status a receipt names, the name of its tax id,
  // and the sentence the help says after the school's name.
  'legal-status', 'tax-id-name', 'donation-status',
  // How the school places a child in classes, as the help says it after "placed in … classes".
  'placement-basis',
  // The office that signs the enrollment mails.
  'signature',
  // What the school texts about, in the consent a parent gives; the reminder a parent who said yes is promised.
  'texting-topics', 'texting-reminder',
  // The teacher's welcome mail: its thanks ({classes}, {school} and {year} filled by the roster), and who reads the
  // replies to it ({school} filled).
  'teacher-thanks', 'replies-read-by',
  // The same mail's own sentences in the school's voice: the line before the account's purpose, the note after
  // Classroom's address rule, the ask to reply when something fails, and its closing line.
  'teacher-mail-housekeeping', 'teacher-mail-rule-note', 'teacher-mail-reply-ask', 'teacher-mail-closing',
  // The same mail's account sentences: why the address is needed, which address the roster's mail and sign-in keep
  // ({roster}, the roster's host, filled), the ask to add a phone number, the line before the help page's address, and
  // what to remember ({domain} and {school} filled).
  'teacher-mail-why-address', 'teacher-mail-sign-in-rule', 'teacher-mail-phone-ask', 'teacher-mail-help-lead',
  'teacher-mail-remember',
  // The enrollment invitation's sentences in the school's voice ({kids}, {year} and {school} filled), its ask above
  // the enroll button, and the sign-off the enrollment mails close with.
  'invitation-welcome', 'invitation-warmth', 'invitation-ask', 'mail-sign-off',
  // The enrollment reminder's sentences in the school's voice: its opening line, its welcome ({year} and {school}
  // filled), its warmth ({kids} filled) and its ask.
  'reminder-opening', 'reminder-welcome', 'reminder-warmth', 'reminder-ask',
  // The same reminder's line for a family that will not enroll, as its mail copy and its plain copy say it ({page},
  // the enrollment page, filled).
  'reminder-opt-out', 'reminder-opt-out-plain',
  // The teacher's welcome mail: what it says of the directory's rule on outside addresses in a class.
  'teacher-mail-address-rule',
  // What a tax receipt says it is, and what it states besides the school's standing, as the school's tax law asks.
  'receipt-heading', 'receipt-statement',
  // The colour the school's mails carry their headings, links and buttons in (a CSS colour).
  'colour',
  // What the school calls the receipt a donor is mailed, as the help names it.
  'receipt-name',
  // What a rehearsal is for, in its calendar invitation ({date}, the performance's, filled by the roster).
  'rehearsal-purpose',
  // The host's controls and places as the help and the answers name them to a family: the control that opens payment,
  // where the enrollment's state shows, the family's own page, and the control that corrects a record.
  'pay-button', 'enrollment-place', 'home-place', 'edit-button',
  // The family's own place as a mail's texting-preference block names it, where each person changes their own.
  'preference-place',
  // What the family context says of each kind of data it does not carry, as the host's readers are told it.
  'attendance-unavailable', 'announcements-unavailable', 'calendar-unavailable',
  // The source an opt-out from texts made at the host's own switch is stored under.
  'opt-out-source',
  // The calendar's names for the school-day, holiday and activity types, as the feed and the school calendar show them.
  'school-day-name', 'holiday-name', 'activity-name',
  // The word a family reads once enrolled, and the account a person signs in with, as the help names them.
  'enrolled-word', 'sign-in-account',
  // The teacher help on the school account: what it is for, which address to use where ({at}, {school}, {domain}),
  // and how to add it on a device (the section's title; its body, {at} and {page} filled).
  'teacher-account-purpose', 'teacher-account-use', 'teacher-account-setup-title', 'teacher-account-setup',
  // What the directory asks of a teacher at the account's first sign-in, as the teacher help says it.
  'teacher-account-first-sign-in',
  // The family help's record section: its one-line feature ({edit}, the edit control, filled) and what the family's
  // own page shows.
  'family-record-feature', 'family-record-shows',
  // The host's page where a family enrolls, as the mails and answers name it after "the", "your" or "the family's";
  // the place a payment recorded by hand is said to be recorded on.
  'enrollment-page', 'family-record-place',
  // What a rehearsal is called after its list's title.
  'rehearsal-word',
  // The reminder to a family whose enrollment is not complete, in the school's voice, as its mail copy and its plain
  // copy say it: its opening ({year} and {school} filled), the line for a family that chose no student ({kids}, {year}
  // and {page}, the enrollment page, filled), and the line for one that chose but has not paid ({kids} and {year}).
  'incomplete-opening', 'incomplete-opening-plain', 'incomplete-unselected', 'incomplete-unselected-plain',
  'incomplete-unpaid', 'incomplete-unpaid-plain',
] as const
export type SchoolWord = typeof SCHOOL_WORDS[number]

/** A day of the year, without a year: `{ month: 3, day: 15 }` is the fifteenth of March. Months count from 1. */
export type YearDay = { month: number; day: number }

/** One fee tier: the amount it adds to the base (negative for a discount), ending at the start of `endsAt` (null:
 *  the last tier, open-ended). Tiers are in order, earliest first. */
export type FeeTier = { name: string; label: string; endsAt: YearDay | null; adds: number }

/** Phone numbers in a school's country (SchoolRules.locale.phone). */
export type PhoneRules = { countryCode: string; nationalDigits: number; nationalFormat: string }

/** The school's rules the roster runs on: numbers, days, lists and words the host hands in, never constants of the
 *  roster's. Every date rule is read in the tenant's own time zone (`TenantRow.timezone`). */
export type SchoolRules = {
  fees: {
    /** The base fee for the first child, and for each child after. */
    first: number
    additional: number
    tiers: FeeTier[]
    /** Hours after a tier's end during which the earlier tier still applies. */
    graceHours: number
    /** A child who drops out on or before this day of the enrollment year does not count toward the fee. */
    dropoutCountsAfter: YearDay
    /** The card processor's rate per way a card pays. */
    cardRates: Record<CardWay, { basisPoints: number; fixedCents: number }>
    /** The ways the school takes money, in the order its words name them: the stored method code and its name. */
    ways: { method: string; name: string }[]
    /** The method whose payments carry the card processor's fee. */
    cardFeeMethod: string
    /** The card types the fee may be charged to, as the law the school is under allows; the card types its rule names
     *  as carrying none. */
    cardsCarryingFee: CardType[]
    cardsNamedFree: CardType[]
  }
  /** The currency code every amount is in. */
  currency: string
  locale: {
    /** Phone numbers: the country code, the digits of a national number (matched on the last that many digits), and
     *  how a national number prints, `#` for each digit. */
    phone: PhoneRules
    /** The locale numbers and amounts print in (a BCP 47 tag). */
    numbers: string
    /** The locale dates, times, month and weekday names print in, and names sort in (a BCP 47 tag). */
    language: string
  }
  codes: {
    /** The evaluation scale: each stored value and its label, in order. */
    evaluation: { value: string; label: string }[]
    /** The family enrollment status vocabulary (stored codes, never renumbered): each code's label, the groups the
     *  screens filter by (every code in exactly one), and the codes a year's live tracker counts. */
    enrollmentStatus: {
      labels: Record<number, string>; enrolled: number[]; pending: number[]; declined: number[]; live: number[]
      /** The codes the roster sets itself: registered (from payment), invited, and awaiting an invitation. */
      registered: number; invited: number; awaitingInvitation: number
      /** The codes a family may set its own row to. */
      familyMaySet: number[]
    }
    /** At most one automatic reply to a number in this many days. */
    autoReplyDays: number
    /** A sign-in may claim a person created in the last this many days by name. */
    intakeClaimDays: number
    /** The months evaluations are written and reviewed. */
    evaluationMonths: number[]
    /** A teacher's school address, tried in order: the local part, `{first}`, `{last}` and `{l}` (the last name's
     *  initial) filled from the name. */
    teacherAddresses: string[]
    /** The heading of the roster sheet's column for a person's id in the school's earlier system, or null when the
     *  school had none and the sheet carries no such column. */
    legacyIdColumn: string | null
    /** The school's governing body as a mail group: the group's name and its label, or null when the school offers
     *  none. Its addresses are the roster's governing-body rows. */
    governingBody: { group: string; label: string } | null
  }
  calendar: {
    /** The enrollment year starts in this month; the window is open from `windowOpens` to before `windowCloses`. */
    enrollmentYearStartsIn: number
    windowOpens: number
    windowCloses: number
    /** The school year's first day: year N runs from it in N to the day before it in N+1. */
    yearStarts: YearDay
    /** The months classes meet, in the order the calendar prints them, each with how many years after the year's start
     *  it falls (0 or 1). */
    classMonths: { month: number; yearOffset: 0 | 1 }[]
    /** The weekday classes meet, 0 = Sunday. */
    classWeekday: number
    /** Rehearsal: this many days before the event day. */
    rehearsalDaysBefore: number
    /** The event types the calendar treats specially, by their row id. */
    eventTypes: { schoolDay: number; holiday: number; activity: number }
    /** How many upcoming events, after today's, the public events feed carries. */
    feedUpcoming: number
    /** How many upcoming school days a family's dashboard read carries. */
    dashboardSchoolDays: number
  }
  courses: {
    /** The language departments, in order. */
    languages: string[]
    /** The culture department's name. */
    cultureDepartment: string
    /** The words a family reads for a child's two classes: the language class and the culture class. */
    departmentWords: { language: string; culture: string }
    /** Class periods by department kind: every language department, and the culture department. */
    periods: { language: { start: string; end: string }; culture: { start: string; end: string } }
    /** The school-wide board every family and teacher is on (its classroom carries the announcements and the
     *  rehearsals): the host's designation of it, and its name as people read it. */
    schoolBoard: { slug: string; name: string }
    /** The culture classes' code: this prefix and the grade, one class per grade. */
    cultureCodePrefix: string
    /** The last culture class, by grade: a higher grade is placed in it. */
    lastCultureGrade: number
    /** The kindergarten culture class's code, and the pattern every kindergarten class's code matches. */
    kindergartenCultureCode: string
    kindergartenCodePrefix: string
    /** The language catalog's main track (department2), the marker of a standby class, and the catalog level a standby
     *  course carries. */
    noviceTrack: number
    standbyDepartment2: number
    standbyLevel: number
    /** The catalog level a child new to a language starts at, on the novice track. */
    noviceStartLevel: number
    /** A child at or below this grade with no prior language starts on the novice track. */
    noviceUpToGrade: number
    /** Whether a family member teaching a class this session counts as the family volunteering, in the department
     *  roster's call list. */
    teachingCountsAsVolunteering: boolean
    /** First grade: the age a child starts, and the birth month from which a family may choose the next year. */
    firstGradeAge: number
    firstGradeCutoffMonth: number
    /** The youngest age a first-grade year a person's record names may be: an earlier year is refused as a mistake. */
    earliestFirstGradeAge: number
    /** Grades: the first grade the school enrolls (0 is the year before first grade, -1 the year before that) and the
     *  last numbered grade, and the words for the year before first grade, the years before that, and a child past the
     *  last grade; how a numbered grade prints in a sheet's grade column (the prefix before the number); the word before
     *  the year a school year starts in, naming when a grade applies ("Term" in "grade 1 in Term <year>"). */
    grades: { enrollsFrom: number; last: number; kindergarten: string; beforeKindergarten: string; past: string; sheetPrefix: string; startWord: string }
  }
}

/** A tenant as the roster reads it. */
export type TenantRow = { id: string; slug: string; timezone: string; longName: string }

/** The values a tenant brings for the roster, for this environment where the host binds one to an environment: the lead teacher's
 *  address, the directory's domain, the roster's own public address, the school's website, the payment page's QR
 *  image, and the name the bank shows as the payee. The host maps each to wherever it keeps it. */
export const TENANT_VALUES = [
  'lead-teacher-email', 'workspace-domain', 'roster-address', 'website', 'paypal-qr-url', 'zelle-payee-name',
] as const
export type TenantValue = typeof TENANT_VALUES[number]

/** The texts a tenant keeps for the roster: the address admissions mail comes from and is answered at, the address a
 *  receipt names to write to, the school calendar's id once the roster made it, and the one automatic text reply. */
export const TENANT_TEXTS = ['admissions-contact', 'receipts-contact', 'school-calendar-google-id', 'sms-auto-reply'] as const
export type TenantText = typeof TENANT_TEXTS[number]

/** The tenant's role accounts the roster acts as or names: the one money mail is answered at and the bank's alerts
 *  reach, and the one the directory is administered as. The host maps each to its own role. */
export const ROLE_ACCOUNTS = ['bursar', 'directory-admin'] as const
export type RoleAccount = typeof ROLE_ACCOUNTS[number]

/** The tenant's configuration: its row, the values it brought, its texts by key and its role accounts. A value the
 *  tenant has not brought in this environment is refused by name, never filled. */
export type TenantConfiguration = {
  byId(id: string): Promise<TenantRow | null>
  bySlug(slug: string): Promise<TenantRow | null>
  /** A value the tenant brought, for this environment where the host binds it to one. */
  dowry(tenantId: string, key: TenantValue): Promise<string>
  /** A text by key; `textOrNull` answers null where the tenant holds none. */
  text(tenantId: string, key: TenantText): Promise<string>
  textOrNull(tenantId: string, key: TenantText): Promise<string | null>
  /** One of the school's own words the roster puts in what it sends — its name, its tagline, its legal name, its tax
   *  id, its calendar's name (SCHOOL_WORDS) — as the host holds it for the tenant; refused by name where it holds none. */
  schoolWord(tenantId: string, key: SchoolWord): Promise<string>
  /** The school's rules (SchoolRules) as the host holds them for the tenant; refused by name where it holds none. */
  rules(tenantId: string): Promise<SchoolRules>
  setText(tenantId: string, key: TenantText, value: string): Promise<void>
  /** The mailbox of the tenant's role account; refused when absent or a person's own mailbox. */
  role(tenantId: string, account: RoleAccount): Promise<string>
  /** The given roles the tenant offers: a given role counts in a tenant only where the host offers it there. */
  offeredRoles(tenantId: string): Promise<string[]>
  /** Whether the roster runs for the tenant (the host has it switched on there). */
  rosterOn(tenantId: string): Promise<boolean>
  /** The tenant's logo as a file a document can embed, or null when the host holds none as a file. */
  logoFile(tenantId: string): Promise<string | null>
}

/** Whose own resource the act is made on, and how their consent stands. */
export type Consent =
  | { by: 'self'; whose: string }                     // the person approving owns the resource — the call rings their own phone
  | { by: 'owner-of-resource'; whose: string }        // made as the vendor-named owner; the host names the agreement
  | { by: 'texting-consent'; whose: string; row: string }      // a text the school starts: the person's live consent row
  | { by: 'implied'; whose: string }                          // the one reply to a text they sent (implied consent)

/** An act that leaves the system (a mail, a call, a calendar entry, a payment), as the host records it. */
export type OutwardActSpec = {
  tenantId: string | null
  /** The roster's kind of act; the host maps it to its stored kinds and refuses one it does not know. */
  kind: string
  actor: Actor
  /** The identity the act went out under. */
  role: string | null
  /** Whom or what it reaches. */
  destination: string
  /** `real` when the vendor is reached; `stand-in` when the program stood in for it (off production). */
  delivery: 'real' | 'stand-in'
  consent?: Consent | null
}

/** What the host's `outwardAct` throws, before anything is recorded or sent, for an act a person approves while viewing
 *  as someone else. The host may throw a subclass, in its own words. */
export class ViewAsRefused extends Error {
  constructor(public readonly viewedAs: string, message: string) {
    super(message)
    this.name = 'ViewAsRefused'
  }
}

/** Anything that inserts in the roster's store, or a transaction of it, as a record id's birth writes through it. */
export type Inserter = { insert: (...args: never[]) => unknown }
/** Anything that deletes in the roster's store, or a transaction of it, as a record id's removal writes through it. */
export type Remover = { delete: (...args: never[]) => unknown }
/** Anything that updates in the roster's store, or a transaction of it. */
export type Updater = { update: (...args: never[]) => unknown }

/** A course of the host's Classroom mirror, as the roster shows it beside a class. */
export type MirrorCourse = {
  id: string; name: string; section: string | null; alternateLink: string | null; enrollmentCode: string | null
  meet: string | null; room: string | null
}

/** A new course Google made, as the host's mirror keeps it. */
export type KeptCourse = {
  id: string; tenantId: string; name: string; subject: string | null; section: string | null; room: string | null
  courseState: string | null; enrollmentCode: string | null; ownerId: string | null; teacherGroupEmail: string | null
  courseGroupEmail: string | null; calendarId: string | null; alternateLink: string | null; creationTime: Date | null
  updateTime: Date | null; rawJson: unknown; syncedAt: Date
}

/** The host's mirror of the Classroom the roster's classes meet in, with the roster's verbs. */
export type ClassroomMirror = {
  courses(ids: string[]): Promise<MirrorCourse[]>
  /** The members of the tenant's courses whose room claims the session `label` (room = {session}). */
  sessionMembers(tenantId: string, label: string): Promise<{ rowKey: string; courseId: string; role: string; email: string | null }[]>
  courseMembers(tenantId: string, courseId: string): Promise<{ emailAddress: string | null; fullName: string | null }[]>
  /** The tenant's Classroom users with these addresses, lower-cased and trimmed. */
  usersByEmails(tenantId: string, emails: string[]): Promise<{ email: string | null; photoUrl: string | null }[]>
  /** Every member of every course the tenant's mirror holds, and when the mirror last read them from Google. */
  tenantMembers(tenantId: string): Promise<{ courseId: string; role: 'Teacher' | 'Student'; email: string | null; name: string | null }[]>
  lastSynced(tenantId: string): Promise<string | null>
  /** Each of the tenant's courses with its Meet link. */
  courseMeets(tenantId: string): Promise<{ id: string; meet: string | null }[]>
  /** The tenant's boards, by name, each with whether its course is in the mirror. */
  boards(tenantId: string): Promise<{ boardId: string; name: string; googleCourseId: string | null; inSnapshot: boolean }[]>
  /** A course's Google calendar and its owner's address, as the mirror holds them. */
  calendarOf(tenantId: string, courseId: string): Promise<{ calendarId: string | null; ownerEmail: string | null } | null>
  board(tenantId: string, slug: string): Promise<{ id: string; name: string; googleCourseId: string | null } | null>
  /** Of these course ids, those a board designated `slug` names. */
  boardCourseIds(slug: string, courseIds: string[]): Promise<string[]>
  keep(tx: Inserter, course: KeptCourse): Promise<void>
  unlinkClass(tx: Updater, tenantId: string, classId: string): Promise<void>
  /** The classrooms' postings a principal has not deleted that the filter admits, newest first; days in `zone`. */
  postings(tenantId: string, filter: NewsletterFilter, zone: string): Promise<Posting[]>
  /** Whether the tenant holds any posting at all. */
  hasPostings(tenantId: string): Promise<boolean>
}

/** A classroom posting as the host's mirror holds it. */
export type Posting = {
  id: string; courseId: string; kind: string; googleCreatedAt: Date | null; courseName: string | null
  courseSection: string | null; courseState: string | null; workType: string | null; goneFromClassroomAt: Date | null
  title: string | null; text: string | null; creatorName: string | null; creatorEmail: string | null
  creatorUserId: string | null; authorRole: string | null; materials: unknown; alternateLink: string | null
  authorPersonId: string | null
}

/** One field's change on a record, as its history shows it. */
export type RecordChange = { id: string; changedAt: Date; field: string; oldValue: unknown; newValue: unknown; changedByName: string | null }

/** The host's records the roster writes through the host: an outward act around the call that makes it, and the
 *  registry id a new record is born under, issued inside the transaction that inserts the record. */
export type HostRecords = {
  outwardAct<T>(spec: OutwardActSpec, run: () => Promise<{ value: T; vendorRef?: string | null }>): Promise<T>
  /** A new record id of the roster's `kind` in the tenant, written through `tx`; the host refuses a kind it does not know. */
  birthId(tx: Inserter, kind: string, tenantId: string): Promise<string>
  /** The host's user behind a verified address, with the name an act records; null when the host holds none. */
  userByAddress(email: string): Promise<{ id: string; name: string | null } | null>
  /** The roles a user picked to act with in a tenant, or null when none is picked. */
  pickedRoles(userId: string, tenantId: string): Promise<string[] | null>
  /** Remove the registry ids of records just removed, through `tx`; within `tenantId` when one is named. */
  dropIds(tx: Remover, ids: string[], tenantId?: string): Promise<void>
  /** Keep a record's changed fields — field → [old, new] — under the user who changed them. */
  logChanges(recordId: string, changedBy: string | null, changes: Record<string, [unknown, unknown]>): Promise<void>
  /** A record's field history, newest first. */
  changes(recordId: string, limit: number): Promise<RecordChange[]>
  /** The host's users with these ids: name and sign-in address. */
  usersByIds(ids: string[]): Promise<{ id: string; name: string | null; email: string | null }[]>
}

/** Google, as the host reaches it (Classroom, the calendar, a mailbox read): a client under the host's transport. */
export type GoogleClients = {
  jwt(opts: JWTOptions): JWT
  auth(opts: GoogleAuthOptions): GoogleAuth
  /** The school's Google service-account key, as JSON: the host reads it from wherever it keeps its credentials. */
  serviceAccountKey(): Promise<string>
}

/** A money movement the roster books: under the registry id it was born with, to the tenant's account for its way of
 *  paying (or none), in or out, of a kind, on a day, naming the provider's reference. */
export type LedgerEntry = {
  id: string; tenantId: string; bankAccountId: string | null; amount: string; direction: 'in' | 'out'; type: string
  paidAt?: string | null; referenceId?: string | null; notes?: string | null; recordedBy?: string | null
}

/** The ledger, with the roster's verbs. Each write goes through the roster's own transaction. */
export type Ledger = {
  /** The tenant's account for a way of paying ('paypal', 'zelle'); null when it has none. */
  accountFor(tenantId: string, method: string): Promise<string | null>
  book(tx: Inserter, entry: LedgerEntry): Promise<string>
  setReference(tx: Updater, tenantId: string, id: string, referenceId: string | null): Promise<void>
  /** Remove an entry; within `tenantId` when one is named. Its registry id is removed after, by the caller. */
  remove(tx: Remover, id: string, tenantId?: string): Promise<void>
  /** Entries by id: the amount and the day the money moved. */
  entries(ids: string[]): Promise<{ id: string; amount: string; paidAt: string | null }[]>
}

export type Ports = {
  /** The database pool the roster's tables live in, under the roster's own login. */
  pool: Pool
  listen: Listen
  identity: Identity
  phone: Phone
  payments: Payments
  ledger: Ledger
  classroom: ClassroomMirror
  paymentNotices: PaymentNotices
  deposits: Deposits
  mail: Mail
  secrets: Secrets
  clock: Clock
  host: HostValues
  tenants: TenantConfiguration
  records: HostRecords
  google: GoogleClients
}

// Held process-wide, not in this module: a host whose build bundles this file more than once still has one set of
// ports.
const HELD = Symbol.for('roster.ports')
const held = globalThis as { [HELD]?: Ports }

/** The ports the host handed in; the roster reads them on every call, never at import. */
export function ports(): Ports {
  const current = held[HELD]
  if (!current) throw new Error('the roster has no ports: the host fills them (start(ports), or usePorts in its own process)')
  return current
}

/** Set the ports: `start` does, a host running the roster's code in its own process does, and a test does with its
 *  fakes. */
export function usePorts(p: Ports): void {
  held[HELD] = p
}
