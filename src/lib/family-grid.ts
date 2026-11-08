/**
 * The family's Google Classroom grid, as it goes into an email.
 *
 * Every email about classroom joining carries this grid and an enumeration of the problems. The
 * layout: the first column is the family member's name, followed by three columns — the school's
 * board, the language class and the culture class. Each box is blank, good standing or join; the name box
 * is highlighted when the email is missing or collides. A short enumeration follows, at the bottom
 * of the email; on top goes a less verbose version for humans.
 *
 * So every joining email is: a short human paragraph on top (the caller's), and this block at the
 * bottom — the grid, then the numbered problems or "All good".
 *
 * Pure: the builder (family-classes-build.ts) hands in the card already resolved to names,
 * columns and links; this file renders.
 */
import { longDayWords } from './zoned'

export type GridColumn = 'board' | 'language' | 'culture'

export type GridCell = {
  /** 'good' — roster and Google agree. 'join' — expected in the classroom, not in it yet. */
  state: 'good' | 'join'
  className: string
  email: string
  joinUrl: string | null
  code: string | null
  /** For a joined cell: the Google Classroom and its Meet — the class, when joined, links to the
      classroom, with a Meet icon beside it. */
  classroomUrl?: string | null
  meetUrl?: string | null
  /** The Google course id, which names the course to the host's course page (HostPage 'google-course'). */
  courseId?: string
}

/** The box's words for a class — its short code. */
export function cellLabel(c: GridCell): string {
  return c.className
}

export type GridMember = {
  name: string
  /** The address is missing, or shared with another member — the name box is highlighted. */
  flag: 'no-email' | 'collision' | null
  cells: Record<GridColumn, GridCell[]>
}

export type FamilyGrid = {
  familyName: string
  members: GridMember[]
  /** Two or more members on one address; `lender` is whose address it is, as the child's record says. */
  collisions: { name: string; email: string; lender: 'Father' | 'Mother' | null }[]
  /** An address Google holds in a family classroom that the roster places nobody on. */
  unexpected: { className: string; email: string }[]
  /** Every address the map holds for the family: a joining email goes to all of them. */
  recipients: string[]
  /** First names of the people who own the recipient addresses, for "Dear Ann, Ben," — the
      greeting names only people on the To line. */
  greetingNames: { first: string; last: string | null }[]
  /** The roster's address in this environment — where the family signs in. Null on a screen, which is
      already inside the roster; emails carry it. */
  rosterUrl: string | null
  /** The school's name, as its host words it. */
  schoolName: string
  /** The school-wide board's name (SchoolRules.courses.schoolBoard), the first column's head. */
  boardName: string
  /** The words for a child's language class and culture class (SchoolRules.courses.departmentWords), the other heads. */
  departmentWords: { language: string; culture: string }
  /** The school's language (SchoolRules.locale.language): the start day is written in it. */
  language: string
  /** The colour the school's mails carry their heads and links in (its 'colour' word). */
  colour: string
  /** "YYYY–YY", from schoolYearLabel(). */
  schoolYear: string
  /** The first school day of the year from the roster calendar, YYYY-MM-DD; null when the calendar has none. */
  schoolStart: string | null
  /** Today in the tenant's timezone, YYYY-MM-DD — decides "starts" against "has already started". */
  today: string
}

const KEYS: GridColumn[] = ['board', 'language', 'culture']

/** The grid's columns: the school's board, then the language and culture classes. */
function columns(g: Pick<FamilyGrid, 'boardName' | 'departmentWords'>): { key: GridColumn; label: string }[] {
  return [{ key: 'board', label: g.boardName }, { key: 'language', label: g.departmentWords.language }, { key: 'culture', label: g.departmentWords.culture }]
}

/**
 * The opening every joining email starts with: a welcome to the school year; before the first
 * school day "The school starts <start date>", after it "The school has already started"; then
 * either "Congratulations, you are fully set up" or "We have <n> action items for your Google
 * Classroom setup". The school's name is the grid's (`schoolName`, the host's name word for the tenant).
 */
