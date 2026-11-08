// THE YEAR ARITHMETIC'S LOGIC on an invented school (ports-fake.ts FAKE_RULES), in a zone that is not the server's.
// A real school's answers are its host's tests.
import { describe, expect, test } from 'vitest'
import { FAKE_RULES } from '../ports-fake'
import { currentAcademicYear, enrollmentYear, isWithinEnrollmentWindow, localDateStr, schoolYearBounds, schoolYearForDate, type YearRules } from './years'
import { buildCalendarGrid } from './calendar-types'

// The fake school: enrollment year from February, window February to before June, year starting April 1, classes on
// Saturdays in May, June and the next January. Berlin: +01:00 in winter, +02:00 from the end of March.
const y: YearRules = { calendar: FAKE_RULES.calendar, timezone: 'Europe/Berlin' }

describe('years turn on the school days in its zone', () => {
  test('the academic year turns at 00:00 April 1 in Berlin', () => {
    expect(currentAcademicYear(y, new Date('2026-03-31T21:59:00Z'))).toBe(2025)   // 23:59 March 31 in Berlin
    expect(currentAcademicYear(y, new Date('2026-03-31T22:01:00Z'))).toBe(2026)   // 00:01 April 1
  })
  test('the enrollment year turns in February, the window is February to May', () => {
    expect(enrollmentYear(y, new Date('2026-01-31T12:00:00Z'))).toBe(2025)
    expect(enrollmentYear(y, new Date('2026-02-01T12:00:00Z'))).toBe(2026)
    expect(isWithinEnrollmentWindow(y, new Date('2026-01-31T12:00:00Z'))).toBe(false)
    expect(isWithinEnrollmentWindow(y, new Date('2026-05-31T12:00:00Z'))).toBe(true)
    expect(isWithinEnrollmentWindow(y, new Date('2026-06-01T12:00:00Z'))).toBe(false)
  })
  test("today is the zone's day", () => {
    expect(localDateStr(y, new Date('2026-03-31T22:01:00Z'))).toBe('2026-04-01')
  })
  test('bounds, a day\'s year, and a year starting January 1', () => {
    expect(schoolYearBounds(y, 2026)).toEqual({ startDate: '2026-04-01', endDate: '2027-03-31' })
    expect(schoolYearForDate(y, '2026-03-31')).toBe(2025)
    expect(schoolYearForDate(y, '2026-04-01')).toBe(2026)
    const jan: YearRules = { ...y, calendar: { ...y.calendar, yearStarts: { month: 1, day: 1 } } }
    expect(schoolYearBounds(jan, 2026)).toEqual({ startDate: '2026-01-01', endDate: '2026-12-31' })
  })
})

describe('the grid follows the class months and weekday', () => {
  test('Saturdays of May and June, then the next January', () => {
    const grid = buildCalendarGrid(y.calendar, [], 2026, FAKE_RULES.locale.language)
    expect(grid.map(m => m.label)).toEqual(['Mai', 'Juni', 'Januar'])
    expect(grid[0].classDay).toBe('Sa')
    expect(grid.map(m => [m.year, m.month])).toEqual([[2026, 4], [2026, 5], [2027, 0]])
    expect(grid[0].days.map(d => d.date)).toEqual(['2026-05-02', '2026-05-09', '2026-05-16', '2026-05-23', '2026-05-30'])
    expect(grid[2].days[0].date).toBe('2027-01-02')
  })
})
