// THE COURSE RULES' LOGIC on an invented school (ports-fake.ts FAKE_RULES): culture class codes and first-grade choices.
// A real school's answers are its host's tests.
import { describe, expect, it } from 'vitest'
import { FAKE_RULES } from '../ports-fake'
import { cultureCodeFor } from './auto-assign'
import { firstGradeYearChoices, gradeInWords, gradeLabel, personAge } from './enrollment'
import { systemEventTypes } from './calendar-types'

const courses = FAKE_RULES.courses

describe('cultureCodeFor', () => {
  it("kindergarten takes the school's code; a grade past the last class is placed in it", () => {
    expect(cultureCodeFor(courses, 0)).toBe(courses.kindergartenCultureCode)
    expect(cultureCodeFor(courses, 3)).toBe('X3')
    expect(cultureCodeFor(courses, courses.lastCultureGrade + 2)).toBe(`X${courses.lastCultureGrade}`)
  })
})

describe('firstGradeYearChoices', () => {
  it("a birthday before the school's cutoff month gives one year, from it two", () => {
    expect(firstGradeYearChoices(courses, 2026, '2021-09-30').map(c => c.year)).toEqual([2021 + courses.firstGradeAge])
    expect(firstGradeYearChoices(courses, 2026, '2021-10-01').map(c => c.year))
      .toEqual([2021 + courses.firstGradeAge, 2021 + courses.firstGradeAge + 1])
  })
})

describe('gradeLabel and gradeInWords', () => {
  const g = courses.grades
  it("prints the school's words before first grade and past its last grade, and the number between", () => {
    expect(gradeLabel(g, 2026, 2028)).toBe(g.beforeKindergarten)
    expect(gradeLabel(g, 2026, 2027)).toBe(g.kindergarten)
    expect(gradeLabel(g, 2026, 2026)).toBe('1')
    expect(gradeLabel(g, 2026, 2026 - g.last + 1)).toBe(String(g.last))
    expect(gradeLabel(g, 2026, 2026 - g.last)).toBe(g.past)
    expect(gradeLabel(g, 2026, null)).toBe('—')
  })
  it('says "grade N" for a number and the word itself otherwise', () => {
    expect(gradeInWords(g, 2026, 2024)).toBe('grade 3')
    expect(gradeInWords(g, 2026, 2027)).toBe(g.kindergarten)
  })
})

describe('personAge', () => {
  it('counts whole years to the day, by the dates alone', () => {
    expect(personAge('2016-03-15', '2026-03-14')).toBe(9)
    expect(personAge('2016-03-15', '2026-03-15')).toBe(10)
    expect(personAge('2016-12-31', '2027-01-01')).toBe(10)
  })
})

describe('systemEventTypes', () => {
  it("is the school's school day and holiday", () => {
    expect(systemEventTypes(FAKE_RULES.calendar)).toEqual([FAKE_RULES.calendar.eventTypes.schoolDay, FAKE_RULES.calendar.eventTypes.holiday])
  })
})
