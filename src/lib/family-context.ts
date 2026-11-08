// Family context for a CHATBOT calling the door.
//
// This is the DE-IDENTIFIED sibling of the family's own schedule read. Same family, same
// authorization, deliberately different shape:
//
//   The family's schedule read — labels each student BY NAME, for the family reading it.
//   THIS payload    — carries NO name, date of birth or age. It goes into a language
//                     model's prompt context, and a model repeats its context on demand.
//
// The rule: this carries what the family may read, minus the personal data (names, dates of
// birth). Structural, not remembered: the caller cannot leak what it never receives. Do NOT
// "align" this with the schedule read — the divergence is the point.
//
// Students are keyed by their person UUID — stable, opaque, carries no personal data. It
// exists only so two students' rows cannot merge into one another; the parent knows which
// child is which.
//
// WHAT A FAMILY MAY SEE IS NOT DECIDED HERE. Every field below is already on a surface the
// family can read while signed in to roster:
//   - classes            → the family's classes and their times
//   - enrollment + fees  → the family's enrollment history (year, status, date, tuition)
//   - evaluations        → the family's evaluations (SUBMITTED only; never internal_notes,
//                          responses or teacher_comment_code, which a family never reads)
//
// Bounded by construction so it fits in a prompt beside the site text: current school year
// for classes/fees, EVAL_YEARS most recent years for evaluations.

import { db } from './db'
import {
  familyEnrollments, cashEnrollmentPayments, rosterFamilyTracker,
  rosterEvaluations, rosterAvailableClasses, rosterCourseCatalog, persons,
  PAYMENT_CHARACTER_TUITION,
} from '../tables'
import { eq, and, isNull, isNotNull, inArray, desc, sum } from 'drizzle-orm'
import { schoolYearLabel } from './enrollment'
import { getFamilySchedule } from './roster-classes'
import { enrollmentStatusLabel } from './roster-enrollment-status'
import { tenantRules } from './rules-context'
import { byCode } from './zoned'
import { moneyIn, moneyRules, type MoneyRules } from './fees'
import { type HelpSection } from './help'
import { type FamilyMap } from './family-map-context'
import { hostRoute } from './host'
import { unavailableWords } from './school-words'

// How many school years of evaluations ride along: the most recent two, so a long-tenured family's context stays
// small enough for a reader with a bounded window.
export const EVAL_YEARS = 2

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

// Always two decimals, in the school's currency and number locale. A chatbot must be able to quote the figure
// VERBATIM — an amount with its currency and cents cannot be misread the way a bare 150 can.
export function money(n: number, m: MoneyRules): string {
  return moneyIn(m, n)
}

// ---------------------------------------------------------------------------
// Fees
// ---------------------------------------------------------------------------
//
// ═══════════════════════════════════════════════════════════════════════════
// FEE-DEFINITION — THE canonical definition of a school family fee.
//
// FEE === incoming cash with the character of tuition.
//
// A fee is MONEY THAT ARRIVED. It is not an amount owed: reporting what a family paid
// needs no owed side, and a bill, if one is wanted, is its own object, not a field of this one.
//
// A payment carries exactly four things, and this section reads all four:
//
//   R1  family    — payment -> enrollment -> family. The family is the unit.
//   R2  session   — the enrollment year. `year` here IS the session.
//   R3  amount    — the booked amount.
//   R4  character — WHAT THE MONEY WAS FOR. Stored on the payment by the booking path,
//                   never derived: whoever books money says what it is for.
//                   An open attribute, not an enum and not a
//                   catalog FK — the set of characters may grow or not, and nothing
//                   depends on it.
//   R5  fee       = the sum of R3 over character = tuition, for this family, this session.
//                   Nothing else is a fee.
//
// A family that paid nothing is reported with fee 0.00 and `unpaid: true` — NOT omitted.
// A family that did not pay must be visible as such. Zero is honest here because
// booked cash is the whole record, on the stated assumption that all money from
// families is booked in the roster.
//
// Every fee decision in the roster is marked FEE-RULE.
// ═══════════════════════════════════════════════════════════════════════════

// One character of cash received. `character` is free text on purpose (FEE-RULE R4).
export type Receipt = { character: string; amount: number; display: string }

