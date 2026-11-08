// The public-facing links for a Google Classroom course, resolved from the
// roster rather than written down.
//
// A family joins a classroom in one of two ways and neither is an invitation:
// the join link, or the class code typed into classroom.google.com. Google blocks
// invitations to addresses outside the school's domain, so for a family on a
// personal address these two strings ARE the door. A class meets on a third, the
// Meet link.
//
// All three are in the store, never written down: every page and mail that names
// one reads it from here, so a changed link changes everywhere at once.

import { classroomShortName } from './classroom-short-name'
import { ports } from '../ports'
import { meetUrl } from './meet-url'
import { courseRules } from './rules-context'

export { meetUrl }

export type ClassroomLinks = {
  courseId: string
  name: string
  /** The class code a family types into classroom.google.com. */
  code: string | null
  /** The one-click join link, code included. Null when Google has published no code. */
  joinUrl: string | null
  /** Where the class or assembly actually meets. Null when none is set. */
  meetUrl: string | null
}

/**
 * Contract: throws when the course is not in the roster. A caller asking for a
 * course's links is about to put them in front of a person, and a send that
 * silently omits the join link is worse than one that refuses — the family gets
 * a mail telling them to join and no way to do it.
 *
 * Null fields are NOT an error here: `enrollmentCode` is absent on an archived course,
 * and `meetUrl` is null until someone sets the Meet ID. A null Meet is a GAP, not a
 * legitimate state — every classroom needs a Meet ID, it is not
 * optional. The caller decides what to show in its place; showing nothing beats showing a
 * broken link.
 */
export async function classroomLinks(courseId: string): Promise<ClassroomLinks> {
  const [row] = await ports().classroom.courses([courseId])
  if (!row) throw new Error(`Classroom course ${courseId} is not in the roster — sync from Google before using its links`)

  const code = row.enrollmentCode?.trim() || null
  // `alternateLink` is Google's own course URL; `?cjc=<code>` is what turns it
  // from "look at this class" into "join this class". Without a code there is no
  // join link to offer — the bare course URL would ask a stranger to sign in and
  // then tell them they are not a member.
  const joinUrl = row.alternateLink && code ? `${row.alternateLink}?cjc=${code}` : null

  return { courseId: row.id, name: classroomShortName(row), code, joinUrl, meetUrl: meetUrl(row.meet) }
}

/**
 * The school-wide board (SchoolRules.courses.schoolBoard) — where every announcement goes.
 *
 * Its courseId per tenant is the host's board DESIGNATED by the school's board slug — row first, value second, never a
 * free-text name match (ambiguous the day two rows share a value, wrong the day one is renamed).
 * A tenant with no designated board, or a designated board with a blank value, is
 * the blank case: null — no board, no error.
 */
export async function schoolBoardCourseId(tenantId: string): Promise<string | null> {
  const { slug } = (await courseRules(tenantId)).schoolBoard
  const value = (await ports().classroom.board(tenantId, slug))?.googleCourseId?.trim()
  return value || null
}

/** Null = the blank case (no designated board / blank value), not an error. */
export async function schoolBoardLinks(tenantId: string): Promise<ClassroomLinks | null> {
  const courseId = await schoolBoardCourseId(tenantId)
  return courseId ? classroomLinks(courseId) : null
}
