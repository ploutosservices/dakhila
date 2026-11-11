import { describe, it, expect } from 'vitest'
import { ROLE_BUNDLES, ROLE_WORDS } from './access-rule'

describe('ROLE_WORDS', () => {
  it('says what every role holds, and names no role the rule does not have', () => {
    expect(Object.keys(ROLE_WORDS).sort()).toEqual(Object.keys(ROLE_BUNDLES).sort())
    for (const words of Object.values(ROLE_WORDS)) expect(words.trim().length).toBeGreaterThan(0)
  })
})