export type Fees = {
  year: number
  schoolYear: string
  status: string | null
  registrationDate: string | null
  fee: number             // FEE-RULE R5 — tuition cash received, this family, this session
  unpaid: boolean         // fee === 0, stated outright so it is never read as "no data"
  received: Receipt[]     // every character of cash received, tuition included
  display: { fee: string }
}

export function buildFees(input: {
  year: number
  status: string | null
  registrationDate: string | null
  received: { character: string; amount: number }[]
  money: MoneyRules
}): Fees {
  const received = input.received
    .map(r => ({ character: r.character, amount: r.amount, display: money(r.amount, input.money) }))
    .sort((a, b) => byCode(a.character, b.character))

  // FEE-RULE R5: the fee is tuition cash and nothing else. Any other character rides along
  // in `received` but never lands in `fee`.
  const fee = received
    .filter(r => r.character === PAYMENT_CHARACTER_TUITION)
    .reduce((total, r) => total + r.amount, 0)

  return {
    year: input.year,
    schoolYear: schoolYearLabel(input.year),
    status: input.status,
    registrationDate: input.registrationDate,
    fee,
    unpaid: fee === 0,
    received,
    display: { fee: money(fee, input.money) },
  }
}

export async function getFamilyFees(tenantId: string, familyId: string, year: number): Promise<Fees | null> {
  const [received, [enrollment], [tracker]] = await Promise.all([
    // FEE-RULE R1 + R2 + R3 + R4 in one query: cash booked to THIS family for THIS session,
    // totalled per character. The join is the family link — a payment reaches a family only
    // through its enrollment.
    db.select({
      character: cashEnrollmentPayments.character,
      total:     sum(cashEnrollmentPayments.amount),
    })
      .from(cashEnrollmentPayments)
      .innerJoin(familyEnrollments, eq(familyEnrollments.id, cashEnrollmentPayments.enrollmentId))
      .where(and(
        eq(cashEnrollmentPayments.tenantId, tenantId),
        eq(familyEnrollments.familyId, familyId),
        eq(familyEnrollments.year, year),
      ))
      .groupBy(cashEnrollmentPayments.character),

    db.select({ status: familyEnrollments.status })
      .from(familyEnrollments)
      .where(and(
        eq(familyEnrollments.tenantId, tenantId),
        eq(familyEnrollments.familyId, familyId),
        eq(familyEnrollments.year, year),
      ))
      .limit(1),

    db.select({
      status: rosterFamilyTracker.enrollmentStatus,
      registrationDate: rosterFamilyTracker.registrationDate,
    })
      .from(rosterFamilyTracker)
      .where(and(
        eq(rosterFamilyTracker.tenantId, tenantId),
        eq(rosterFamilyTracker.familyId, familyId),
        eq(rosterFamilyTracker.year, year),
      ))
      .limit(1),
  ])

  // Roster has never heard of this family for this session — say nothing rather than
  // report nothing paid for a session the family was not part of.
  if (!enrollment && !tracker) return null

  const rules = await tenantRules(tenantId)
  const trackerStatus = tracker?.status == null ? null : enrollmentStatusLabel(rules.codes, tracker.status)

  return buildFees({
    year,
    status: enrollment?.status ?? trackerStatus,
    registrationDate: tracker?.registrationDate ?? null,
    received: received.map(r => ({ character: r.character, amount: Number(r.total ?? 0) })),
    money: moneyRules(rules),
  })
}

// ---------------------------------------------------------------------------
// Evaluations
// ---------------------------------------------------------------------------
//
// What a family reads of its evaluations: students of this family, SUBMITTED evaluations
// only. `responses`, `internal_notes` and `teacher_comment_code` are staff-facing and are
// not read here.
//
// reportUrl is the host's evaluation-pdf route, which requires a signed-in session and
// re-checks family membership itself: a link, not an open document.

export type FamilyEvaluation = {
  studentKey: string
  year: number
  schoolYear: string
  classShortCode: string | null
  classFullName: string | null
  submittedAt: string | null
  reportUrl: string
}

