// Course display data and the two row labels, shared by every reader of the three-universes run and of a family's
// classroom table, kept apart from any presentation.
// The Google half (names and links) is course-labels.ts; this adds the roster classes behind each course.

import { db } from './db'
import { rosterAvailableClasses, rosterCourseCatalog } from '../tables'
import { inArray, eq } from 'drizzle-orm'
import { courseLabels, type CourseLinks } from './course-labels'

export type { CourseLinks } from './course-labels'
// The row labels live in row-labels.ts, store-free; re-exported for this file's importers.
export { classLabel, personLabel } from './row-labels'

// WHEN THE CLASS MEETS, beside where it meets: the times belong on the ROW, so a caller tells
// a parent where and when from one list. A Google course can
// carry more than one roster class (a combined one reads "X6 X7 X9"), so this is an array
// and not a field: taking the first would quietly drop two of the three.
export type CourseClass = {
  classId: string
  shortCode: string | null
  section: string | null
  startTime: string | null
  endTime: string | null
}

export async function courseDisplayData(tenantId: string, courseIds: string[]): Promise<{
  courseName: (id: string) => string | null
  courseLinks: (id: string) => CourseLinks
  courseClasses: (id: string) => CourseClass[]
}> {
  const [labels, classRows] = await Promise.all([
    courseLabels(tenantId, courseIds),
    courseIds.length > 0
      ? db.select({
          courseId:  rosterAvailableClasses.classroomCourseId,
          classId:   rosterAvailableClasses.id,
          section:   rosterAvailableClasses.section,
          startTime: rosterAvailableClasses.startTime,
          endTime:   rosterAvailableClasses.endTime,
          shortCode: rosterCourseCatalog.shortCode,
        })
          .from(rosterAvailableClasses)
          .leftJoin(rosterCourseCatalog, eq(rosterCourseCatalog.id, rosterAvailableClasses.courseId))
          .where(inArray(rosterAvailableClasses.classroomCourseId, courseIds))
      : Promise.resolve([]),
  ])
  const classesByCourse = new Map<string, CourseClass[]>()
  for (const r of classRows) {
    const key = (r.courseId ?? '').trim()
    if (!key) continue
    classesByCourse.set(key, [...(classesByCourse.get(key) ?? []), {
      classId: r.classId, shortCode: r.shortCode ?? null, section: r.section ?? null,
      startTime: r.startTime ?? null, endTime: r.endTime ?? null,
    }])
  }

  return {
    ...labels,
    courseClasses: (id: string) => classesByCourse.get(id.trim()) ?? [],
  }
}
