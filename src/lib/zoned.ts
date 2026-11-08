// DAYS IN THE TENANT'S ZONE, AND IN ITS LANGUAGE: every date rule of a school (SchoolRules) is read in the tenant's own
// time zone, never the server's, and every date or time a reader sees is written in the school's language
// (SchoolRules.locale.language), never a constant of the roster's.
import type { YearDay } from '../ports'

/** The locale the roster reads numbers out of a formatted date in: none of its own (`und`), Gregorian, Latin digits. A
 *  date parsed with it is never shown. */
const READ = 'und-u-ca-gregory-nu-latn'

/** An instant's calendar year, month (1-12), day and weekday (0 = Sunday) in `tz`. */
export function partsIn(at: Date, tz: string): { year: number; month: number; day: number; weekday: number } {
  const parts = new Intl.DateTimeFormat(READ, { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(at)
  const get = (t: string) => Number(parts.find(p => p.type === t)!.value)
  const year = get('year'), month = get('month'), day = get('day')
  return { year, month, day, weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay() }
}

/** An instant's calendar day in `tz`, "YYYY-MM-DD". */
export function isoDayIn(at: Date, tz: string): string {
  const { year, month, day } = partsIn(at, tz)
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** The zone's offset from UTC at an instant, in minutes (east positive). */
export function offsetMinutes(at: Date, tz: string): number {
  const name = new Intl.DateTimeFormat(READ, { timeZone: tz, timeZoneName: 'longOffset' }).formatToParts(at)
    .find(p => p.type === 'timeZoneName')!.value            // "GMT+hh:mm" or "GMT-hh:mm", or "GMT" at zero
  const m = name.match(/([+-])(\d{2}):(\d{2})/)
  return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0
}

/** The instant `year`-`day` starts (00:00) in `tz`. */
export function startOfDayIn(year: number, day: YearDay, tz: string): Date {
  const utc = Date.UTC(year, day.month - 1, day.day)
  const first = utc - offsetMinutes(new Date(utc), tz) * 60_000
  return new Date(utc - offsetMinutes(new Date(first), tz) * 60_000)
}

/** Whether a calendar (month, day) falls before a year-day. */
export function beforeDay(month: number, day: number, d: YearDay): boolean {
  return month < d.month || (month === d.month && day < d.day)
}

/** A formatted date or time as text: the narrow and no-break spaces some locale data puts in print as plain spaces. */
function plain(s: string): string {
  return s.replace(/[  ]/g, ' ')
}

/** A year-day (month and day) in the school's language. */
export function dayWords(d: YearDay, language: string): string {
  return plain(new Intl.DateTimeFormat(language, { timeZone: 'UTC', month: 'long', day: 'numeric' }).format(new Date(Date.UTC(2001, d.month - 1, d.day))))
}

/** A calendar day ("YYYY-MM-DD") in the school's language, in full: weekday, month, day and year. */
export function longDayWords(date: string, language: string): string {
  return plain(new Intl.DateTimeFormat(language, { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    .format(new Date(`${date}T00:00:00Z`)))
}

/** A time of day ("HH:MM") as the school's language writes it. */
export function timeWords(time: string, language: string): string {
  const [h, m] = time.split(':').map(Number)
  return plain(new Intl.DateTimeFormat(language, { timeZone: 'UTC', hour: 'numeric', minute: '2-digit' }).format(new Date(Date.UTC(2001, 0, 1, h, m))))
}

/** A month's name in the school's language (1 = January). */
export function monthWords(month: number, language: string): string {
  return new Intl.DateTimeFormat(language, { timeZone: 'UTC', month: 'long' }).format(new Date(Date.UTC(2001, month - 1, 1)))
}

/** A weekday's short name in the school's language (0 = Sunday). */
export function weekdayWords(weekday: number, language: string): string {
  return new Intl.DateTimeFormat(language, { timeZone: 'UTC', weekday: 'short' }).format(new Date(Date.UTC(2001, 0, 7 + weekday)))
}

/** Names in the school's language's order. */
export function byName(language: string): (a: string, b: string) => number {
  return new Intl.Collator(language).compare
}

/** Machine strings (ISO days, ids) in code-point order: no language decides it. */
export function byCode(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** The day before a year-day, in a year that is not a leap year's February 29 ("March 14" before "March 15", "the last of February" before "March 1"). */
export function dayBefore(d: YearDay): YearDay {
  if (d.day > 1) return { month: d.month, day: d.day - 1 }
  const month = d.month === 1 ? 12 : d.month - 1
  return { month, day: new Date(Date.UTC(2001, month, 0)).getUTCDate() }
}