export async function getFamilyEvaluations(
  tenantId: string,
  studentIds: string[],
  year: number,
): Promise<FamilyEvaluation[]> {
  if (studentIds.length === 0) return []

  const rows = await db
    .select({
      id: rosterEvaluations.id,
      studentId: rosterEvaluations.studentId,
      year: rosterEvaluations.year,
      shortCode: rosterCourseCatalog.shortCode,
      fullName: rosterCourseCatalog.fullName,
      submittedAt: rosterEvaluations.submittedAt,
    })
    .from(rosterEvaluations)
    .leftJoin(rosterAvailableClasses, eq(rosterAvailableClasses.id, rosterEvaluations.classId))
    .leftJoin(rosterCourseCatalog, eq(rosterCourseCatalog.id, rosterAvailableClasses.courseId))
    .where(and(
      eq(rosterEvaluations.tenantId, tenantId),
      inArray(rosterEvaluations.studentId, studentIds),
      isNotNull(rosterEvaluations.submittedAt),
    ))
    .orderBy(desc(rosterEvaluations.year))

  // Bounded to the EVAL_YEARS most recent school years present, so a long-tenured family
  // does not crowd the prompt.
  const keptYears = [...new Set(rows.map(r => r.year))].sort((a, b) => b - a).slice(0, EVAL_YEARS)

  return rows
    .filter(r => keptYears.includes(r.year) && r.year <= year)
    .map(r => ({
      studentKey: r.studentId,
      year: r.year,
      schoolYear: schoolYearLabel(r.year),
      classShortCode: r.shortCode ?? null,
      classFullName: r.fullName ?? null,
      submittedAt: r.submittedAt ? r.submittedAt.toISOString() : null,
      reportUrl: hostRoute('evaluation-pdf', r.id),
    }))
}

// ---------------------------------------------------------------------------
// De-identification — enforced, not promised
// ---------------------------------------------------------------------------
//
// A comment saying "no names in here" does not survive the next person adding a field.
// This walks the assembled payload and throws if a forbidden key appears anywhere in it,
// so the invariant fails the request (and the test suite) rather than leaking quietly.

const FORBIDDEN_KEYS = [
  'name', 'firstname', 'lastname', 'fullname', 'displayname', 'studentname',
  'email', 'phone', 'mobile',
  'dob', 'dateofbirth', 'birthdate', 'birthday', 'age',
  // 'addr' covers addr1/addr2 — the normalizer strips digits before comparing.
  'addr', 'address', 'street', 'city', 'state', 'zip',
]

// The match refuses a key equal to or ENDING in a forbidden word, so `studentEmail` or
// `parentName` is refused too. The allowed paths:
// - `fullName` on a CLASS, and `className` on a MAP ROW, are course titles, not people.
// - `personName` on a MAP ROW: the map tells a family which of its people is not yet in a
//   classroom, and a row that says only "someone" is not an answer a parent can act on. The
//   reader is the family itself, signed in, and the same rows reach that family by mail;
//   what stays out is the address.
// - `noAddress` is a list of PEOPLE the roster holds no address for — the absence of one.
const ALLOWED_PATHS = ['classFullName', 'classes[].fullName', 'className', 'personName', 'noAddress']

export function assertDeIdentified(payload: unknown, path = '$'): void {
  if (Array.isArray(payload)) {
    payload.forEach((v, i) => assertDeIdentified(v, `${path}[${i}]`))
    return
  }
  if (payload === null || typeof payload !== 'object') return

  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    const normalized = key.toLowerCase().replace(/[^a-z]/g, '')
    const isAllowed = ALLOWED_PATHS.some(p => p.endsWith(key))
    const forbidden = FORBIDDEN_KEYS.some(f => normalized === f || normalized.endsWith(f))
    if (!isAllowed && forbidden) {
      throw new Error(
        `family-context: personal field "${key}" at ${path} — this payload goes ` +
        `into a model prompt and must carry no names, contact details, dates of birth or ages.`
      )
    }
    assertDeIdentified(value, `${path}.${key}`)
  }
}

// ---------------------------------------------------------------------------
// The assembled payload
// ---------------------------------------------------------------------------

