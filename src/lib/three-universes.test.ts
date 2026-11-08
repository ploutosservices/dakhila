import { describe, it, expect } from 'vitest'
import {
  computeRun,
  CHECK,
  CLIFF,
  type RunInput,
  type ClassRow,
  type PersonRow,
  type SnapshotRow,
  type RunResult,
} from './three-universes'

// Rules under test: the gate (two
// closed lists), the one normalization, the checks (3)-(5), the numbered sections an unmapped row falls into, the
// family derivation. Fixtures are constructed inputs over the pure core.

const F1 = 'family-1'
const F2 = 'family-2'

function person(id: string, over: Partial<PersonRow> = {}): PersonRow {
  return { id, firstName: id, lastName: null, email: null, classroomEmail: null, guardian: null, familyId: F1, ...over }
}

function cls(id: string, over: Partial<ClassRow> = {}): ClassRow {
  return { id, year: 2026, shortCode: 'A1', department: 'lang-a', section: null, startTime: '10:00', endTime: '11:00', classroomCourseId: null, ...over }
}

function snap(rowKey: string, courseId: string | null, email: string | null, role: string | null): SnapshotRow {
  return { rowKey, courseId, email, role }
}

function input(over: Partial<RunInput> = {}): RunInput {
  return {
    domain: 'school.test', language: 'en',
    year: 2026,
    classes: [],
    teacherAssignments: [],
    studentAssignments: [],
    enrollments: [],
    enrollmentKids: [],
    tenantFamilies: [{ id: F1, motherId: null, fatherId: null }],
    tenantPersons: [],
    board: null,
    snapshot: [],
    ...over,
  }
}

function refused(r: RunResult): asserts r is Extract<RunResult, { accepted: false }> {
  expect(r.accepted).toBe(false)
}

function accepted(r: RunResult): asserts r is Extract<RunResult, { accepted: true }> {
  if (!r.accepted) {
    throw new Error(`expected accepted run, got rejections: ${JSON.stringify(r.rejections, null, 2)}`)
  }
}

describe('the gate — roster ledger', () => {
  it('a current-session class with NULL times refuses the run', () => {
    const r = computeRun(input({ classes: [cls('c1', { startTime: null, endTime: null })] }))
    refused(r)
    expect(r.rejections.some(x => x.check === CHECK.classTimes)).toBe(true)
  })

  it('the time check rejects a non-canonical or inverted time', () => {
    const bad1 = computeRun(input({ classes: [cls('c1', { startTime: '10:00:00', endTime: '11:00' })] }))
    refused(bad1)
    const bad2 = computeRun(input({ classes: [cls('c1', { startTime: '11:00', endTime: '10:00' })] }))
    refused(bad2)
    // A padded canonical time is the clock time trimmed — populated and conforming.
    const ok = computeRun(input({ classes: [cls('c1', { startTime: ' 10:00 ', endTime: '11:00' })] }))
    accepted(ok)
  })

  it('overlap check — a shared endpoint is not an overlap; a genuine overlap refuses', () => {
    const student = person('s1', { email: 's1@example.test' })
    const backToBack = computeRun(input({
      classes: [cls('a'), cls('b', { startTime: '11:00', endTime: '11:45' })],
      studentAssignments: [
        { id: 'e1', classId: 'a', studentId: 's1' },
        { id: 'e2', classId: 'b', studentId: 's1' },
      ],
      tenantPersons: [student],
    }))
    accepted(backToBack)

    const overlapping = computeRun(input({
      classes: [cls('a'), cls('b', { startTime: '10:30', endTime: '11:30' })],
      studentAssignments: [
        { id: 'e1', classId: 'a', studentId: 's1' },
        { id: 'e2', classId: 'b', studentId: 's1' },
      ],
      tenantPersons: [student],
    }))
    refused(overlapping)
    const recs = overlapping.rejections.filter(x => x.check === CHECK.studentOverlap)
    expect(recs.length).toBeGreaterThan(0)
    // A relational refusal carries its co-violating rows.
    expect(recs.every(x => (x.coRows?.length ?? 0) > 0)).toBe(true)
  })

  it('room check — one real classroomId across two different (start, end) refuses', () => {
    const r = computeRun(input({
      classes: [
        cls('a', { classroomCourseId: 'gc-1' }),
        cls('b', { classroomCourseId: 'gc-1', startTime: '11:00', endTime: '11:45' }),
      ],
    }))
    refused(r)
    expect(r.rejections.some(x => x.check === CHECK.oneIdPerTime)).toBe(true)
  })

  it('a named person that resolves to no live tenant person refuses (readability)', () => {
    const r = computeRun(input({
      classes: [cls('a')],
      teacherAssignments: [{ id: 't1', classId: 'a', personId: 'ghost' }],
    }))
    refused(r)
    expect(r.rejections.some(x => x.check === CHECK.readability)).toBe(true)
  })

  it('a read person with no resolving family refuses', () => {
    const r = computeRun(input({
      classes: [cls('a')],
      teacherAssignments: [{ id: 't1', classId: 'a', personId: 'p1' }],
      tenantPersons: [person('p1', { familyId: null, classroomEmail: 't@school.test' })],
    }))
    refused(r)
    expect(r.rejections.some(x => x.check === CHECK.familyPresent)).toBe(true)
  })
})

