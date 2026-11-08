import { describe, it, expect } from 'vitest'
import { computeRun, type RunInput, type ClassRow, type PersonRow, type SnapshotRow, type RunResult } from './three-universes'
import { pendingByClassroom, participantsByClassroom, extrasOf } from './classroom-pending'
import { FAKE_RULES } from '../ports-fake'

const F1 = 'family-1'

function person(id: string, over: Partial<PersonRow> = {}): PersonRow {
  return { id, firstName: id, lastName: null, email: null, classroomEmail: null, guardian: null, familyId: F1, ...over }
}
function cls(id: string, over: Partial<ClassRow> = {}): ClassRow {
  return { id, year: 2026, shortCode: 'X1', department: 'lang-a', section: null, startTime: '10:00', endTime: '11:00', classroomCourseId: 'gc-1', ...over }
}
function snap(rowKey: string, courseId: string, email: string, role: string): SnapshotRow {
  return { rowKey, courseId, email, role }
}
function run(over: Partial<RunInput>): Extract<RunResult, { accepted: true }> {
  const r = computeRun({
    year: 2026, classes: [], teacherAssignments: [], studentAssignments: [], enrollments: [],
    enrollmentKids: [], tenantFamilies: [{ id: F1, motherId: 'mom', fatherId: null }], tenantPersons: [],
    board: null, snapshot: [], domain: 'school.test', language: FAKE_RULES.locale.language, ...over,
  })
  if (!r.accepted) throw new Error(JSON.stringify(r.rejections))
  return r
}

const teacher = person('t1', { classroomEmail: 't@school.test', familyId: F1 })
const mom = person('mom', { email: 'mom@example.test' })

describe('pendingByClassroom', () => {
  it('a joined student and teacher are not pending; an unjoined student is', () => {
    const r = run({
      classes: [cls('a')],
      teacherAssignments: [{ id: 'ta', classId: 'a', personId: 't1' }],
      studentAssignments: [{ id: 'e1', classId: 'a', studentId: 's1' }, { id: 'e2', classId: 'a', studentId: 's2' }],
      tenantPersons: [teacher, mom, person('s1', { email: 's1@example.test' }), person('s2', { email: 's2@example.test' })],
      snapshot: [snap('m1', 'gc-1', 't@school.test', 'Teacher'), snap('m2', 'gc-1', 's1@example.test', 'Student')],
    })
    expect(pendingByClassroom(r).get('gc-1')).toEqual({ Teacher: 0, Student: 1 })
  })

  it('students on a shared address are pending even when that address is in the classroom', () => {
    const r = run({
      classes: [cls('a')],
      teacherAssignments: [{ id: 'ta', classId: 'a', personId: 't1' }],
      studentAssignments: [{ id: 'e1', classId: 'a', studentId: 's1' }, { id: 'e2', classId: 'a', studentId: 's2' }],
      tenantPersons: [teacher, mom, person('s1', { guardian: 1 }), person('s2', { guardian: 1 })],
      snapshot: [snap('m1', 'gc-1', 't@school.test', 'Teacher'), snap('m2', 'gc-1', 'mom@example.test', 'Student')],
    })
    expect(pendingByClassroom(r).get('gc-1')).toEqual({ Teacher: 0, Student: 2 })
  })

  it('a student with no address and a teacher with no school address are pending', () => {
    const r = run({
      classes: [cls('a')],
      teacherAssignments: [{ id: 'ta', classId: 'a', personId: 't2' }],
      studentAssignments: [{ id: 'e1', classId: 'a', studentId: 's1' }],
      tenantPersons: [person('t2', { email: 't2@example.test', familyId: F1 }), mom, person('s1')],
    })
    expect(pendingByClassroom(r).get('gc-1')).toEqual({ Teacher: 1, Student: 1 })
  })

  it('someone in the classroom the roster does not place is not pending', () => {
    const r = run({
      classes: [cls('a')],
      teacherAssignments: [{ id: 'ta', classId: 'a', personId: 't1' }],
      tenantPersons: [teacher, mom],
      snapshot: [snap('m1', 'gc-1', 't@school.test', 'Teacher'), snap('m2', 'gc-1', 'stranger@example.test', 'Student')],
    })
    expect(pendingByClassroom(r).get('gc-1')).toBeUndefined()
  })

  it('an enrolled parent on the school board is a participant, not an extra', () => {
    const r = run({
      enrollments: [{ id: 'en1', familyId: F1, status: 'enrolled' }],
      tenantPersons: [mom],
      board: { id: 'bd1', name: 'Example Board', googleCourseId: 'bb-1' },
      snapshot: [snap('m1', 'bb-1', 'mom@example.test', 'Student'), snap('m2', 'bb-1', 'stranger@example.test', 'Student')],
    })
    expect(participantsByClassroom(r).get('bb-1')).toEqual([{ personId: 'mom', role: 'Student', email: 'mom@example.test', state: 'joined' }])
    expect(extrasOf(r, 'bb-1')).toEqual([{ email: 'stranger@example.test', role: 'Student' }])
    expect(pendingByClassroom(r).get('bb-1')).toBeUndefined()
  })
})
