import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  chooseAddress, createGoogleAccount, takenAddresses,
} from './teacher-account'
import { usePorts } from '../ports'
import { fakePorts, FAKE_RULES } from '../ports-fake'

vi.mock('./outward-act', () => ({ outwardAct: async (_s: unknown, run: () => Promise<{ value: unknown }>) => (await run()).value }))

// Off production this module makes NO Google call. The environment
// is labelled something that is not production — an unlabelled one refuses — and the gated paths must return before touching the secret store or the
// Directory API; any network attempt here would throw and fail the test.

describe('off-production gate', () => {
  // A host whose environment is not production; every other port refuses, so a secret read or a Google call fails the test.
  beforeEach(() => { usePorts(fakePorts()) })

  it('createGoogleAccount returns NotMade naming the address — no password, no Google call', async () => {
    const r = await createGoogleAccount('t1', 'someone@school.test', 'Some', 'One', { person: { userId: 'u1' } })
    expect(r).toEqual({
      made: false,
      statement: expect.stringMatching(/^not made in this environment — .*someone@school\.test/),
      to: ['someone@school.test'],
    })
    expect(r).not.toHaveProperty('password')
  })

  it('takenAddresses reads no directory — empty set', async () => {
    expect(await takenAddresses('t1')).toEqual(new Set())
  })
})

describe('chooseAddress', () => {
  const rule = FAKE_RULES.codes.teacherAddresses   // last.first, then first-last
  it("follows the school's address patterns in order, the first one free", () => {
    expect(chooseAddress(rule, 'Ann', 'Example', new Set(), 'school.test')).toBe('example.ann@school.test')
    expect(chooseAddress(rule, 'Ann', 'Example', new Set(['example.ann@school.test']), 'school.test')).toBe('ann-example@school.test')
  })
  it('numbers the last pattern the name fills once every pattern is taken, and skips one the name cannot fill', () => {
    const taken = new Set(['example.ann@school.test', 'ann-example@school.test'])
    expect(chooseAddress(rule, 'Ann', 'Example', taken, 'school.test')).toBe('ann-example2@school.test')
    expect(chooseAddress(['{first}.{last}', '{first}'], 'Ann', '', new Set(), 'school.test')).toBe('ann@school.test')
  })
})
