// A TENANT'S FEE CONTEXT through the ports: the school's fee rules and currency (the tenants port's `rules`) and its
// zone (its row), read once at a door's entry and passed down to the pure fee engine (fees.ts).
import { ports } from '../ports'
import { moneyRules, type FeeContext } from './fees'

export async function feeContext(tenantId: string): Promise<FeeContext> {
  const [rules, tenant] = await Promise.all([ports().tenants.rules(tenantId), ports().tenants.byId(tenantId)])
  if (!tenant) throw new Error(`no live tenant ${tenantId}`)
  return { fees: rules.fees, ...moneyRules(rules), timezone: tenant.timezone, language: rules.locale.language }
}
