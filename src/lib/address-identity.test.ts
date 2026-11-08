import { beforeEach, describe, expect, it, vi } from 'vitest'

// THE ADDRESS RULE. Primary wins, a classroom address is recognised and
// refused, anything else is nobody. The ORDER is the whole point: a student may carry a
// parent's primary address, so an address that is both must answer as the adult who owns it.

type Row = { id: string; firstName: string; lastName: string | null }

const dbState = vi.hoisted(() => ({
  // one queue entry per select the resolver makes, in order: primary, teacher
  queue: [] as Row[][],
  selects: 0,
}))

vi.mock('./db', () => {
  const take = () => Promise.resolve(dbState.queue[dbState.selects++] ?? [])
  const tail = () => ({ limit: take })
  return {
    db: {
      select: () => ({
        from: () => ({
          where: tail,
        }),
      }),
    },
  }
})

import { resolveAddressIdentity } from './address-identity'

const row = (id: string, first: string, last: string | null = null): Row => ({ id, firstName: first, lastName: last })

beforeEach(() => {
  dbState.queue = []
  dbState.selects = 0
})

describe('resolveAddressIdentity', () => {
  it('a primary address answers as that person, and asks nothing else', async () => {
    dbState.queue = [[row('p1', 'Ann', 'Example')]]
    expect(await resolveAddressIdentity('t1', 'Ann@Example.test')).toEqual({
      kind: 'primary', personId: 'p1', name: 'Ann Example',
    })
    expect(dbState.selects).toBe(1)   // the classroom stores were never asked
  })

  it("a teacher's classroom address is recognised, not admitted", async () => {
    dbState.queue = [[], [row('t9', 'Tutor', 'Example')]]
    expect(await resolveAddressIdentity('t1', 'tutor@school.test')).toEqual({
      kind: 'classroom', personId: 't9', name: 'Tutor Example',
    })
  })

  it('an address nobody holds is unknown — no such account', async () => {
    dbState.queue = [[], []]
    expect(await resolveAddressIdentity('t1', 'stranger@example.test')).toEqual({ kind: 'unknown' })
  })

  it('an empty address asks the database nothing', async () => {
    expect(await resolveAddressIdentity('t1', '   ')).toEqual({ kind: 'unknown' })
    expect(dbState.selects).toBe(0)
  })

  // The borrowed-address case: the address is a parent's primary AND a child's classroom address.
  // Primary is asked first, so the parent answers.
  it('an address a child borrows answers as the parent who owns it', async () => {
    dbState.queue = [[row('mom', 'Mother', 'Example')]]
    const who = await resolveAddressIdentity('t1', 'mother.example@example.test')
    expect(who).toEqual({ kind: 'primary', personId: 'mom', name: 'Mother Example' })
  })
})
