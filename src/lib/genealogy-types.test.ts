import { describe, it, expect } from 'vitest'
import { relationshipLabel } from './genealogy-types'

describe('relationshipLabel', () => {
  it('names a parent by sex when we hold one', () => {
    expect(relationshipLabel('parent', 'male')).toBe('father')
    expect(relationshipLabel('parent', 'female')).toBe('mother')
  })

  it('names a child by sex when we hold one — unchanged from the inline rule it replaced', () => {
    expect(relationshipLabel('child', 'male')).toBe('son')
    expect(relationshipLabel('child', 'female')).toBe('daughter')
  })

  // gender = 'child' is what a person saved without a choice of gender holds, not a sex. Guessing a parent's sex from anything else would be inventing.
  it('falls back to the neutral word rather than guessing', () => {
    expect(relationshipLabel('parent', 'child')).toBe('parent')
    expect(relationshipLabel('parent', null)).toBe('parent')
    expect(relationshipLabel('parent', '')).toBe('parent')
    expect(relationshipLabel('child', 'child')).toBe('child')
    expect(relationshipLabel('child', undefined)).toBe('child')
  })

  it('reads boy/girl as sexes, in any case', () => {
    expect(relationshipLabel('parent', 'Boy')).toBe('father')
    expect(relationshipLabel('parent', 'GIRL')).toBe('mother')
    expect(relationshipLabel('child', 'boy')).toBe('son')
  })

  // type stays the machine field: readers branch on 'spouse' (a spouse row can be ended),
  // so no gendered word may replace it here.
  it('leaves every other type alone', () => {
    expect(relationshipLabel('spouse', 'male')).toBe('spouse')
    expect(relationshipLabel('spouse', 'female')).toBe('spouse')
  })
})
