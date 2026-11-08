// A FORM'S FIELDS AS PLAIN DATA: a door reads its FormData into these and sends them to the roster API. No store here,
// so a door that imports these reaches no write.

/** A form's fields as the door read them: each name to its value, a repeated name to its values in order. */
export type FormFields = Record<string, string | string[]>

/** The fields of a FormData, as the door sends them. A file is no field here. */
export function formFields(fd: FormData): FormFields {
  const out: FormFields = {}
  for (const [k, v] of fd.entries()) {
    if (typeof v !== 'string') continue
    const had = out[k]
    out[k] = had === undefined ? v : Array.isArray(had) ? [...had, v] : [had, v]
  }
  return out
}

/** One field's first value, as FormData.get answers it (null when absent). */
export function fieldOf(f: FormFields, key: string): string | null {
  const v = f[key]
  return v === undefined ? null : Array.isArray(v) ? v[0] ?? null : v
}

function str(f: FormFields, key: string): string | null {
  return (fieldOf(f, key) ?? '').trim() || null
}

function int(f: FormFields, key: string): number | null {
  const v = (fieldOf(f, key) ?? '').trim()
  const n = parseInt(v, 10)
  return isNaN(n) ? null : n
}

// THE PARENT FILLS THE FIRST GRADE YEAR; the roster does not decide it. A child saved without one is never eligible, and
// nothing would tell the family why, so it is refused. Checked before any write, so a refused form changes nothing; the
// door checks it first, before it asks.
export function childMissingFirstGradeYear(f: FormFields): string | null {
  const count = int(f, 'studentCount') ?? 0
  for (let i = 0; i < count; i++) {
    const firstName = str(f, `student_${i}_firstName`)
    if (firstName && int(f, `student_${i}_firstGradeYear`) == null) return firstName
  }
  return null
}
