// A RECORD'S FIELD HISTORY, KEPT AND READ BY THE HOST (ports.ts `records.logChanges`, `records.changes`): each changed
// field with its old and new value, under the user who changed it.
import { ports, type RecordChange } from '../ports'

export type { RecordChange } from '../ports'

/** Keep the changed fields — field → [old, new] — of a record. Nothing is kept when nothing changed. */
export async function logChanges(recordId: string, changedBy: string | null, changes: Record<string, [unknown, unknown]>): Promise<void> {
  if (Object.keys(changes).length === 0) return
  return ports().records.logChanges(recordId, changedBy, changes)
}

/** A record's field history, newest first. */
export async function fieldHistory(recordId: string, limit: number): Promise<RecordChange[]> {
  return ports().records.changes(recordId, limit)
}

/** The host's users with these ids: name and sign-in address. */
export async function usersByIds(ids: string[]): Promise<{ id: string; name: string | null; email: string | null }[]> {
  return ports().records.usersByIds(ids)
}
