import { beforeEach, describe, expect, test, vi } from 'vitest'

// setTeacherVacation is the ONE write door for vacation marks:
// it refuses any date that is not a school-day event (the calendar is the
// authority), inserts on mark (idempotently), deletes on unmark.

const dbState = vi.hoisted(() => ({
  schoolDayRow: null as { date: string } | null,  // what the school-day lookup returns
  inserts:      [] as Record<string, unknown>[],
  deletes:      0,
}))

vi.mock('./db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(dbState.schoolDayRow ? [dbState.schoolDayRow] : []),
        }),
      }),
    }),
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        onConflictDoNothing: () => { dbState.inserts.push(v); return Promise.resolve() },
      }),
    }),
    delete: () => ({
      where: () => { dbState.deletes++; return Promise.resolve() },
    }),
  },
}))
vi.mock('./tenant', () => ({ getTenantBySlug: vi.fn() }))

import { setTeacherVacation } from './teacher-vacation-mark'
import { usePorts } from '../ports'
import { fakePorts } from '../ports-fake'

beforeEach(() => {
  // The school's day types come from its rules (an invented school's).
  usePorts(fakePorts())
  dbState.schoolDayRow = null
  dbState.inserts = []
  dbState.deletes = 0
})

describe('setTeacherVacation', () => {
  test('refuses a date that is not a school day — nothing written', async () => {
    dbState.schoolDayRow = null
    const res = await setTeacherVacation('t1', 'p1', '2026-09-21', true)
    expect(res).toEqual({ error: '2026-09-21 is not a school day' })
    expect(dbState.inserts).toHaveLength(0)
    expect(dbState.deletes).toBe(0)
  })

  test('marks a school day: one insert, conflict-safe', async () => {
    dbState.schoolDayRow = { date: '2026-09-19' }
    const res = await setTeacherVacation('t1', 'p1', '2026-09-19', true)
    expect(res).toBeUndefined()
    expect(dbState.inserts).toEqual([{ tenantId: 't1', personId: 'p1', date: '2026-09-19' }])
    expect(dbState.deletes).toBe(0)
  })

  test('unmarks a school day: one delete, no insert', async () => {
    dbState.schoolDayRow = { date: '2026-09-19' }
    const res = await setTeacherVacation('t1', 'p1', '2026-09-19', false)
    expect(res).toBeUndefined()
    expect(dbState.inserts).toHaveLength(0)
    expect(dbState.deletes).toBe(1)
  })

  test('unmarking a non-school-day still refuses — the door is symmetric', async () => {
    dbState.schoolDayRow = null
    const res = await setTeacherVacation('t1', 'p1', '2026-12-25', false)
    expect(res).toEqual({ error: '2026-12-25 is not a school day' })
    expect(dbState.deletes).toBe(0)
  })
})
