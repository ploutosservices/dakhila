import { describe, it, expect } from 'vitest'
import { buildFamilyMap } from './family-map-context'
import { assertDeIdentified, emptyFamilyContext } from './family-context'
import type { FamilyCard } from './three-universes'

// The tenant's directory domain, handed in — a fixture here.
const D = 'school.test'

const FIRST = 'aaaaaaaa-0000-0000-0000-000000000001'
const SECOND = 'aaaaaaaa-0000-0000-0000-000000000002'

const person = (id: string, email: string | null) => ({
  id, firstName: 'X', lastName: null, email, classroomEmail: null, guardian: null, familyId: 'f1',
})

const display = {
  courseName: (id: string) => (id === 'c1' ? 'Lang A 2' : id === 'c2' ? 'Lore 5' : null),
  courseLinks: (id: string) => ({
    joinUrl: id === 'c1' ? 'https://classroom.google.com/c/c1?cjc=abc123' : null,
    enrollmentCode: id === 'c1' ? 'abc123' : null,
  }),
  courseClasses: (id: string) => (id === 'c1'
    ? [{ classId: 'cl1', shortCode: 'A2', section: 'A', startTime: '10:00', endTime: '11:00' }]
    : []),
}

const card = (over: Partial<FamilyCard> = {}): FamilyCard => ({
  familyId: 'f1',
  family: {} as FamilyCard['family'],
  parents: [],
  gapRows: [],
  collisions: [],
  noEmail: [],
  roster: { enrollments: [], kids: [], persons: [], teacherAssignments: [], studentAssignments: [], classes: [] } as FamilyCard['roster'],
  snapshotRows: [],
  ...over,
})

const gap = (courseId: string, email: string, match: boolean) => ({
  courseId, email, role: 'STUDENT', projection: null, snapshot: null, match, familyId: 'f1',
})

describe('buildFamilyMap', () => {
  it('resolves the run\'s address to a person key and drops the address', () => {
    const m = buildFamilyMap(card({
      roster: { ...card().roster, persons: [person(FIRST, 'first@example.test')] },
      gapRows: [gap('c1', 'First@Example.test', false)],
    }), 2026, display, D)

    expect(m.rows).toHaveLength(1)
    expect(m.rows[0].personKey).toBe(FIRST)
    expect(m.rows[0].personName).toBe('X')
    // The NAME travels, the ADDRESS does not — that is the whole distinction.
    expect(JSON.stringify(m)).not.toContain('example.test')
  })

  it('a break carries the join link and code; a match carries neither', () => {
    const m = buildFamilyMap(card({
      roster: { ...card().roster, persons: [person(FIRST, 'a@x.test'), person(SECOND, 'd@x.test')] },
      gapRows: [gap('c1', 'a@x.test', false), gap('c1', 'd@x.test', true)],
    }), 2026, display, D)

    const [brk, matched] = m.rows
    expect(brk.joinUrl).toContain('cjc=abc123')
    expect(brk.enrollmentCode).toBe('abc123')
    expect(matched.joinUrl).toBeNull()
    expect(matched.enrollmentCode).toBeNull()
  })

  it('allSet is stated outright, and a member with no address defeats it', () => {
    const allMatched = buildFamilyMap(card({
      roster: { ...card().roster, persons: [person(FIRST, 'a@x.test')] },
      gapRows: [gap('c1', 'a@x.test', true)],
    }), 2026, display, D)
    expect(allMatched.allSet).toBe(true)

    const oneMissing = buildFamilyMap(card({
      roster: { ...card().roster, persons: [person(FIRST, 'a@x.test')] },
      gapRows: [gap('c1', 'a@x.test', true)],
      noEmail: [{ participant: person(SECOND, null), familyId: 'f1' }],
    }), 2026, display, D)
    expect(oneMissing.allSet).toBe(false)
    expect(oneMissing.noAddress).toEqual([{ personKey: SECOND, personName: 'X' }])
  })

  it('an address matching nobody in the family leaves personKey null rather than guessing', () => {
    const m = buildFamilyMap(card({ gapRows: [gap('c1', 'stranger@x.test', false)] }), 2026, display, D)
    expect(m.rows[0].personKey).toBeNull()
  })

  it('carries when the class meets, on the row itself', () => {
    const m = buildFamilyMap(card({ gapRows: [gap('c1', 'a@x.test', false)] }), 2026, display, D)
    expect(m.rows[0].classes).toEqual([
      { classId: 'cl1', shortCode: 'A2', section: 'A', startTime: '10:00', endTime: '11:00' },
    ])
  })

  it('a course with no roster class behind it gets an empty list, not a missing field', () => {
    const m = buildFamilyMap(card({ gapRows: [gap('c2', 'a@x.test', true)] }), 2026, display, D)
    expect(m.rows[0].classes).toEqual([])
  })

  it('falls back to the course id when the course has no name — never an empty label', () => {
    const m = buildFamilyMap(card({ gapRows: [gap('unknown-course', 'a@x.test', true)] }), 2026, display, D)
    expect(m.rows[0].className).toBe('unknown-course')
  })

  it('passes the de-identification gate inside a real payload', () => {
    const m = buildFamilyMap(card({
      roster: { ...card().roster, persons: [person(FIRST, 'first@example.test')] },
      gapRows: [gap('c1', 'first@example.test', false)],
    }), 2026, display, D)
    const ctx = { ...emptyFamilyContext(2026, new Date('2026-09-10T00:00:00Z'), { attendance: 'a', announcements: 'b', calendar: 'c' }), map: m }
    expect(() => assertDeIdentified(ctx)).not.toThrow()
  })
})