describe('the gate — snapshot asserted structure', () => {
  it('a null-email snapshot row refuses (fields bar)', () => {
    const r = computeRun(input({ snapshot: [snap('m1', 'gc-1', null, 'Student')] }))
    refused(r)
    expect(r.rejections.some(x => x.check === CHECK.snapshotFields)).toBe(true)
  })

  it('a whitespace-only field is missing exactly as NULL is', () => {
    const r = computeRun(input({ snapshot: [snap('m1', 'gc-1', '   ', 'Student')] }))
    refused(r)
    expect(r.rejections.some(x => x.check === CHECK.snapshotFields)).toBe(true)
  })

  it('a case-variant role token refuses', () => {
    const r = computeRun(input({ snapshot: [snap('m1', 'gc-1', 'a@example.test', 'student')] }))
    refused(r)
    expect(r.rejections.some(x => x.check === CHECK.snapshotRole)).toBe(true)
  })

  it('two stored rows forming one normalized key refuse (key-uniqueness)', () => {
    const r = computeRun(input({
      snapshot: [
        snap('m1', 'gc-1', 'Kid@example.test', 'Student'),
        snap('m2', 'gc-1', ' kid@example.test ', 'Student'),
      ],
    }))
    refused(r)
    const recs = r.rejections.filter(x => x.check === CHECK.snapshotKey)
    expect(recs).toHaveLength(2)
    expect(recs.every(x => (x.coRows?.length ?? 0) === 1)).toBe(true)
  })

  it('a refused run has ONLY rejections — no sections, no projection', () => {
    const r = computeRun(input({ snapshot: [snap('m1', 'gc-1', null, 'Student')] }))
    refused(r)
    expect(Object.keys(r).sort()).toEqual(['accepted', 'rejections', 'year'])
  })
})