export function gridOpening(g: FamilyGrid): string[] {
  const n = gridProblems(g).length
  const lines = [`Welcome to ${g.schoolName} ${g.schoolYear}.`]
  if (g.schoolStart) lines.push(g.today < g.schoolStart ? `The school starts ${longDayWords(g.schoolStart, g.language)}.` : 'The school has already started.')
  lines.push(n === 0
    ? 'Congratulations, you are fully set up.'
    : `We have ${n} action item${n === 1 ? '' : 's'} for your Google Classroom setup.`)
  return lines
}

/** The opening as one HTML paragraph. */
export function gridOpeningHtml(g: FamilyGrid): string {
  return `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#1f2937;">${gridOpening(g).map(esc).join(' ')}</p>`
}

/**
 * The one line between the opening and the grid: a family with a missing address adds it after
 * signing in and joins from there, so the line gives the roster's link and claims nothing about
 * what the family sees there.
 */
export function gridRosterLine(g: FamilyGrid): { text: string; html: string } {
  if (!g.rosterUrl) return { text: '', html: '' }
  const host = g.rosterUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')
  return {
    text: `Sign in at ${g.rosterUrl} to add addresses and join your classrooms.`,
    html: `Sign in at <a href="${g.rosterUrl}" style="color:${g.colour};">${esc(host)}</a> to add addresses and join your classrooms.`,
  }
}

/**
 * The account check before joining: before joining a classroom, make sure the correct
 * address is signed in, by looking at the top right of the classroom screen. Google joins whichever account is signed in, so a family member on the wrong
 * one lands in the class as somebody else. Said only when the grid has something to join.
 */
export function gridAccountCheck(g: FamilyGrid): string {
  const anyJoin = g.members.some(m => Object.values(m.cells).some(cells => cells.some(c => c.state === 'join')))
  return anyJoin
    ? 'Before you join a classroom, check the account shown at the top right of Google Classroom — it must be the address listed for you below.'
    : ''
}

/**
 * The greeting: the people on the To line, first names with one or two last names, more
 * personal than "Dear Parents". One shared last name is said once — "Dear Ann and Bob Example,";
 * different ones each go with their own first name — "Dear Ann Example and Bob Sample,".
 */
export function gridGreeting(g: FamilyGrid): string {
  const people = g.greetingNames
  if (people.length === 0) return 'Dear family,'
  const lasts = [...new Set(people.map(p => p.last).filter(Boolean))]
  if (lasts.length <= 1) return `Dear ${andList(people.map(p => p.first))}${lasts[0] ? ` ${lasts[0]}` : ''},`
  return `Dear ${andList(people.map(p => (p.last ? `${p.first} ${p.last}` : p.first)))},`
}

/** The subject is a label, not a sentence. */
export function gridSubject(g: FamilyGrid): string {
  return `Classroom setup — ${g.schoolYear}`
}

/** True when nothing in the grid needs doing. */
export function gridAllGood(g: FamilyGrid): boolean {
  return gridProblems(g).length === 0
}

/** "A", "A and B", "A, B and C". */
function andList(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}

/**
 * What the FAMILY has to do: how many items it has left, none meaning all set. Every item of the
 * enumeration except someone in a classroom the roster does not place them in: removing them is an
 * administrative task, not the family's. Something to do is a class to join; someone in an additional class is a
 * different problem and does not count towards it.
 */
export function gridToDoCount(g: FamilyGrid): number {
  return gridProblems(g).length - g.unexpected.length
}

