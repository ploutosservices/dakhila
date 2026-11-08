// THE PEOPLE A REFUSAL NAMES, by their own names.
//
// A rejection reading "family_enrollment_students.student_id names person 00000000-0000-…" tells
// a reader nothing about who it is. The run carries ids because ids are
// what the roster rows hold; a person reading the refusal needs the name.
//
// It reads the persons WITHOUT the live filter on purpose: every interesting case here is a person
// who is removed, and filtering them out would leave exactly the rows the reader is trying to identify
// anonymous.
import { db } from './db'
import { persons } from '../tables'
import { and, eq, inArray } from 'drizzle-orm'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Field names that hold a PERSON. Anything else carrying a uuid is left as it is. */
const PERSON_KEYS = ['studentId', 'student_id', 'personId', 'person_id', 'motherId', 'mother_id', 'fatherId', 'father_id']

function idsIn(row: unknown, out: Set<string>): void {
  if (!row || typeof row !== 'object') return
  for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
    if (typeof v === 'string' && UUID.test(v) && PERSON_KEYS.includes(k)) out.add(v)
  }
}

export async function namesForRejections(
  tenantId: string,
  rejections: readonly { row: unknown; coRows?: unknown[] }[],
): Promise<Record<string, string>> {
  const ids = new Set<string>()
  for (const r of rejections) {
    idsIn(r.row, ids)
    for (const c of r.coRows ?? []) idsIn(c, ids)
  }
  if (ids.size === 0) return {}
  const rows = await db
    .select({ id: persons.id, firstName: persons.firstName, lastName: persons.lastName, deletedAt: persons.deletedAt })
    .from(persons)
    .where(and(eq(persons.tenantId, tenantId), inArray(persons.id, [...ids])))
  return Object.fromEntries(rows.map(r => [
    r.id,
    [r.firstName, r.lastName].filter(Boolean).join(' ') + (r.deletedAt ? ' (removed)' : ''),
  ]))
}