describe('unmapped sections and checks', () => {
  it('a teacherless class falls to (2)', () => {
    const r = computeRun(input({ classes: [cls('a')] }))
    accepted(r)
    expect(r.noTeachers.map(x => x.class.id)).toEqual(['a'])
  })

  it('a teacher without classroom_email drops to (3) — one row per teacher', () => {
    const teacher = person('t1', { email: 't1@example.test' })
    const r = computeRun(input({
      classes: [
        cls('a', { classroomCourseId: 'gc-1' }),
        cls('b', { classroomCourseId: 'gc-2', startTime: '11:00', endTime: '11:45' }),
      ],
      teacherAssignments: [
        { id: 'ta1', classId: 'a', personId: 't1' },
        { id: 'ta2', classId: 'b', personId: 't1' },
      ],
      tenantPersons: [teacher],
    }))
    accepted(r)
    expect(r.noClassroomEmail).toHaveLength(1)
    expect(r.noClassroomEmail[0].teacher.id).toBe('t1')
    expect(r.projection).toHaveLength(0)
  })

  it('two students on one borrowed address BOTH drop to (4)', () => {
    const mother = person('mom', { email: 'mom@example.test' })
    const s1 = person('s1', { guardian: 1 })
    const s2 = person('s2', { guardian: 1 })
    const teacher = person('t1', { classroomEmail: 't@school.test' })
    const r = computeRun(input({
      classes: [cls('a', { classroomCourseId: 'gc-1' })],
      teacherAssignments: [{ id: 'ta1', classId: 'a', personId: 't1' }],
      studentAssignments: [
        { id: 'e1', classId: 'a', studentId: 's1' },
        { id: 'e2', classId: 'a', studentId: 's2' },
      ],
      tenantFamilies: [{ id: F1, motherId: 'mom', fatherId: null }],
      tenantPersons: [mother, s1, s2, teacher],
    }))
    accepted(r)
    expect(r.collisions.map(x => x.participant.id).sort()).toEqual(['s1', 's2'])
    expect(r.collisions.every(x => x.email === 'mom@example.test')).toBe(true)
    // Neither student reaches the projection; the teacher row stands.
    expect(r.projection.map(p => p.role)).toEqual(['Teacher'])
  })

  it('a participant with no emitted address goes to (5)', () => {
    const s1 = person('s1')   // no email, no guardian pointer
    const teacher = person('t1', { classroomEmail: 't@school.test' })
    const r = computeRun(input({
      classes: [cls('a', { classroomCourseId: 'gc-1' })],
      teacherAssignments: [{ id: 'ta1', classId: 'a', personId: 't1' }],
      studentAssignments: [{ id: 'e1', classId: 'a', studentId: 's1' }],
      tenantPersons: [s1, teacher],
    }))
    accepted(r)
    expect(r.noEmail.map(x => x.participant.id)).toEqual(['s1'])
  })

  it('two different real classroomIds in one (teacher set, start, end) group fall to (6)', () => {
    const teacher = person('t1', { classroomEmail: 't@school.test' })
    const r = computeRun(input({
      classes: [
        cls('a', { classroomCourseId: 'gc-1' }),
        cls('b', { classroomCourseId: 'gc-2' }),   // same time, same teacher set
      ],
      teacherAssignments: [
        { id: 'ta1', classId: 'a', personId: 't1' },
        { id: 'ta2', classId: 'b', personId: 't1' },
      ],
      tenantPersons: [teacher],
    }))
    accepted(r)
    expect(r.dataErrors.map(x => x.class.id).sort()).toEqual(['a', 'b'])
    expect(r.dataErrors.every(x => x.conditions.some(c => c.name === CLIFF.mixedIds))).toBe(true)
    expect(r.projection).toHaveLength(0)
    expect(r.pendingClassrooms).toHaveLength(0)
  })

  it('a uniformly missing classroomId group falls to (7) merged as ONE pending classroom', () => {
    const teacher = person('t1', { classroomEmail: 't@school.test' })
    const r = computeRun(input({
      // NULL on one class and '' on its sibling is uniformly missing — one state.
      classes: [
        cls('a', { classroomCourseId: null }),
        cls('b', { classroomCourseId: '' }),
      ],
      teacherAssignments: [
        { id: 'ta1', classId: 'a', personId: 't1' },
        { id: 'ta2', classId: 'b', personId: 't1' },
      ],
      tenantPersons: [teacher],
    }))
    accepted(r)
    expect(r.dataErrors).toHaveLength(0)
    expect(r.pendingClassrooms).toHaveLength(1)
    expect(r.pendingClassrooms[0].classes.map(c => c.id).sort()).toEqual(['a', 'b'])
    expect(r.pendingClassrooms[0].teachers.map(t => t.id)).toEqual(['t1'])
    expect(r.projection).toHaveLength(0)
  })
})

describe('the gap — keys under the one normalization', () => {
  it('a padded stored email keys as its trimmed twin — one key, a Match', () => {
    const teacher = person('t1', { classroomEmail: 'T@School.test' })
    const r = computeRun(input({
      classes: [cls('a', { classroomCourseId: 'gc-1' })],
      teacherAssignments: [{ id: 'ta1', classId: 'a', personId: 't1' }],
      tenantPersons: [teacher],
      snapshot: [snap('m1', 'gc-1', ' t@school.test ', 'Teacher')],
    }))
    accepted(r)
    expect(r.gap).toHaveLength(1)
    expect(r.gap[0].match).toBe(true)
    expect(r.gap[0].email).toBe('t@school.test')
  })

  it('byte-case courseIds are two ids — two keys, two breaks', () => {
    const teacher = person('t1', { classroomEmail: 't@school.test' })
    const r = computeRun(input({
      classes: [cls('a', { classroomCourseId: 'ABC' })],
      teacherAssignments: [{ id: 'ta1', classId: 'a', personId: 't1' }],
      tenantPersons: [teacher],
      snapshot: [snap('m1', 'abc', 't@school.test', 'Teacher')],
    }))
    accepted(r)
    expect(r.gap).toHaveLength(2)
    expect(r.gap.every(g => !g.match)).toBe(true)
    expect(r.gap.map(g => g.courseId).sort()).toEqual(['ABC', 'abc'])
  })
})