export type FamilyContext = {
  familyId: string | null
  year: number
  schoolYear: string
  asOf: string              // when this snapshot was taken
  students: {
    key: string
    classes: {
      shortCode: string | null
      fullName: string | null
      section: string | null
      startTime: string | null
      endTime: string | null
      joinUrl: string | null
    }[]
  }[]
  fees: Fees | null
  evaluations: FamilyEvaluation[]
  // The school's own help text (./help), so a reader can answer "how does placement work",
  // "what is an evaluation", "my account is not linked". It is about the school, never about
  // this family, which is why it survives assertDeIdentified unchanged.
  help: HelpSection[]
  // The family's own view of the family map — which classroom each of their people is
  // expected in and whether Google already has them there (./family-map-context).
  // This is the answer to "how do I get into my classroom" for THIS family rather than in
  // general: the help text says what to do, the map says whether they still need to do it.
  // null when the map's run was refused at its data gate — nothing is invented in its place.
  map: FamilyMap | null
  // Placeholders, always empty: they hold the shape open so a source, once one exists, fills
  // in without a contract change. `unavailable` says WHY each is empty, in the host's words
  // (schoolWords 'attendance-unavailable', 'announcements-unavailable', 'calendar-unavailable'),
  // so an empty array is never mistaken for "this family has none".
  attendance: never[]
  announcements: never[]
  calendar: never[]
  unavailable: Unavailable
}

/** Why each placeholder is empty, as the host words it (school-words.ts unavailableWords). */
export type Unavailable = Record<'attendance' | 'announcements' | 'calendar', string>

// The no-family answer (a signed-in non-member — the intake signal). Same shape as a real
// one, including the placeholders, so a caller never writes a second parser.
// `help` rides along: the person asking is signed in and NOT on any family, which is who
// needs the "if your account is not linked" paragraph.
export function emptyFamilyContext(year: number, now: Date, unavailable: Unavailable, help: HelpSection[] = []): FamilyContext {
  return {
    familyId: null,
    year,
    schoolYear: schoolYearLabel(year),
    asOf: now.toISOString(),
    students: [],
    fees: null,
    evaluations: [],
    help,
    // No family, so no map — there is nothing to be all-set about.
    map: null,
    attendance: [],
    announcements: [],
    calendar: [],
    unavailable: { ...unavailable },
  }
}

// The class's join link: its Meet code, else its Classroom course.
function joinUrl(meet: string | null, classroomCourseId: string | null): string | null {
  if (meet) return `https://meet.google.com/${meet}`
  if (classroomCourseId) return `https://classroom.google.com/c/${classroomCourseId}`
  return null
}

export async function getFamilyContext(
  tenantId: string,
  familyId: string,
  year: number,
  now: Date,
  help: HelpSection[] = [],
  map: FamilyMap | null = null,
): Promise<FamilyContext> {
  const schedule = await getFamilySchedule(tenantId, familyId, year)

  // EVERY member of the family — no role filter: the family is the unit. An evaluation row
  // only ever exists for a child, so a role filter could exclude a real evaluation but never
  // include a wrong one.
  const members = await db
    .select({ id: persons.id })
    .from(persons)
    .where(and(
      eq(persons.familyId, familyId),
      eq(persons.tenantId, tenantId),
      isNull(persons.deletedAt),
    ))

  const [fees, evaluations] = await Promise.all([
    getFamilyFees(tenantId, familyId, year),
    getFamilyEvaluations(tenantId, members.map(m => m.id), year),
  ])

  const payload: FamilyContext = {
    familyId,
    year,
    schoolYear: schoolYearLabel(year),
    asOf: now.toISOString(),
    students: schedule.map(s => ({
      key: s.personId,      // opaque, stable — NOT s.name, which this payload never carries
      classes: s.classes.map(c => ({
        shortCode: c.shortCode,
        fullName:  c.fullName,
        section:   c.section,
        startTime: c.startTime,
        endTime:   c.endTime,
        joinUrl:   joinUrl(c.meet, c.classroomCourseId),
      })),
    })),
    fees,
    evaluations,
    help,
    map,
    attendance: [],
    announcements: [],
    calendar: [],
    unavailable: await unavailableWords(tenantId),
  }

  assertDeIdentified(payload)
  return payload
}
