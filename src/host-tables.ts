// THE HOST'S TABLES THE ROSTER'S TABLES REFERENCE: a tenant, a user, a record id,
// the ledger's entries and accounts. The host registers its own before it builds DDL from the roster's tables
// (the host's schema does, at load); a reference is read only then. Held process-wide, as the ports are.
import type { AnyPgColumn } from 'drizzle-orm/pg-core'

type HostTable = { id: AnyPgColumn }
export type HostTables = {
  tenants: HostTable; users: HostTable; registry: HostTable; ledgerEntries: HostTable; ledgerAccounts: HostTable
}

const HELD = Symbol.for('roster.hostTables')
const held = globalThis as { [HELD]?: HostTables }

export function registerHostTables(t: HostTables): void {
  held[HELD] = t
}

export function hostTables(): HostTables {
  const t = held[HELD]
  if (!t) throw new Error('the roster\'s tables reference the host\'s, and the host has registered none (registerHostTables)')
  return t
}
