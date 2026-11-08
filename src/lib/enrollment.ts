// A CHILD'S GRADE AND AGE, and the school year's label. The years themselves are years.ts, the fee fees.ts, both over
// the school's rules. Every reader calls these functions; none computes them itself.
import type { SchoolRules } from '../ports'

/** The school's grade words and span (SchoolRules.courses.grades). */
export type Grades = SchoolRules['courses']['grades']

// The "YYYY–YY" label for a school year that starts in `year`.
export function schoolYearLabel(year: number): string {
  return `${year}–${String(year + 1).slice(-2)}`
}

// Grade level (1 = first grade) given the year the student entered first grade
// and the school year being examined. Returns 0 for the year before first grade, negative before that.
export function gradeLevel(schoolYear: number, firstGradeYear: number): number {
  return schoolYear - firstGradeYear + 1
}

// A child's grade as printed: the school's words before first grade (two years and more, then the year before), its
// number from 1 to the school's last grade, or the school's word for a child past it. One spelling for every screen —
// the family page and the department roster print the same word for the same child.
export function gradeLabel(grades: Grades, schoolYear: number, firstGradeYear: number | null): string {
  if (!firstGradeYear) return '—'
  return gradeWord(grades, gradeLevel(schoolYear, firstGradeYear))
}

// A grade level as printed (gradeLevel's numbering), by the same words as gradeLabel.
export function gradeWord(grades: Grades, g: number): string {
  if (g < 0) return grades.beforeKindergarten
  if (g === 0) return grades.kindergarten
  if (g > grades.last) return grades.past
  return String(g)
}

// A child's grade in the school year starting in `startYear`, in words for a sentence: a numbered grade is "grade N",
// a word is itself.
export function gradeInWords(grades: Grades, startYear: number, firstGradeYear: number): string {
  const g = gradeLabel(grades, startYear, firstGradeYear)
  return /^\d+$/.test(g) ? `grade ${g}` : g
}

// THE FIRST-GRADE YEAR AS A CHOICE OF AT MOST TWO, because the date of birth tells which grade a child goes into. A
// child born before the school's cutoff month starts first grade in the school year starting in the year they reach the
// school's first-grade age — one year. A child born in or after the cutoff month may start that year or the next — two
// years (SchoolRules.courses firstGradeAge, firstGradeCutoffMonth). Each is printed with the grade it gives in the
// school year starting in `startYear`. No birth date, no choices. A stored year that is not offered is not kept.
export function firstGradeYearChoices(
  courses: Pick<SchoolRules['courses'], 'firstGradeAge' | 'firstGradeCutoffMonth' | 'grades'>, startYear: number, birthDate: string | null,
): { year: number; label: string }[] {
  const born = birthDate ? Number(birthDate.slice(0, 4)) : NaN
  const month = birthDate ? Number(birthDate.slice(5, 7)) : NaN
  if (!Number.isInteger(born) || !Number.isInteger(month)) return []
  const first = born + courses.firstGradeAge
  const years = month < courses.firstGradeCutoffMonth ? [first] : [first, first + 1]
  return years.map(year => ({ year, label: `${year} — ${gradeInWords(courses.grades, startYear, year)} in ${courses.grades.startWord} ${startYear}` }))
}

/** Age in whole years on `today`, both "YYYY-MM-DD": the caller reads today in the tenant's zone (localDateStr). */
export function personAge(birthDate: string, today: string): number {
  const [by, bm, bd] = birthDate.slice(0, 10).split('-').map(Number)
  const [ty, tm, td] = today.slice(0, 10).split('-').map(Number)
  const notYetHadBirthday = tm < bm || (tm === bm && td < bd)
  return ty - by - (notYetHadBirthday ? 1 : 0)
}