/** The short enumeration, one line per problem. */
export function gridProblems(g: FamilyGrid): string[] {
  const out: string[] = []
  for (const m of g.members.filter(m => m.flag === 'no-email')) out.push(`${m.name}: no email address`)
  const byAddress = new Map<string, string[]>()
  for (const c of g.collisions) byAddress.set(c.email, [...(byAddress.get(c.email) ?? []), c.name])
  // "Ann and Bob need separate email addresses." — the address they share is
  // in the tooltip on their names, not in the line.
  for (const names of byAddress.values()) out.push(`${andList(names)} need separate email addresses.`)
  for (const m of g.members) {
    for (const key of KEYS) {
      for (const c of m.cells[key].filter(c => c.state === 'join')) {
        out.push(`${m.name}: join ${cellLabel(c)}${c.code ? `, code ${c.code}` : ''}`)
      }
    }
  }
  for (const u of g.unexpected) out.push(`${u.email}: in ${u.className}, not on the roster`)
  return out
}

/** The problems as they are LISTED: one line per person, their joins joined with "; " — one line for
 *  one person, since there is horizontal space. gridProblems stays one entry per join, so every
 *  count built on it is unchanged. */
export function gridProblemLines(g: FamilyGrid): string[] {
  const out: string[] = []
  for (const m of g.members.filter(m => m.flag === 'no-email')) out.push(`${m.name}: no email address`)
  const byAddress = new Map<string, string[]>()
  for (const c of g.collisions) byAddress.set(c.email, [...(byAddress.get(c.email) ?? []), c.name])
  for (const names of byAddress.values()) out.push(`${andList(names)} need separate email addresses.`)
  for (const m of g.members) {
    // "join code" said once, each code beside its class: "Child: join code: X1 X2:
    // abcd1234; X3: efgh5678". A class with no code shows a dash.
    const joins = KEYS.flatMap(key => m.cells[key].filter(c => c.state === 'join'))
    if (!joins.length) continue
    out.push(`${m.name}: join code: ${joins.map(c => `${cellLabel(c)}: ${c.code ?? '—'}`).join('; ')}`)
  }
  for (const u of g.unexpected) out.push(`${u.email}: in ${u.className}, not on the roster`)
  return out
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// The name column reads left; every status box is centred.
const th = (colour: string) => `padding:6px 8px;text-align:center;font-size:13px;border-bottom:2px solid ${colour};color:${colour};`
const TD = 'padding:6px 8px;text-align:center;font-size:14px;border-bottom:1px solid #d1d5db;color:#1f2937;vertical-align:top;'
const LEFT = 'text-align:left;'
const FLAG = 'background:#fde2e2;'

// THE LONG WORDS GO IN A TOOLTIP: a concise table is more effective, and the long words go in the
// hover. The `title` attribute is the one
// hover an email can carry; a client that ignores it still shows the concise box.
function cellTip(c: GridCell): string {
  return c.state === 'good'
    ? `In ${cellLabel(c)} as ${c.email}.`
    : `Not in ${cellLabel(c)} yet. Join it signed in as ${c.email}${c.code ? `, or enter code ${c.code} at classroom.google.com` : ''}.`
}

// NO BOLD in the grid — the colour of the box already marks it.
//
// ONE RULE FOR EVERY BOX, the school board included — either the classroom link or the join link,
// followed by the Meet link when one exists; no checkmark: in the
// classroom — a green box, the Google Classroom's name linking to it; not in it — an amber box,
// "Join <name>" as the join link; then the camera when the classroom has a Meet, in either state.
// Google links only, never a roster link.
//
// THIS IS THE ONE GRID: a screen that shows a family's classroom status renders this same
// HTML, so screen and email never differ. The `title` hovers are the email's, and a screen
// shows them as they are.
const GOOD_BG = 'background:#dcfce7;'
const JOIN_BG = 'background:#fef3c7;'

// A Meet link wears the camera glyph; its title says what it opens.
function meetHtml(c: GridCell): string {
  return c.meetUrl ? ` <a href="${c.meetUrl}" title="${esc(`Google Meet for ${c.className}`)}" style="text-decoration:none;">&#127909;</a>` : ''
}

function cellHtml(c: GridCell, colour: string): string {
  const tip = esc(cellTip(c))
  const link = c.state === 'good'
    ? (c.classroomUrl
        ? `<a href="${c.classroomUrl}" title="${tip}" style="color:#1f2937;text-decoration:none;">${esc(cellLabel(c))}</a>`
        : `<span title="${tip}" style="color:#1f2937;">${esc(cellLabel(c))}</span>`)
    : (c.joinUrl
        ? `<a href="${c.joinUrl}" title="${tip}" style="color:${colour};">Join ${esc(cellLabel(c))}</a>`
        : `<span title="${tip}">Join ${esc(cellLabel(c))}</span>`)
  return link + meetHtml(c)
}

function cellTd(_key: GridColumn, cells: GridCell[], colour: string): string {
  if (cells.length === 0) return `<td style="${TD}"></td>`
  const style = cells.some(c => c.state === 'join') ? JOIN_BG : GOOD_BG
  return `<td style="${TD}${style}">${cells.map(c => cellHtml(c, colour)).join('<br>')}</td>`
}

/** The long words for a member standing on a shared address — the email hover and the screen tooltip. */
export function gridCollisionTip(name: string, g: FamilyGrid): string {
  const mine = g.collisions.find(c => c.name === name)
  if (!mine) return ''
  const others = g.collisions.filter(c => c.email === mine.email && c.name !== name).map(c => c.name)
  const whose = mine.lender ? `${mine.lender}'s address, ${mine.email}` : mine.email
  return `${name} and ${andList(others)} both use ${whose}. One address can stand for only one student, so each needs their own.`
}

/** The long words for a member's name box. */
export function gridNameTip(m: GridMember, g: FamilyGrid): string {
  return nameTip(m, g)
}

function nameTip(m: GridMember, g: FamilyGrid): string {
  if (m.flag === 'no-email') return `We have no email address for ${m.name}, so no classroom can place them.`
  if (m.flag === 'collision') return gridCollisionTip(m.name, g)
  return ''
}

/** The block for the bottom of the email: grid, then the enumeration. */
// NO SPACE ABOVE OR BELOW THE TABLE (vertical space is at a premium) — screen
// and email alike, since both show this HTML.
export function familyGridHtml(g: FamilyGrid): string {
  // The first header is "Family", not the family's name.
  const TH = th(g.colour)
  const head = `<tr><th style="${TH}${LEFT}">Family</th>${columns(g).map(c => `<th style="${TH}">${esc(c.label)}</th>`).join('')}</tr>`
  const body = g.members.map(m => `<tr><td style="${TD}${LEFT}${m.flag ? FLAG : ''}"${m.flag ? ` title="${esc(nameTip(m, g))}"` : ''}>${esc(m.name)}</td>${
    KEYS.map(key => cellTd(key, m.cells[key], g.colour)).join('')}</tr>`).join('')
  const problems = gridProblemLines(g)
  const list = problems.length
    ? `<ol style="margin:0;padding-left:20px;font-size:14px;line-height:1.5;color:#1f2937;">${problems.map(p => `<li>${esc(p)}</li>`).join('')}</ol>`
    : `<p style="margin:0;font-size:14px;color:#1f2937;">All good.</p>`
  return `<hr style="border:none;border-top:1px solid #d1d5db;margin:0;">
<table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:0;">
<thead>${head}</thead><tbody>${body}</tbody></table>
${list}`
}

/** The same block for text/plain. */
export function familyGridText(g: FamilyGrid): string {
  const cellText = (_key: GridColumn, cells: GridCell[]) => cells.map(c =>
    (c.state === 'good' ? cellLabel(c) : `Join ${cellLabel(c)}`) + (c.meetUrl ? ` (Meet ${c.meetUrl})` : '')).join(' + ')
  const lines = [
    '—',
    ['Family', ...columns(g).map(c => c.label)].join(' | '),
    ...g.members.map(m => [`${m.flag ? '! ' : ''}${m.name}`, ...KEYS.map(key => cellText(key, m.cells[key]))].join(' | ')),
    '',
  ]
  const problems = gridProblemLines(g)
  if (problems.length) problems.forEach((p, i) => lines.push(`${i + 1}. ${p}`))
  else lines.push('All good.')
  return lines.join('\n')
}
