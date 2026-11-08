import { describe, it, expect, vi } from 'vitest'

// An outward act names the owner it is made as. Off production nothing is made with the value, so an environment
// that does not hold the lead teacher names its absence; where the act is real the value is required.
const held = vi.hoisted(() => ({ v: null as string | null }))
vi.mock('./dowry', () => ({
  dowryValue: async () => { if (held.v === null) throw new Error('no lead teacher address is held'); return held.v },
}))

describe('leadTeacherFor', () => {
  it('real, unset — refuses as leadTeacherEmail does', async () => {
    held.v = null
    const { leadTeacherFor } = await import('./google-school')
    await expect(leadTeacherFor('t1', true)).rejects.toThrow(/no lead teacher address/)
  })
  it('off production, unset — names the absence instead of refusing', async () => {
    held.v = null
    const { leadTeacherFor } = await import('./google-school')
    await expect(leadTeacherFor('t1', false)).resolves.toMatch(/not set in this environment/)
  })
  it('set — the value, real or not', async () => {
    held.v = 'lead@school.test'
    const { leadTeacherFor } = await import('./google-school')
    await expect(leadTeacherFor('t1', false)).resolves.toBe('lead@school.test')
    await expect(leadTeacherFor('t1', true)).resolves.toBe('lead@school.test')
  })
})
