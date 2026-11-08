// The type of a teacher in a class: lead, regular or backup — a label
// that helps the principal organize the teachers, never an input to a permission. Pure, so any reader imports it.
export const TEACHER_TYPES = ['lead', 'regular', 'backup'] as const
export type TeacherType = typeof TEACHER_TYPES[number]

export const isTeacherType = (v: unknown): v is TeacherType => TEACHER_TYPES.includes(v as TeacherType)

/** The mark beside a name in a list: ✦ lead, ☆ backup, nothing for regular. */
export function teacherMark(t: TeacherType | null | undefined): string {
  return t === 'lead' ? ' ✦' : t === 'backup' ? ' ☆' : ''
}

/** The word on a teacher's card: (Lead), (Backup), nothing for regular. */
export function teacherTypeWord(t: TeacherType | null | undefined): string {
  return t === 'lead' ? 'Lead' : t === 'backup' ? 'Backup' : ''
}
