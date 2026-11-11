// THE ROUTE TABLE: each operation names its method and path, the
// permission it asks (or that it is a public door), its body and its answer's shape. The server serves from it and
// the contract script writes the contract from it, so the task list and who may do it are read from one place,
// the code that enforces them. Each noun's operations live in their own file and are gathered here.
import type { IncomingHttpHeaders } from 'node:http'
import type { Permission } from './access-rule'
import type { Store } from './store'
import type { Actor } from './ports'
import type { Tenant } from './lib/tenant'
import type { Caller } from './access'
import type { RunName } from './runs'
import { FAMILY_ROUTES } from './families'
import { ENROLLMENT_ROUTES } from './enrollment'
import { BURSAR_ROUTES } from './bursar'
import { PAYPAL_ROUTES } from './paypal'
import { DONATE_ROUTES } from './donate'
import { GENEALOGY_ROUTES } from './genealogy'
import { FAMILY_ACT_ROUTES } from './family-acts'
import { FAMILY_READ_ROUTES } from './family-reads'
import { PERSON_ACT_ROUTES } from './person-acts'
import { PERSON_READ_ROUTES } from './person-reads'
import { FOLLOW_UP_ROUTES } from './follow-up'
import { TEXT_ROUTES } from './texts'
import { INTAKE_ROUTES } from './intake'
import { EXPORT_ROUTES } from './export'
import { NEWSLETTER_ROUTES } from './newsletters'
import { SESSION_ROUTES } from './session'
import { HELP_ROUTES } from './help'
import { DASHBOARD_ROUTES } from './dashboard'
import { CALENDAR_ROUTES } from './calendar'
import { VACATION_ROUTES } from './vacation'
import { CLASS_ROUTES } from './classes'
import { CLASSROOM_ROUTES } from './classroom'
import { CLASS_READ_ROUTES } from './class-reads'
import { UNIVERSE_ROUTES } from './universe'
import { CLASSROOM_READ_ROUTES } from './classroom-reads'
import { PLACEMENT_ROUTES } from './placement'
import { EVALUATION_ROUTES } from './evaluations'
import { EVENT_ROUTES } from './events'
import { VOLUNTEERING_ROUTES } from './volunteering'
import { EMAIL_GROUP_ROUTES } from './email-groups'
import { SEAM_ROUTES } from './seam'
import { RECORD_LINK_ROUTES } from './record-link'
import { HOST_READ_ROUTES } from './host-reads'
import { SEED_ROUTES } from './seeds'

export type Answer = { status: number; body: unknown }
export type Method = 'GET' | 'POST' | 'PUT' | 'DELETE'
export type Schema = Record<string, unknown>

/** One call as an operation sees it. `caller` is null on a public-door operation and for a run; `actor` is null on a
 *  public-door operation, and for a run names it (`{ verb: run, credential: subject }`). */
export type Call = {
  store: Store
  /** The path's tenant, as the configuration port answers it. */
  tenant: Tenant
  caller: Caller | null
  actor: Actor | null
  params: Record<string, string>
  /** The query string's parameters, each its first value; only those the route declares in `query`. */
  query: Record<string, string>
  body: unknown
  /** The body as it arrived: PayPal's signature is over these bytes. */
  raw: string
  headers: IncomingHttpHeaders
}
export type PersonCall = Call & { caller: Caller; actor: Actor }

export type Route = {
  method: Method
  path: string
  operationId: string
  summary: string
  /** The permission asked, as the contract states it; null when only `alsoAllowed` admits (the caller's own family). */
  permission: Permission | null
  /** Who else may, in words, for the contract — the rule itself is in `allowed`. */
  alsoAllowed?: string
  /** MARKED public-door: the host's certificate alone calls it, with no person; no permission or role. */
  publicDoor?: true
  /** The runs (runs.ts) that may call it with the host's certificate and the run header, and no person. `allowed` is
   *  never asked for a run: the handler limits what a run may ask. */
  runs?: readonly RunName[]
  /** A read that names the caller by the address the door verified and nothing else: admitted with no host user — the caller's userId is then '' and no act may be recorded. */
  addressOnly?: true
  allowed: (c: PersonCall) => Promise<boolean>
  /** Path parameters that are not ids (anything but `slug` is a uuid unless named here). */
  textParams?: string[]
  /** The optional query parameters the operation reads, each with its schema; any other is ignored. */
  query?: Record<string, Schema>
  /** The JSON body's schema; absent for a GET. */
  request?: Schema
  /** The body is passed through as bytes (PayPal's notice), not parsed. */
  rawBody?: true
  response: Schema
  handle: (c: Call) => Promise<Answer>
}

export const ROUTES: Route[] = [...FAMILY_ROUTES, ...ENROLLMENT_ROUTES, ...BURSAR_ROUTES, ...PAYPAL_ROUTES, ...DONATE_ROUTES, ...GENEALOGY_ROUTES, ...FAMILY_ACT_ROUTES, ...FAMILY_READ_ROUTES, ...PERSON_ACT_ROUTES, ...PERSON_READ_ROUTES, ...FOLLOW_UP_ROUTES, ...INTAKE_ROUTES, ...TEXT_ROUTES, ...EXPORT_ROUTES, ...NEWSLETTER_ROUTES, ...SESSION_ROUTES, ...HELP_ROUTES, ...DASHBOARD_ROUTES, ...CALENDAR_ROUTES, ...VACATION_ROUTES, ...CLASS_ROUTES, ...CLASSROOM_ROUTES, ...CLASS_READ_ROUTES, ...UNIVERSE_ROUTES, ...CLASSROOM_READ_ROUTES, ...PLACEMENT_ROUTES, ...EVALUATION_ROUTES, ...EVENT_ROUTES, ...VOLUNTEERING_ROUTES, ...EMAIL_GROUP_ROUTES, ...SEAM_ROUTES, ...RECORD_LINK_ROUTES, ...HOST_READ_ROUTES, ...SEED_ROUTES]

/** The route and its path parameters for a method and path, or null. */
export function match(method: string, path: string): { route: Route; params: Record<string, string> } | null {
  for (const route of ROUTES) {
    if (route.method !== method) continue
    const names: string[] = []
    const re = new RegExp('^' + route.path.replace(/\{(\w+)\}/g, (_, n: string) => { names.push(n); return '([^/]+)' }) + '$')
    const m = re.exec(path)
    if (m) return { route, params: Object.fromEntries(names.map((n, i) => [n, decodeURIComponent(m[i + 1])])) }
  }
  return null
}
