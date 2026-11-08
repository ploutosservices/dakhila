// THE NEWSLETTERS TABLE'S ROWS, READ FROM THE STORE — apart from the reader of Google, so a reader of stored postings
// imports no Google client, secret or run: the roster API's person read reads these and nothing else.
import { inArray } from 'drizzle-orm'
import { db } from './db'
import { tenantTimezone } from './tenant'
import { persons } from '../tables'
import { mirrorCourses } from './classroom-mirror'
import { ports, type Posting } from '../ports'
import type { RunResult } from './three-universes'

// The filter and its day rule: newsletter-filter.ts (pure; the host's Classroom port reads it too).
export { DAY, type NewsletterFilter } from './newsletter-filter'
import type { NewsletterFilter } from './newsletter-filter'
import { hostPage } from './host'
import { isoDayIn } from './zoned'

/** Every posting a principal has not deleted that the filter admits, newest first — the host's mirror of the
 *  classrooms' postings, through the Classroom port. */
export async function listNewsletters(tenantId: string, f: NewsletterFilter, zone: string): Promise<Posting[]> {
  return ports().classroom.postings(tenantId, f, zone)
}

/**
 * WHICH CLASSROOMS ARE A FAMILY'S — read from the classroom lookup, never a mapping of its own. The three-universes run is THE source for which Google classroom belongs to
 * whom, and a family's classrooms are exactly its family card's rows, the school board included. Null when the run refused: nobody can say, so nothing is shown.
 */
export function familyCourseIds(run: RunResult, familyId: string): string[] | null {
  if (!run.accepted) return null
  const card = run.familyCards.find(c => c.familyId === familyId)
  return card ? [...new Set(card.gapRows.map(g => g.courseId))] : []
}

/** A person's classrooms by the same run: every projected row one of whose facts is this person. */
export function personCourseIds(run: RunResult, personId: string): string[] | null {
  if (!run.accepted) return null
  return [...new Set(run.projection.filter(r => r.facts.some(f => f.personId === personId)).map(r => r.courseId))]
}

/** One row of the newsletters table — the same table wherever postings are listed. */
export type NewsletterRow = {
  id: string
  posted: string
  className: string
  archived: boolean
  kind: string
  gone: boolean
  title: string
  author: string
  /** The roster person whose own or classroom address posted it; null when the roster holds neither. */
  authorPersonId: string | null
  /** Teacher or Student of that class when read; '' = neither (not in the class when read). */
  authorRole: string
  /** The classroom's page in the host (its Google course page) when the host holds the classroom — this session's. */
  classHref: string | null
  /** The attachments as Google lists them — each title a link to the file. */
  attachments: Attachment[]
  link: string | null
}

/**
 * THE NEWSLETTERS' ROWS, one shape for every reader that shows them. Dates in the
 * tenant's zone; the author and the classes are the links stored on each row.
 */
export async function newsletterRows(tenantId: string, filter: NewsletterFilter = {}): Promise<{ rows: NewsletterRow[]; classes: number }> {
  const zone = await tenantTimezone(tenantId)
  if (!zone) throw new Error(`no live tenant ${tenantId}, so no time zone to date its postings in`)
  const stored = await listNewsletters(tenantId, filter, zone)
  const day = { format: (at: Date) => isoDayIn(at, zone) }
  // The stored author link, named by the person's roster name.
  const personIds = [...new Set(stored.map(r => r.authorPersonId).filter((x): x is string => !!x))]
  const names = new Map((personIds.length ? await db.select({ id: persons.id, first: persons.firstName, last: persons.lastName })
    .from(persons).where(inArray(persons.id, personIds)) : []).map(p => [p.id, [p.first, p.last].filter(Boolean).join(' ')]))
  // Classrooms the host holds a page for: the Classroom sync's rows (this session's). Archived ones have none.
  const courseIds = [...new Set(stored.map(r => r.courseId))]
  const held = new Set((await mirrorCourses(courseIds)).map(c => c.id))
  const rows = stored.map(r => {
    const personName = r.authorPersonId ? names.get(r.authorPersonId) : undefined
    return {
      id: r.id,
      posted: r.googleCreatedAt ? day.format(r.googleCreatedAt) : '',
      className: [r.courseName, r.courseSection].filter(Boolean).join(' — ') || r.courseId,
      archived: r.courseState === 'ARCHIVED',
      classHref: held.has(r.courseId) ? hostPage('google-course', r.courseId) : null,
      kind: kindLabel(r.kind, r.workType),
      gone: r.goneFromClassroomAt !== null,
      title: headline(r),
      author: personName ?? r.creatorName ?? r.creatorEmail ?? r.creatorUserId ?? '',
      authorPersonId: personName ? r.authorPersonId : null,
      authorRole: r.authorRole ?? '',
      attachments: attachmentsOf(r.materials),
      link: r.alternateLink,
    }
  })
  return { rows, classes: new Set(stored.map(r => r.courseId)).size }
}

