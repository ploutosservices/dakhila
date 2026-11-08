// A REHEARSAL ON THE SCHOOL BOARD'S GOOGLE CALENDAR (SchoolRules.courses.schoolBoard), apart from rehearsal.ts (which
// re-exports syncCalendar) so a caller reaching the roster only through its API reaches no roster read. It reads the
// tenant's timezone and the Classroom snapshot.
import type { Actor } from './outward-act'
import { ports } from '../ports'
import { tenantTimezone } from './tenant'
import { schoolBoardCourseId } from './classroom-links'
import { filled, schoolWord } from './school-words'
import { putRehearsalOnCalendar } from './google-calendar'
import { isNotMade, type NotMade } from './not-made'
import { longDate } from './rehearsal-words'
import { tenantRules } from './rules-context'
import type { Rehearsal } from './rehearsal'
import type { TaskNode } from './volunteering'

/** The tenant's zone; a tenant with none is refused by name, never given a zone of the roster's. */
export async function schoolTimezone(tenantId: string): Promise<string> {
  const zone = await tenantTimezone(tenantId)
  if (!zone) throw new Error(`no live tenant ${tenantId}, so no time zone to read its days in`)
  return zone
}

/** The school board's calendar and the account that owns it — the calendar is the classroom's, so it is written as
 *  its owner. Refuses by name when the board or its calendar is missing. */
async function schoolBoardCalendar(tenantId: string, board: string): Promise<{ calendarId: string; owner: string }> {
  const courseId = await schoolBoardCourseId(tenantId)
  if (!courseId) throw new Error(`This school has no ${board} designated, so there is no calendar to invite on.`)
  const row = await ports().classroom.calendarOf(tenantId, courseId)
  if (!row?.calendarId) throw new Error(`The ${board} has no Google calendar in the roster — refresh it from Google first.`)
  if (!row.ownerEmail) throw new Error(`The ${board}'s owner is not in the roster — refresh it from Google first.`)
  return { calendarId: row.calendarId, owner: row.ownerEmail }
}

/** The rehearsal on the school board's calendar with these guests; a new event id is handed to `persist` (the
 *  caller's write). */
export async function syncCalendar(r: Rehearsal, guests: string[], tasks: TaskNode[], actor: Actor, persist: (googleEventId: string) => Promise<void>): Promise<string | NotMade> {
  if (!r.startTime || !r.endTime) throw new Error('Type the rehearsal\'s start and end time first — the calendar needs them.')
  const { courses, locale } = await tenantRules(r.tenantId)
  const { calendarId, owner } = await schoolBoardCalendar(r.tenantId, courses.schoolBoard.name)
  const purpose = filled(await schoolWord(r.tenantId, 'rehearsal-purpose'), { date: longDate(r.performanceDate, locale.language) })
  const id = await putRehearsalOnCalendar(r.tenantId, owner, calendarId, r.googleEventId, {
    summary: r.title, location: r.place, date: r.date, startTime: r.startTime, endTime: r.endTime, timeZone: await schoolTimezone(r.tenantId),
    description: `${purpose}\n\n`
      + tasks.map(t => `${t.title}${t.url ? ` — ${t.url}` : ''}`).join('\n'),
    guests,
  }, actor)
  // Stored only when made: off production the statement names the guests, and no id is kept.
  if (!isNotMade(id) && id !== r.googleEventId) await persist(id)
  return id
}
