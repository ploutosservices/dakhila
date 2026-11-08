// Class times are RULE-BASED, not discretionary: every language class runs the school's language period, every culture
// class its culture period (SchoolRules.courses). A department outside the school's
// languages and culture department has NO ruling — creation must refuse, never guess.
//
// THE one language-department list is the school's `courses.languages`. Every consumer asks here; no file defines its
// own copy.
import type { SchoolRules } from '../ports'

/** The school's course rules, as the roster's code reads them. */
export type CourseRules = SchoolRules['courses']

export function isLanguageDepartment(courses: Pick<CourseRules, 'languages'>, department: string): boolean {
  return courses.languages.includes(department)
}

export type ClassTimes = { startTime: string; endTime: string }

export function classTimesForDepartment(courses: CourseRules, department: string): ClassTimes | null {
  const p = department === courses.cultureDepartment ? courses.periods.culture
    : isLanguageDepartment(courses, department) ? courses.periods.language
    : null
  return p ? { startTime: p.start, endTime: p.end } : null
}
