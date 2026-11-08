import { describe, it, expect, vi } from 'vitest'

vi.mock('./db', () => ({ db: {} }))
vi.mock('./mail', () => ({ sendEmail: async () => '' }))
vi.mock('./google-calendar', () => ({ putRehearsalOnCalendar: async () => ({ made: false, statement: 'not made in this environment — Google Calendar: the invitation', to: [] }) }))

import { longDate, nextRehearsalDay, performanceDayAfter, rehearsalFieldsRefusal } from './rehearsal'
import { FAKE_RULES } from '../ports-fake'

// The invented school meets on Saturdays (6) and rehearses two days before: on Thursdays.
const C = FAKE_RULES.calendar
const ZONE = 'Europe/Berlin'

describe('nextRehearsalDay: the weekday rehearsalDaysBefore days before the class day, after today', () => {
  it('from Monday 2026-10-05 is that week\'s Thursday', () => {
    expect(nextRehearsalDay(C, ZONE, new Date('2026-10-05T10:00:00Z'))).toBe('2026-10-08')
  })
  it('on a rehearsal day is the one a week later', () => {
    expect(nextRehearsalDay(C, ZONE, new Date('2026-10-08T10:00:00Z'))).toBe('2026-10-15')
  })
  it('reads the day in the school\'s zone: 22:30Z Wednesday is already Thursday in Berlin', () => {
    expect(nextRehearsalDay(C, ZONE, new Date('2026-10-07T22:30:00Z'))).toBe('2026-10-15')
  })
  it('from Saturday is the coming one, across a month', () => {
    expect(nextRehearsalDay(C, ZONE, new Date('2026-10-31T10:00:00Z'))).toBe('2026-11-05')
  })
  it('follows the rule: a Monday school rehearsing four days before rehearses on Thursday', () => {
    expect(nextRehearsalDay({ classWeekday: 1, rehearsalDaysBefore: 4 }, ZONE, new Date('2026-10-05T10:00:00Z'))).toBe('2026-10-08')
  })
})

describe('performanceDayAfter: the first class day after the rehearsal', () => {
  it('Thursday 2026-10-08 → Saturday 2026-10-10', () => expect(performanceDayAfter(C, '2026-10-08')).toBe('2026-10-10'))
  it('a class day → the next class day', () => expect(performanceDayAfter(C, '2026-10-10')).toBe('2026-10-17'))
})

describe('longDate', () => {
  it('names the weekday in the school\'s language', () => expect(longDate('2026-10-08', FAKE_RULES.locale.language)).toBe('Donnerstag, 8. Oktober 2026'))
})

describe('rehearsalFieldsRefusal', () => {
  const ok = { date: '2026-10-08', performanceDate: '2026-10-10', startTime: '18:30', endTime: '19:30' }
  it('passes a whole rehearsal, and one with no times yet', () => {
    expect(rehearsalFieldsRefusal(ok)).toBeNull()
    expect(rehearsalFieldsRefusal({ ...ok, startTime: null, endTime: null })).toBeNull()
  })
  it('refuses a performance on or before the rehearsal', () => {
    expect(rehearsalFieldsRefusal({ ...ok, performanceDate: '2026-10-08' })).toMatch(/after the rehearsal/)
  })
  it('refuses an end before the start', () => {
    expect(rehearsalFieldsRefusal({ ...ok, endTime: '18:00' })).toMatch(/ends before/)
  })
})
