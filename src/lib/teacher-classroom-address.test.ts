import { describe, it, expect } from 'vitest'
import { teacherClassroomAddress } from './teacher-classroom-address'

// The tenant's directory domain, handed in — a fixture here.
const D = 'school.test'

// The one rule every consumer of persons.classroom_email shares: trimmed, lowercased,
// null when there is nothing there.
describe('teacherClassroomAddress', () => {
  it('returns the generated column trimmed and lowercased', () => {
    expect(teacherClassroomAddress({ email: 'tutor.a@home.example', classroomEmail: '  Tutor.A@School.test ' }, D)).toBe('tutor.a@school.test')
  })
  it('is null for null, undefined, empty and whitespace', () => {
    expect(teacherClassroomAddress({ email: 'x@home.example', classroomEmail: null }, D)).toBeNull()
    expect(teacherClassroomAddress({ email: null, classroomEmail: undefined }, D)).toBeNull()
    expect(teacherClassroomAddress({ email: '', classroomEmail: '' }, D)).toBeNull()
    expect(teacherClassroomAddress({ email: '  ', classroomEmail: '   ' }, D)).toBeNull()
  })
  // If the primary email address is on the school's domain, the other column is irrelevant.
  it('a school-domain primary IS the classroom address, whatever the column holds', () => {
    expect(teacherClassroomAddress({ email: ' Tutor.A@School.test', classroomEmail: 'tutor.a2@school.test' }, D)).toBe('tutor.a@school.test')
    expect(teacherClassroomAddress({ email: 'tutor.b@school.test', classroomEmail: null }, D)).toBe('tutor.b@school.test')
  })
  it('a personal primary never becomes the classroom address', () => {
    expect(teacherClassroomAddress({ email: 'tutor.a@home.example', classroomEmail: null }, D)).toBeNull()
  })
})
