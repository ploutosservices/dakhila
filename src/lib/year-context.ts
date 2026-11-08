// A TENANT'S YEAR RULES through the ports: the school's calendar rules (the tenants port's `rules`) and its zone (its
// row), read at a door's entry and passed down to the pure year arithmetic (years.ts). The `…Of` helpers answer one
// year at the clock's instant for a door that needs only that.
import { ports } from '../ports'
import { currentAcademicYear, enrollmentYear, isWithinEnrollmentWindow, localDateStr, type YearRules } from './years'

export async function yearRules(tenantId: string): Promise<YearRules> {
  const [rules, tenant] = await Promise.all([ports().tenants.rules(tenantId), ports().tenants.byId(tenantId)])
  if (!tenant) throw new Error(`no live tenant ${tenantId}`)
  return { calendar: rules.calendar, timezone: tenant.timezone }
}

/** The tenant's enrollment year now. */
export async function enrollmentYearOf(tenantId: string): Promise<number> {
  return enrollmentYear(await yearRules(tenantId), ports().clock.now())
}

/** The tenant's academic year in session now. */
export async function academicYearOf(tenantId: string): Promise<number> {
  return currentAcademicYear(await yearRules(tenantId), ports().clock.now())
}

/** Today in the tenant's zone, "YYYY-MM-DD". */
export async function todayOf(tenantId: string): Promise<string> {
  return localDateStr(await yearRules(tenantId), ports().clock.now())
}

/** Whether the tenant's enrollment window is open now. */
export async function enrollmentWindowOpenOf(tenantId: string): Promise<boolean> {
  return isWithinEnrollmentWindow(await yearRules(tenantId), ports().clock.now())
}
