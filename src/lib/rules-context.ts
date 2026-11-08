// A TENANT'S SCHOOL RULES through the ports (the tenants port's `rules`), read
// once at a door's entry and passed down. The years and the fee have their own readers (year-context.ts,
// fee-context.ts), which add the tenant's zone.
import { ports, type SchoolRules } from '../ports'
import { byName } from './zoned'

export function tenantRules(tenantId: string): Promise<SchoolRules> {
  return ports().tenants.rules(tenantId)
}

/** The tenant's calendar rules. */
export async function calendarRules(tenantId: string): Promise<SchoolRules['calendar']> {
  return (await tenantRules(tenantId)).calendar
}

/** The tenant's phone rule. */
export async function phoneRules(tenantId: string): Promise<SchoolRules['locale']['phone']> {
  return (await tenantRules(tenantId)).locale.phone
}

/** The tenant's order for people's names and other words: its language's collation (SchoolRules.locale.language). */
export async function nameOrder(tenantId: string): Promise<(a: string, b: string) => number> {
  return byName((await tenantRules(tenantId)).locale.language)
}

/** The tenant's course rules. */
export async function courseRules(tenantId: string): Promise<SchoolRules['courses']> {
  return (await tenantRules(tenantId)).courses
}
