// The per-family enrollment status vocabulary — roster_family_tracker.enrollment_status.
//
// ONE HOME, and it is the school's: the codes are stored values (never renumbered), and their labels and the groups the
// screens filter by are the school's rules (SchoolRules.codes.enrollmentStatus).
// Every reader asks here with the rules it was handed, so the export, the family read and the chatbot never disagree
// about the same family.
import type { SchoolRules } from '../ports'

export type StatusCodes = Pick<SchoolRules['codes'], 'enrollmentStatus'>

/** How the screens group the codes when filtering families. */
export type EnrollmentStatusGroup = 'enrolled' | 'pending' | 'declined'

/** The groups, by name: every code belongs to exactly one; the school's codes must keep that true. */
export function enrollmentStatusGroups(codes: StatusCodes): Record<EnrollmentStatusGroup, readonly number[]> {
  const s = codes.enrollmentStatus
  return { enrolled: s.enrolled, pending: s.pending, declined: s.declined }
}

// A status code's label. Unknown codes render as the bare code rather than blank — a value
// the database holds is never hidden just because the rules have not caught up.
export function enrollmentStatusLabel(codes: StatusCodes, code: number | null | undefined): string {
  if (code == null) return '—'
  return codes.enrollmentStatus.labels[code] ?? String(code)
}
