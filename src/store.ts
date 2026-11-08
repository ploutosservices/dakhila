// THE ROSTER API'S STORE: the database pool the host hands in
// (ports.ts `pool`), under the API's own login. Made on first use, so importing this module stays free.
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import * as schema from './tables'
import { ports } from './ports'

/** The store: the roster's tables over the host's pool. */
export type Store = NodePgDatabase<typeof schema>

let made: { pool: unknown; store: Store } | null = null

/** The store over the pool the host handed in; a new pool (a test's) makes a new store. */
export function store(): Store {
  const { pool } = ports()
  if (made?.pool !== pool) made = { pool, store: drizzle(pool, { schema }) }
  return made.store
}
