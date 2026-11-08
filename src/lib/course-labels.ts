// A GOOGLE COURSE'S NAME AND LINKS — the Google snapshot's half of the course display data (course-display.ts
// adds the roster classes behind each course), so a family's classroom table, which shows only names and links, reads
// no roster table.
import { classroomShortName } from './classroom-short-name'
import { mirrorCourses, boardCourseIds } from './classroom-mirror'
import { courseRules } from './rules-context'

export type CourseLinks = { classroomUrl: string | null; joinUrl: string | null; meetUrl: string | null; meetRequired?: boolean; enrollmentCode?: string | null }

// Display niceties keyed by courseId: the course NAME (like a record's label),
// Google's own course URL, the ?cjc join link (the format Google's shareable
// link uses), the Meet — from the course row itself (the sync
// leaves `meet` user-managed). A meet is REQUIRED on the school's board
// — required means its absence shows loudly, never that anything
// blocks: presentation only; the answer's data is unchanged.
export async function courseLabels(tenantId: string, courseIds: string[]): Promise<{
  courseName: (id: string) => string | null
  courseLinks: (id: string) => CourseLinks
}> {
  const [nameRows, schoolBoardRows] = courseIds.length > 0
    ? await Promise.all([mirrorCourses(courseIds), courseRules(tenantId).then(c => boardCourseIds(c.schoolBoard.slug, courseIds))])
    : [[], []]
  const nameById = new Map(nameRows.map(r => [r.id, classroomShortName(r)]))
  const rowById = new Map(nameRows.map(r => [r.id, r]))
  const schoolBoardCourseIds = new Set(schoolBoardRows.map(id => id.trim()).filter(Boolean))

  return {
    courseName: (id: string) => nameById.get(id.trim()) ?? null,
    courseLinks: (id: string): CourseLinks => {
      const r = rowById.get(id.trim())
      const meet = r?.meet ?? null   // the Google Classroom's — the one Meet store
      return {
        classroomUrl: r?.alternateLink ?? null,
        joinUrl: r?.alternateLink && r.enrollmentCode ? `${r.alternateLink}?cjc=${r.enrollmentCode}` : null,
        meetUrl: meet ? `https://meet.google.com/${meet}` : null,
        meetRequired: schoolBoardCourseIds.has(id.trim()),
        enrollmentCode: r?.enrollmentCode ?? null,
      }
    },
  }
}
