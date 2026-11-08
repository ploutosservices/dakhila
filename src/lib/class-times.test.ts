import { describe, it, expect } from 'vitest'
import { classTimesForDepartment, isLanguageDepartment } from './class-times'
import { FAKE_RULES } from '../ports-fake'

// An invented school's courses (ports-fake.ts); a real school's are its host's tests.
const courses = FAKE_RULES.courses

describe('classTimesForDepartment', () => {
  it('the culture department takes the culture period', () => {
    expect(classTimesForDepartment(courses, courses.cultureDepartment)).toEqual({ startTime: '10:00', endTime: '10:30' })
  })

  it('every language takes the language period', () => {
    for (const dept of courses.languages) {
      expect(classTimesForDepartment(courses, dept)).toEqual({ startTime: '09:00', endTime: '09:50' })
    }
  })

  it('a department outside the rules has no ruling', () => {
    expect(classTimesForDepartment(courses, 'kindergarten')).toBeNull()
    expect(classTimesForDepartment(courses, '')).toBeNull()
    expect(classTimesForDepartment(courses, 'Lore')).toBeNull() // departments are stored lower-case; no case tolerance
    expect(isLanguageDepartment(courses, courses.cultureDepartment)).toBe(false)
  })

  it('times satisfy what the store accepts: canonical HH:MM, start < end', () => {
    const hhmm = /^([01][0-9]|2[0-3]):[0-5][0-9]$/
    for (const dept of [courses.cultureDepartment, ...courses.languages]) {
      const t = classTimesForDepartment(courses, dept)!
      expect(t.startTime).toMatch(hhmm)
      expect(t.endTime).toMatch(hhmm)
      expect(t.startTime < t.endTime).toBe(true)
    }
  })
})
