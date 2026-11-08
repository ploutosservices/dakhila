import { describe, it, expect, vi } from 'vitest'

vi.mock('./db', () => ({ db: {} }))
vi.mock('./family-recipients', () => ({ familyRecipients: async () => [] }))

import { eventFieldsRefusal } from './events'

const ok = { title: 'Example event', date: '2026-10-08', startTime: '18:30', endTime: '19:30', place: null, notes: null, payUntil: null }

describe('eventFieldsRefusal', () => {
  it('passes a whole event, and one with no times', () => {
    expect(eventFieldsRefusal(ok)).toBeNull()
    expect(eventFieldsRefusal({ ...ok, startTime: null, endTime: null })).toBeNull()
  })
  it('refuses each missing or malformed field by name', () => {
    expect(eventFieldsRefusal({ ...ok, title: '  ' })).toMatch(/title/)
    expect(eventFieldsRefusal({ ...ok, date: '10/08/2026' })).toMatch(/date/)
    expect(eventFieldsRefusal({ ...ok, startTime: '6:30pm' })).toMatch(/start time/)
    expect(eventFieldsRefusal({ ...ok, endTime: '18:00' })).toMatch(/ends before it starts/)
  })
})

describe('the last paying day', () => {
  it('takes a date or nothing', () => {
    expect(eventFieldsRefusal({ ...ok, payUntil: '2026-11-15' })).toBeNull()
    expect(eventFieldsRefusal({ ...ok, payUntil: 'Nov 15' })).toBe('The last paying day is a date.')
  })
})
