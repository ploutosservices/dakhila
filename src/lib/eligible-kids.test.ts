import { describe, it, expect } from 'vitest'
import { eligibleKids, isEligibleToEnroll } from './eligible-kids'
import { FAKE_RULES } from '../ports-fake'

// The invitation's rule, one function: a boy or girl whose grade in the year is the invented school's first enrolled
// grade (0, the year before first grade) through its last grade (10).
const GRADES = FAKE_RULES.courses.grades

describe('eligibleKids', () => {
  const year = 2026
  it('takes boys and girls from the year before first grade through the last grade, oldest first', () => {
    const fam = [
      { firstName: 'Mom', role: 'mother', firstGradeYear: null },
      { firstName: 'Senior', role: 'girl', firstGradeYear: 2017 },   // grade 10, the last
      { firstName: 'Little', role: 'boy', firstGradeYear: 2027 },    // the year before first grade
      { firstName: 'Done', role: 'boy', firstGradeYear: 2016 },      // past the last grade
      { firstName: 'Tiny', role: 'girl', firstGradeYear: 2028 },     // two years before first grade
      { firstName: 'NoYear', role: 'girl', firstGradeYear: null },
    ]
    expect(eligibleKids(fam, year, GRADES).map(k => k.firstName)).toEqual(['Senior', 'Little'])
  })
  it('starts at the school\'s first enrolled grade', () => {
    const fam = [{ firstName: 'Little', role: 'boy', firstGradeYear: 2027 }, { firstName: 'One', role: 'girl', firstGradeYear: 2026 }]
    expect(eligibleKids(fam, year, { ...GRADES, enrollsFrom: 1 }).map(k => k.firstName)).toEqual(['One'])
  })
  it('refuses a person who is not a boy or girl', () => {
    expect(isEligibleToEnroll({ role: 'father', firstGradeYear: 2020 }, year, GRADES)).toBe(false)
  })
})
