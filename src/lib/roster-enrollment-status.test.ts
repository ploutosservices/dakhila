import { describe, expect, test } from 'vitest'
import { FAKE_RULES } from '../ports-fake'
import { enrollmentStatusGroups, enrollmentStatusLabel } from './roster-enrollment-status'

describe('enrollment status vocabulary, from the school\'s rules', () => {
  test('a code reads its label; an unknown code reads as itself; none is a dash', () => {
    expect(enrollmentStatusLabel(FAKE_RULES.codes, 21)).toBe('In')
    expect(enrollmentStatusLabel(FAKE_RULES.codes, 99)).toBe('99')
    expect(enrollmentStatusLabel(FAKE_RULES.codes, null)).toBe('—')
  })
  test('the groups are the rules\' groups', () => {
    expect(enrollmentStatusGroups(FAKE_RULES.codes)).toEqual({ enrolled: [21], pending: [22, 24], declined: [23] })
  })
})
