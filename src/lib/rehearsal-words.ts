// A REHEARSAL'S DAYS AND WORDS — pure, apart from rehearsal.ts (which re-exports them) so the mails and the readers that
// only say a date reach no roster read. Dates and times are written in the school's language (SchoolRules.locale).
import { isoDayIn, longDayWords, timeWords } from './zoned'

export const fullName = (p: { firstName: string | null; lastName: string | null }) => [p.firstName, p.lastName].filter(Boolean).join(' ')

/** Today in the school's own timezone, as YYYY-MM-DD. */
const today = (timeZone: string, at: Date) => isoDayIn(at, timeZone)

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay()   // 0 Sunday … 6 Saturday

/** The school's rehearsal rule: classes meet on `classWeekday` (0 = Sunday), a rehearsal `rehearsalDaysBefore` days
 *  before. */
export type RehearsalDays = { classWeekday: number; rehearsalDaysBefore: number }

/** The first rehearsal day after today in the school's zone: the weekday `rehearsalDaysBefore` days before the class
 *  day. */
export function nextRehearsalDay(c: RehearsalDays, timeZone: string, at: Date): string {
  const t = today(timeZone, at)
  const target = (((c.classWeekday - c.rehearsalDaysBefore) % 7) + 7) % 7
  return addDays(t, ((target - weekday(t) + 7) % 7) || 7)
}

/** The performance: the first class day after the rehearsal. */
export function performanceDayAfter(c: RehearsalDays, date: string): string {
  return addDays(date, ((c.classWeekday - weekday(date) + 7) % 7) || 7)
}

/** A day in full in the school's language: weekday, month, day and year. */
export function longDate(date: string, language: string): string {
  return longDayWords(date, language)
}

/** A day in full and its start and end times, in the school's language. */
export function when(r: { date: string; startTime: string | null; endTime: string | null }, language: string): string {
  const clock = (t: string) => timeWords(t, language)
  return `${longDate(r.date, language)}${r.startTime ? `, ${clock(r.startTime)}${r.endTime ? `–${clock(r.endTime)}` : ''}` : ''}`
}
