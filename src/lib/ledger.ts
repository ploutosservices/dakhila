// THE LEDGER, AS THE ROSTER BOOKS TO IT (ports.ts `ledger`): the tenant's account for a way of paying, a money movement
// booked under the registry id it was born with, its reference set, its removal, and entries read by id. Every write
// goes through the roster's own transaction, beside the roster's rows that name the entry.
import { ports, type Inserter, type Remover, type Updater, type LedgerEntry } from '../ports'

export type { LedgerEntry } from '../ports'

export async function accountFor(tenantId: string, method: string): Promise<string | null> {
  return ports().ledger.accountFor(tenantId, method)
}

/** The same account as a row ({ id }), or undefined when the tenant has none: what a booking names. */
export async function accountRow(tenantId: string, method: string): Promise<{ id: string } | undefined> {
  const id = await accountFor(tenantId, method)
  return id ? { id } : undefined
}

export async function bookEntry(tx: Inserter, entry: LedgerEntry): Promise<string> {
  return ports().ledger.book(tx, entry)
}

export async function setEntryReference(tx: Updater, tenantId: string, id: string, referenceId: string | null): Promise<void> {
  return ports().ledger.setReference(tx, tenantId, id, referenceId)
}

export async function removeEntry(tx: Remover, id: string, tenantId?: string): Promise<void> {
  return ports().ledger.remove(tx, id, tenantId)
}

export async function entriesByIds(ids: string[]): Promise<{ id: string; amount: string; paidAt: string | null }[]> {
  if (ids.length === 0) return []
  return ports().ledger.entries(ids)
}
