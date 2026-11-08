import { describe, it, expect } from 'vitest'
import { resolveStudentAddress } from './student-address'

const MOTHER = 'm1'
const FATHER = 'f1'

function student(personId: string, name: string, over: Partial<{
  email: string | null; guardian: number | null; motherEmail: string | null; fatherEmail: string | null
}> = {}) {
  return {
    personId, name,
    email: null, guardian: null,
    motherId: MOTHER, fatherId: FATHER,
    motherEmail: 'mother@home.example', fatherEmail: 'father@home.example',
    domain: 'school.test',
    ...over,
  }
}

describe('resolveStudentAddress', () => {
  it('prefers the student’s own address over the pointer', () => {
    const r = resolveStudentAddress(student('s1', 'A', { email: 'a@example.test', guardian: 2 }))
    expect(r).toEqual({ email: 'a@example.test', source: 'own' })
  })

  it('follows the guardian pointer when the student has none', () => {
    expect(resolveStudentAddress(student('s1', 'A', { guardian: 1 })))
      .toEqual({ email: 'mother@home.example', source: 'mother' })
    expect(resolveStudentAddress(student('s1', 'A', { guardian: 2 })))
      .toEqual({ email: 'father@home.example', source: 'father' })
  })

  // No teacher condition: teacher roles use school-issued addresses only, so a teaching parent's
  // personal address IS lent.
  it('lends a teaching parent’s address — no parent condition', () => {
    const r = resolveStudentAddress(student('s1', 'A', { guardian: 2 }))
    expect(r).toEqual({ email: 'father@home.example', source: 'father' })
  })

  // Children of a teacher may not use a school-issued address — a teacher's primary address may be
  // one, and the pointer must not lend it. Nor may a student hold one outright.
  it('never resolves to a workspace address, borrowed or own', () => {
    expect(resolveStudentAddress(student('s1', 'A', { guardian: 1, motherEmail: 'Tutor.A@School.test' })))
      .toEqual({ email: null, source: 'none' })
    expect(resolveStudentAddress(student('s1', 'A', { guardian: 2, fatherEmail: 'tutor.b@school.test' })))
      .toEqual({ email: null, source: 'none' })
    expect(resolveStudentAddress(student('s1', 'A', { email: 'kid@school.test', guardian: 2 })))
      .toEqual({ email: null, source: 'none' })
  })
})
