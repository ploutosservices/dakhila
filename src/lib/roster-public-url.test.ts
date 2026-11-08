import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Tenant } from './tenant'

// No address in the code, and no environment beyond the one word `production`.
//
// The address comes from the tenant's configuration, one value per environment, and an environment with no value
// REFUSES. The read is mocked because these pin the CONTRACT — ask this environment, never borrow — not the store. A
// test pins the rule, not the code: a case that describes what the code does can pass on a defect.

const dowry = vi.hoisted(() => ({ dowryValueOrNull: vi.fn() }))
vi.mock('./dowry', () => dowry)
const env = vi.hoisted(() => ({ environmentName: vi.fn(() => 'some-environment'), hostPage: (name: string, id?: string) => `/school/${name}${id ? `/${id}` : ''}` }))
vi.mock('./host', () => env)

const { rosterPublicUrl, familyDetailsUrl, evaluationsUrl, RosterUrlUnknown } = await import('./roster-public-url')

const tenant = { id: 'ten-1', slug: 'school' } as unknown as Tenant

beforeEach(() => { dowry.dowryValueOrNull.mockReset(); env.environmentName.mockReturnValue('some-environment') })

describe('rosterPublicUrl', () => {
  it('returns the value this environment holds, whatever the environment is called', async () => {
    dowry.dowryValueOrNull.mockResolvedValue('https://roster.example.org')
    await expect(rosterPublicUrl(tenant)).resolves.toBe('https://roster.example.org')
    expect(dowry.dowryValueOrNull).toHaveBeenCalledWith('ten-1', 'roster-address')
  })

  // The helper asks for THIS environment's value and has no idea which environments exist: another environment is a
  // configuration value, not a release.
  it('names no environment of its own — an arbitrary environment name works', async () => {
    env.environmentName.mockReturnValue('any-name-at-all')
    dowry.dowryValueOrNull.mockResolvedValue('https://whatever.example.org')
    await expect(rosterPublicUrl(tenant)).resolves.toBe('https://whatever.example.org')
  })

  it('an environment with no value REFUSES, and names the environment it could not answer for', async () => {
    env.environmentName.mockReturnValue('an-environment-with-no-value')
    dowry.dowryValueOrNull.mockResolvedValue(null)
    await expect(rosterPublicUrl(tenant)).rejects.toThrow(RosterUrlUnknown)
    await expect(rosterPublicUrl(tenant)).rejects.toThrow(/an-environment-with-no-value/)
  })

  it('does not fall back to another environment when its own value is missing', async () => {
    dowry.dowryValueOrNull.mockResolvedValue(null)
    await expect(rosterPublicUrl(tenant)).rejects.toThrow()
    // one lookup, for this environment, and no second attempt at anybody else's
    expect(dowry.dowryValueOrNull).toHaveBeenCalledTimes(1)
  })

  it('familyDetailsUrl is that address plus the family edit path', async () => {
    dowry.dowryValueOrNull.mockResolvedValue('https://roster.example.org')
    await expect(familyDetailsUrl(tenant, 'fam-1'))
      .resolves.toBe('https://roster.example.org/school/family-edit/fam-1')
  })
})

// What must hold: an evaluation mail sent from an environment carries that environment's link. A link written into
// the sender as a constant would send every environment's readers to one environment.
describe('evaluationsUrl', () => {
  it('carries whatever address this environment holds, never a constant', async () => {
    dowry.dowryValueOrNull.mockResolvedValue('https://other.example.org')
    await expect(evaluationsUrl(tenant))
      .resolves.toBe('https://other.example.org/school/evaluations')
  })
})
