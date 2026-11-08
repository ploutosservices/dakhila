import { describe, expect, it } from 'vitest'
import { classroomGroups } from './teacher-card'

// THE MIDDLE LEVEL IS THE CLASSROOM: teacher -> classroom -> students. A teacher can have
// multiple classrooms and a classroom can have multiple students. Drilled here
// rather than against the data, because a school's data may hold only one arm of the three.

const c = (classId: string, classroomCourseId: string | null) => ({ classId, classroomCourseId })

describe('classroomGroups', () => {
  it('several roster classes in one Google classroom are ONE classroom', () => {
    // A teacher's shape: three classes are one course sharing one Meet.
    const g = classroomGroups([c('a2', 'course-9'), c('a4', 'course-9'), c('a5', 'course-9')])
    expect(g).toHaveLength(1)
    expect(g[0].courseId).toBe('course-9')
    expect(g[0].rows.map(r => r.classId)).toEqual(['a2', 'a4', 'a5'])
  })

  it('classes in different Google classrooms are different classrooms', () => {
    const g = classroomGroups([c('a', 'course-1'), c('b', 'course-2'), c('c', 'course-1')])
    expect(g.map(x => x.courseId)).toEqual(['course-1', 'course-2'])
    expect(g[0].rows.map(r => r.classId)).toEqual(['a', 'c'])
    expect(g[1].rows.map(r => r.classId)).toEqual(['b'])
  })

  it('two classes with NO Google classroom stay two classrooms, not one null group', () => {
    const g = classroomGroups([c('x', null), c('y', null)])
    expect(g).toHaveLength(2)
    expect(g.every(x => x.courseId === null)).toBe(true)
  })

  it('a blank course id is no classroom, not a classroom named ""', () => {
    const g = classroomGroups([c('x', '   ')])
    expect(g).toEqual([{ courseId: null, rows: [c('x', '   ')] }])
  })

  it('a course id is matched trimmed — one classroom, not two', () => {
    const g = classroomGroups([c('a', 'course-1'), c('b', ' course-1 ')])
    expect(g).toHaveLength(1)
    expect(g[0].courseId).toBe('course-1')
  })
})
