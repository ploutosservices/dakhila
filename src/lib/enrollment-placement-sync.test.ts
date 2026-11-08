import { describe, it, expect } from 'vitest'
import { classifyPlacements } from './enrollment-placement-sync'
import { FAKE_RULES } from '../ports-fake'

// The two-class rule: every enrolled kid holds a live culture placement
// AND a live language placement for the year. On an invented school's courses (ports-fake.ts).
const courses = FAKE_RULES.courses
const culture = courses.cultureDepartment
const [langA, langB] = courses.languages

describe('classifyPlacements', () => {
  it('zero placements misses both', () => {
    expect(classifyPlacements(courses, [])).toEqual({ hasCulture: false, hasLanguage: false })
  })

  it('culture only misses language', () => {
    expect(classifyPlacements(courses, [culture])).toEqual({ hasCulture: true, hasLanguage: false })
  })

  it("each of the school's languages satisfies language", () => {
    for (const lang of courses.languages) {
      expect(classifyPlacements(courses, [lang])).toEqual({ hasCulture: false, hasLanguage: true })
    }
  })

  it('culture + a language is in sync', () => {
    expect(classifyPlacements(courses, [culture, langB])).toEqual({ hasCulture: true, hasLanguage: true })
  })

  it('a department outside the rules satisfies neither side', () => {
    expect(classifyPlacements(courses, ['kindergarten'])).toEqual({ hasCulture: false, hasLanguage: false })
  })

  it('duplicates and extra departments do not confuse it', () => {
    expect(classifyPlacements(courses, [culture, culture, langA, 'kindergarten']))
      .toEqual({ hasCulture: true, hasLanguage: true })
  })
})
