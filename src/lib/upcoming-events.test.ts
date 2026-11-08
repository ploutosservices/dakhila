import { describe, it, expect } from 'vitest'
import { buildFeed, type EventRow } from './upcoming-events'
import { FAKE_RULES } from '../ports-fake'

const row = (r: Partial<EventRow> & { date: string; eventType: number }): EventRow => ({
  description: null, startTime: null, endTime: null, typeName: null, classShortCode: null, ...r,
})

// An invented school's event types (ports-fake.ts) and its name for the school day.
const TYPES      = { ...FAKE_RULES.calendar.eventTypes, schoolDayName: 'Class Day', upcomingCount: FAKE_RULES.calendar.feedUpcoming }
const SCHOOL_DAY = TYPES.schoolDay
const ACTIVITY   = TYPES.activity
const HOLIDAY    = TYPES.holiday

describe('buildFeed — today on top, next three at the bottom', () => {
  it('separates today from upcoming and never repeats today in upcoming', () => {
    const feed = buildFeed(TYPES, [
      row({ date: '2026-09-20', eventType: ACTIVITY, typeName: 'Activity', description: 'Opening Day' }),
      row({ date: '2026-09-27', eventType: SCHOOL_DAY, typeName: 'SchoolDay' }),
      row({ date: '2026-10-04', eventType: SCHOOL_DAY, typeName: 'SchoolDay' }),
      row({ date: '2026-10-11', eventType: SCHOOL_DAY, typeName: 'SchoolDay' }),
    ], '2026-09-20')

    expect(feed.today.map(e => e.label)).toEqual(['Activity: Opening Day'])
    expect(feed.upcoming.map(e => e.date)).toEqual(['2026-09-27', '2026-10-04', '2026-10-11'])
    expect(feed.today_date).toBe('2026-09-20')
  })

  it('returns an empty today block when nothing is dated today', () => {
    const feed = buildFeed(TYPES, [
      row({ date: '2026-09-27', eventType: ACTIVITY, typeName: 'Activity', description: 'Picnic' }),
    ], '2026-09-21')

    expect(feed.today).toEqual([])
    expect(feed.upcoming).toHaveLength(1)
  })

  it('caps upcoming at three events even when one date carries several', () => {
    const feed = buildFeed(TYPES, [
      row({ date: '2026-10-25', eventType: ACTIVITY, typeName: 'Activity', description: 'Lantern Walk' }),
      row({ date: '2026-10-25', eventType: 999, typeName: 'Costume' }),
      row({ date: '2026-10-25', eventType: SCHOOL_DAY, typeName: 'SchoolDay' }),
      row({ date: '2026-11-01', eventType: ACTIVITY, typeName: 'Activity', description: 'Fair' }),
      row({ date: '2026-11-08', eventType: HOLIDAY, typeName: 'Holiday', description: 'Founders Day' }),
    ], '2026-10-01')

    expect(feed.upcoming.map(e => e.label))
      .toEqual(['Activity: Lantern Walk', 'Costume', 'Activity: Fair'])
  })

  it('ignores anything dated before today', () => {
    const feed = buildFeed(TYPES, [
      row({ date: '2026-09-13', eventType: ACTIVITY, typeName: 'Activity', description: 'Past' }),
      row({ date: '2026-09-27', eventType: ACTIVITY, typeName: 'Activity', description: 'Future' }),
    ], '2026-09-20')

    expect(feed.today).toEqual([])
    expect(feed.upcoming.map(e => e.label)).toEqual(['Activity: Future'])
  })
})

// A date's character row never crowds out the events of that date.
describe('buildFeed — a day-character marker never displaces a named event', () => {
  it('drops the bare SchoolDay row on a date that has a named event', () => {
    const feed = buildFeed(TYPES, [
      row({ date: '2026-09-20', eventType: ACTIVITY, typeName: 'Activity', description: 'Opening Day' }),
      row({ date: '2026-09-20', eventType: SCHOOL_DAY, typeName: 'SchoolDay' }),
    ], '2026-09-20')

    expect(feed.today).toHaveLength(1)
    expect(feed.today[0].label).toBe('Activity: Opening Day')
    // …but the date's character still rides along, so the renderer knows there is class.
    expect(feed.today[0].isSchoolDay).toBe(true)
  })

  it('announces a plain school day once, under the school\'s name for it', () => {
    const feed = buildFeed(TYPES, [
      row({ date: '2026-09-27', eventType: SCHOOL_DAY, typeName: 'SchoolDay' }),
    ], '2026-09-27')

    expect(feed.today).toHaveLength(1)
    expect(feed.today[0].type).toBe('Class Day')
    expect(feed.today[0].label).toBe('Class Day')
  })

  it('flags a holiday on every event of that date', () => {
    const feed = buildFeed(TYPES, [
      row({ date: '2026-11-08', eventType: HOLIDAY, typeName: 'Holiday', description: 'Founders Day' }),
    ], '2026-11-08')

    expect(feed.today[0].isHoliday).toBe(true)
    expect(feed.today[0].isSchoolDay).toBe(false)
    expect(feed.today[0].label).toBe('Holiday: Founders Day')
  })
})

describe('buildFeed — the wire format its consumer renders against', () => {
  it('prints the stored date verbatim and marks an untimed event all-day', () => {
    const feed = buildFeed(TYPES, [
      row({ date: '2027-01-24', eventType: 998, typeName: 'Recital', classShortCode: 'X2' }),
    ], '2027-01-24')

    const e = feed.today[0]
    expect(e.date).toBe('2027-01-24')      // never a converted instant
    expect(e.allDay).toBe(true)
    expect(e.startTime).toBeNull()
    expect(e.endTime).toBeNull()
    expect(e.classShortCode).toBe('X2')
    expect(e.label).toBe('Recital — X2')
  })

  it('carries the times through and is not all-day when a start time exists', () => {
    const feed = buildFeed(TYPES, [
      row({ date: '2027-01-24', eventType: ACTIVITY, typeName: 'Activity',
            description: 'Rehearsal', startTime: '10:00', endTime: '12:00' }),
    ], '2027-01-24')

    const e = feed.today[0]
    expect(e.allDay).toBe(false)
    expect(e.startTime).toBe('10:00')
    expect(e.endTime).toBe('12:00')
  })

  it('an empty-string time from the roster reads as all-day, not as a time', () => {
    const feed = buildFeed(TYPES, [
      row({ date: '2027-01-24', eventType: ACTIVITY, typeName: 'Activity', startTime: '', endTime: '' }),
    ], '2027-01-24')

    expect(feed.today[0].allDay).toBe(true)
    expect(feed.today[0].startTime).toBeNull()
  })
})
