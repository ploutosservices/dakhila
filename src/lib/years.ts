// THE SCHOOL'S YEARS, over its calendar rules (SchoolRules.calendar, handed in by the host), read in the tenant's own
// zone. Pure: it takes the rules as an argument (year-context.ts reads them through the ports).
//
// Two years, one integer each:
// - the ACADEMIC year N runs from the school's first day in N to the day before it in N+1 ("N–(N+1)"); classes,
//   evaluations and the calendar are stored under it. One first day, read everywhere; the module holds no
//   date of its own.
// - the ENROLLMENT year N starts in the school's enrollment month of N. Every enrollment made in it is for academic
//   year N, which is why an enrollment screen asks enrollmentYear(), never the year in session: between the
//   enrollment month and the first day, the year in session is still N-1.
// The enrollment WINDOW is open from its opening month to before its closing month; outside it there is no enrollment
// activity, and after it closes a year's enrollment is finished, though the academic year runs on.
import type { SchoolRules, YearDay } from '../ports'
import { beforeDay, dayBefore, partsIn } from './zoned'

/** What the year arithmetic reads: the school's calendar rules and its zone. */
export type YearRules = { calendar: SchoolRules['calendar']; timezone: string }

const iso = (year: number, d: YearDay) => `${year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`

/** The enrollment year at an instant. */
export function enrollmentYear(y: YearRules, at: Date): number {
  const p = partsIn(at, y.timezone)
  return p.month < y.calendar.enrollmentYearStartsIn ? p.year - 1 : p.year
}

/** The academic year in session at an instant. */
export function currentAcademicYear(y: YearRules, at: Date): number {
  const p = partsIn(at, y.timezone)
  return beforeDay(p.month, p.day, y.calendar.yearStarts) ? p.year - 1 : p.year
}

/** The academic year a calendar day ("YYYY-MM-DD", the date part read) belongs to. */
export function schoolYearForDate(y: YearRules, dateStr: string): number {
  const [year, month, day] = dateStr.slice(0, 10).split('-').map(Number)
  return beforeDay(month, day, y.calendar.yearStarts) ? year - 1 : year
}

/** The first and last day of academic year `startYear`. */
export function schoolYearBounds(y: YearRules, startYear: number): { startDate: string; endDate: string } {
  const first = y.calendar.yearStarts
  const last = dayBefore(first)
  // The last day falls in the next calendar year unless the year starts on January 1.
  return { startDate: iso(startYear, first), endDate: iso(beforeDay(last.month, last.day, first) ? startYear + 1 : startYear, last) }
}

/** Whether the enrollment window is open at an instant. */
export function isWithinEnrollmentWindow(y: YearRules, at: Date): boolean {
  const m = partsIn(at, y.timezone).month
  return m >= y.calendar.windowOpens && m < y.calendar.windowCloses
}

/** Today's date in the school's zone, "YYYY-MM-DD". */
export function localDateStr(y: { timezone: string }, at: Date): string {
  const p = partsIn(at, y.timezone)
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}
