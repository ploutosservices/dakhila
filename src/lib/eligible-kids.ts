// WHICH KIDS OF A FAMILY MAY ENROLL IN A SCHOOL YEAR — one rule, read by the enrollment invitation (which names
// them) and the tracker's column (which lists them).
//
// One rule, so a second copy is never a second answer: a boy or girl with a first-grade year whose grade that year is
// from the school's first enrolled grade through its last (SchoolRules.courses.grades enrollsFrom and last).

import { gradeLevel } from './enrollment'

export type KidCandidate = { role: string | null; firstGradeYear: number | null }
/** The grades a school enrolls: SchoolRules.courses.grades, or the two fields of it this rule reads. */
export type EnrolledGrades = { enrollsFrom: number; last: number }

/** Whether a grade is one the school enrols: its first enrolled grade through its last grade. */
export function enrollableGrade(g: number, grades: EnrolledGrades): boolean {
  return g >= grades.enrollsFrom && g <= grades.last
}

export function isEligibleToEnroll(p: KidCandidate, year: number, grades: EnrolledGrades): boolean {
  if (p.role !== 'boy' && p.role !== 'girl') return false
  if (!p.firstGradeYear) return false
  return enrollableGrade(gradeLevel(year, p.firstGradeYear), grades)
}

/** The eligible kids, oldest first (earliest first-grade year) — the order the invitation names them in. */
export function eligibleKids<T extends KidCandidate>(members: T[], year: number, grades: EnrolledGrades): T[] {
  return members
    .filter(m => isEligibleToEnroll(m, year, grades))
    .sort((a, b) => (a.firstGradeYear ?? 0) - (b.firstGradeYear ?? 0))
}