// ── Display helpers ────────────────────────────────────────────────────────────────────────────────

/** `title` is null when Google gives the attachment no name — nothing is made up in its place. */
export type Attachment = {
  kind: 'Drive' | 'YouTube' | 'Link' | 'Form'; title: string | null; url: string | null
  /** The type Google reported, when the read asked for it — it decides the icon before any guess from the name. */
  mimeType?: string | null
  /** For a shortcut, the type Google reported for what it points at. */
  shortcutTo?: string | null
  /** The picture Google hands with a YouTube attachment — shown in place of the icon. */
  thumbnail?: string | null
}

/** The attachments as Google lists them, each with the title and address Google gave — nothing filled in. */
export function attachmentsOf(materials: unknown): Attachment[] {
  if (!Array.isArray(materials)) return []
  const out: Attachment[] = []
  for (const m of materials as Array<Record<string, any>>) {
    if (m.driveFile) out.push({ kind: 'Drive', title: m.driveFile.driveFile?.title ?? null, url: m.driveFile.driveFile?.alternateLink ?? null })
    else if (m.youtubeVideo) out.push({ kind: 'YouTube', title: m.youtubeVideo.title ?? null, url: m.youtubeVideo.alternateLink ?? null, thumbnail: m.youtubeVideo.thumbnailUrl ?? null })
    else if (m.link) out.push({ kind: 'Link', title: m.link.title ?? null, url: m.link.url ?? null })
    else if (m.form) out.push({ kind: 'Form', title: m.form.title ?? null, url: m.form.formUrl ?? null })
  }
  return out
}

const WORK_TYPES: Record<string, string> = {
  ASSIGNMENT: 'Assignment',
  SHORT_ANSWER_QUESTION: 'Question',
  MULTIPLE_CHOICE_QUESTION: 'Question',
}

/** How a posting's kind reads: Announcement, Material, or the coursework's own type as Google names it. */
export function kindLabel(kind: string, workType: string | null): string {
  if (kind === 'announcement') return 'Announcement'
  if (kind === 'material') return 'Material'
  return (workType && WORK_TYPES[workType]) ?? workType ?? 'Coursework'
}

/** The grid's one-line title: the posting's title, else the first line of its text. */
export function headline(row: { title: string | null; text: string | null }): string {
  if (row.title?.trim()) return row.title.trim()
  const first = (row.text ?? '').split('\n').map(l => l.trim()).find(Boolean) ?? ''
  if (first.length <= 120) return first
  // Cut between words, so a web address in the line is whole or absent — never a broken link. One unbroken token
  // (an address alone on the line) is kept whole.
  const cut = first.lastIndexOf(' ', 117)
  return cut > 0 ? `${first.slice(0, cut)} …` : first
}

/** Whether the tenant holds any classroom posting at all. */
export async function tenantHasNewsletters(tenantId: string): Promise<boolean> {
  return ports().classroom.hasPostings(tenantId)
}
