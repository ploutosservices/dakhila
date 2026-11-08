// A RECORD'S BIRTH AND REMOVAL IN THE HOST'S REGISTRY (ports.ts `records.birthId`, `records.dropIds`): the registry
// issues the id first, then the record is inserted under it; a record removed takes its registry id with it. Call each
// inside the transaction that inserts or removes the record, so neither half is left without the other.
import { ports, type Inserter, type Remover } from '../ports'

/** A new registry id of `type` in `tenantId`; it is the record's primary key. */
export async function birthId(tx: Inserter, type: string, tenantId: string): Promise<string> {
  return ports().records.birthId(tx, type, tenantId)
}

/** Remove the registry ids of records just removed; within `tenantId` when one is named. */
export async function dropIds(tx: Remover, ids: string[], tenantId?: string): Promise<void> {
  return ports().records.dropIds(tx, ids, tenantId)
}