describe('the school board and family derivation', () => {
  it('a blank designated board value means zero board rows and no error', () => {
    const mother = person('mom', { email: 'mom@example.test' })
    const r = computeRun(input({
      enrollments: [{ id: 'en1', familyId: F1, status: 'enrolled' }],
      tenantFamilies: [{ id: F1, motherId: 'mom', fatherId: null }],
      tenantPersons: [mother],
      board: { id: 'bd1', name: 'Example Board', googleCourseId: '   ' },
    }))
    accepted(r)
    expect(r.projection).toHaveLength(0)
    expect(r.gap).toHaveLength(0)
  })

  it('enrolled parents, kids with their OWN email, and assigned teachers reach the board as Student', () => {
    const mother = person('mom', { email: 'Mom@example.test' })
    const kid = person('k1', { email: 'kid@example.test' })
    const kidNoEmail = person('k2', { guardian: 1 })   // borrowed address — NOT on the board
    const teacher = person('t1', { email: 'teach@example.test', classroomEmail: 't@school.test' })
    const r = computeRun(input({
      classes: [cls('a', { classroomCourseId: 'gc-1' })],
      teacherAssignments: [{ id: 'ta1', classId: 'a', personId: 't1' }],
      enrollments: [{ id: 'en1', familyId: F1, status: 'enrolled ' }],   // padded status is enrolled
      enrollmentKids: [
        { id: 'ek1', enrollmentId: 'en1', studentId: 'k1' },
        { id: 'ek2', enrollmentId: 'en1', studentId: 'k2' },
      ],
      tenantFamilies: [{ id: F1, motherId: 'mom', fatherId: null }],
      tenantPersons: [mother, kid, kidNoEmail, teacher],
      board: { id: 'bd1', name: 'Example Board', googleCourseId: 'bb-1' },
    }))
    accepted(r)
    const bb = r.projection.filter(p => p.courseId === 'bb-1')
    expect(bb.every(p => p.role === 'Student')).toBe(true)
    expect(bb.map(p => p.email).sort()).toEqual(['kid@example.test', 'mom@example.test', 'teach@example.test'])
  })

  it("a gap row's family is the resolved person's OWN family attribute", () => {
    // Mother named by enrolled family F1, but her own attribute says F2 —
    // the rule: the family comes from the email, own attribute wins.
    const mother = person('mom', { email: 'mom@example.test', familyId: F2 })
    const r = computeRun(input({
      enrollments: [{ id: 'en1', familyId: F1, status: 'enrolled' }],
      tenantFamilies: [
        { id: F1, motherId: 'mom', fatherId: null },
        { id: F2, motherId: null, fatherId: null },
      ],
      tenantPersons: [mother],
      board: { id: 'bd1', name: 'Example Board', googleCourseId: 'bb-1' },
    }))
    accepted(r)
    expect(r.gap).toHaveLength(1)
    expect(r.gap[0].familyId).toBe(F2)
  })

  // On the school board both rows are looked at: a parent whose address is a TEACHER on the board is on the board,
  // and is not told to join it.
  it('on the school board a Teacher row matches the Student row the projection wants', () => {
    const mother = person('mom', { email: 'mom@example.test', familyId: F1 })
    const r = computeRun(input({
      enrollments: [{ id: 'en1', familyId: F1, status: 'enrolled' }],
      tenantFamilies: [{ id: F1, motherId: 'mom', fatherId: null }],
      tenantPersons: [mother],
      board: { id: 'bd1', name: 'Example Board', googleCourseId: 'bb-1' },
      snapshot: [snap('m1', 'bb-1', 'mom@example.test', 'Teacher')],
    }))
    accepted(r)
    expect(r.gap).toHaveLength(1)
    expect(r.gap[0]).toMatchObject({ courseId: 'bb-1', email: 'mom@example.test', role: 'Student', match: true, familyId: F1 })
  })

  it('in a class the roles still compare exactly — a Teacher row does not stand in for a Student', () => {
    const r = computeRun(input({
      snapshot: [snap('m1', 'gc-9', 'mom@example.test', 'Teacher')],
      board: { id: 'bd1', name: 'Example Board', googleCourseId: 'bb-1' },
    }))
    accepted(r)
    expect(r.gap.every(g => !g.match)).toBe(true)
  })

  it('a Google-only row uses the same lookup; no hit derives no family', () => {
    const r = computeRun(input({
      snapshot: [snap('m1', 'gc-9', 'stranger@example.test', 'Student')],
    }))
    accepted(r)
    expect(r.gap).toHaveLength(1)
    expect(r.gap[0].match).toBe(false)
    expect(r.gap[0].familyId).toBeNull()
  })
})
