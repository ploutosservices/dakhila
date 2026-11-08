// THE CLASSROOM THE ROSTER'S CLASSES MEET IN, AS THE HOST MIRRORS IT (ports.ts `classroom`): courses by id, a
// session's claimed members, a course's members, the Classroom users by address, a board, a new course kept, and a
// class's link cut. A class names its course by `classroomCourseId`; `courseOf` reads the courses a set of rows names.
import { ports, type Inserter, type Updater, type MirrorCourse, type KeptCourse } from '../ports'

export type { MirrorCourse, KeptCourse } from '../ports'

/** The mirrored course each row names, by id; a row naming none, or a course the mirror does not hold, gets null. */
export async function courseOf<T extends { classroomCourseId: string | null }>(rows: T[]): Promise<(c: T) => MirrorCourse | null> {
  const ids = [...new Set(rows.map(r => r.classroomCourseId).filter((id): id is string => !!id))]
  const byId = new Map((ids.length ? await ports().classroom.courses(ids) : []).map(c => [c.id, c]))
  return r => (r.classroomCourseId ? byId.get(r.classroomCourseId) ?? null : null)
}

export async function mirrorCourses(ids: string[]): Promise<MirrorCourse[]> {
  return ids.length ? ports().classroom.courses(ids) : []
}

export async function sessionMembers(tenantId: string, label: string) {
  return ports().classroom.sessionMembers(tenantId, label)
}

export async function courseMembers(tenantId: string, courseId: string) {
  return ports().classroom.courseMembers(tenantId, courseId)
}

export async function classroomUsersByEmails(tenantId: string, emails: string[]) {
  return emails.length ? ports().classroom.usersByEmails(tenantId, emails) : []
}

export async function boardBySlug(tenantId: string, slug: string) {
  return ports().classroom.board(tenantId, slug)
}

/** Of these course ids, those a board designated `slug` names, in any tenant. */
export async function boardCourseIds(slug: string, courseIds: string[]): Promise<string[]> {
  return courseIds.length ? ports().classroom.boardCourseIds(slug, courseIds) : []
}

export async function keepCourse(tx: Inserter, course: KeptCourse): Promise<void> {
  return ports().classroom.keep(tx, course)
}

export async function unlinkClass(tx: Updater, tenantId: string, classId: string): Promise<void> {
  return ports().classroom.unlinkClass(tx, tenantId, classId)
}
