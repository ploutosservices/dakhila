// THE ROSTER API. One process behind the deployment's reverse proxy,
// which verifies client certificates and overwrites the subject header on every request. It
// answers with data only, in the roster's shapes (`/v1/`, errors `{ error, code }`).
//
//   /api/health   open: no credential, the door's state inside it (for a health check)
//   /v1/...       the route table (routes.ts). Two kinds of caller:
//                 a person — their door token exchanged for audience roster, the tenant in the path;
//                 the host's public doors — no token, and the certificate header naming the host application of this API's own deployment:
//                 the operations MARKED public-door, and no other. A certificate of another deployment is refused.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { chmodSync, rmSync } from 'node:fs'
import { getTenantBySlug } from './lib/tenant'
import { ports, type Actor } from './ports'
import { store as storeOf } from './store'
import { verifyBearer, doorReachable } from './token'
import { callerIn, may, userOf } from './access'
import { match, type PersonCall } from './routes'
import { BodyRefused } from './op'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** A body larger than this is refused: no operation takes more than a form or one PayPal notice. */
const MAX_BODY = 1 << 20

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

const fail = (code: string, error: string) => ({ error, code })

export type Request = { method: string; url: string; headers: IncomingMessage['headers']; raw: string }

/** Whether the certificate header names the host application of this API's own deployment: the one application whose
 *  certificate opens the public-door operations, and whose headers name view-as and impersonation. Anything unreadable is no. */
export function isHostHere(subject: string | undefined): boolean {
  if (!subject) return false
  const id = ports().identity
  try {
    return id.applicationOf(subject) === id.hostApplication && id.deploymentOf(subject) === id.ownDeployment()
  } catch {
    return false
  }
}

function header(req: Request, name: string): string | undefined {
  const v = req.headers[name.toLowerCase()]
  return Array.isArray(v) ? v[0] : v
}

function bodyOf(req: Request, raw: boolean): { ok: true; body: unknown } | { ok: false } {
  if (raw || req.method === 'GET') return { ok: true, body: null }
  if (!req.raw) return { ok: true, body: null }
  try { return { ok: true, body: JSON.parse(req.raw) } } catch { return { ok: false } }
}

export async function answer(req: Request): Promise<{ status: number; body: unknown }> {
  const path = new URL(req.url || '/', 'http://roster.invalid').pathname
  if (path === '/api/health') {
    const door = await doorReachable()
    return { status: 200, body: { status: 'ok', door: door ? 'discovery read' : 'not reached' } }
  }
  const hit = match(req.method, path)
  if (!hit) return { status: 404, body: fail('not_found', 'no such operation') }
  const { route, params } = hit
  // The query parameters the route declares, each its first value; nothing else is read.
  const asked = new URL(req.url || '/', 'http://roster.invalid').searchParams
  const query: Record<string, string> = {}
  for (const name of Object.keys(route.query ?? {})) { const v = asked.get(name); if (v !== null) query[name] = v }
  // A malformed id is no record — answered after who-may for a person (below), so a caller without the permission
  // hears 403 first: who may is asked before anything is read.
  const malformed = Object.entries(params).some(([n, v]) => n !== 'slug' && !UUID.test(v) && !route.textParams?.includes(n))
  if (malformed && route.publicDoor) return { status: 404, body: fail('not_found', 'no such record') }
  const parsed = bodyOf(req, route.rawBody === true)
  if (!parsed.ok) return { status: 400, body: fail('bad_request', 'the body is not JSON') }

  const store = storeOf()
  const subject = header(req, ports().identity.certificateHeader)
  const host = isHostHere(subject)
  const tenant = await getTenantBySlug(params.slug)

  // A caller with no person: the host's public doors, on the operations marked so.
  if (!req.headers.authorization) {
    if (route.publicDoor && host) {
      if (!tenant) return { status: 404, body: fail('not_found', 'no such tenant') }
      // No person: each public operation names its own act's page and event.
      try {
        return await route.handle({ store, tenant, caller: null, actor: null, params, query, body: parsed.body, raw: req.raw, headers: req.headers })
      } catch (e) {
        if (e instanceof BodyRefused) return { status: 400, body: fail('bad_request', e.message) }
        throw e
      }
    }
    console.error(`[dakhila] 401 ${route.operationId}: no bearer${subject ? ` (certificate ${subject})` : ''}`)
    if (subject && !host && route.publicDoor) return { status: 403, body: fail('forbidden', `${subject} may not call ${route.operationId}`) }
    return { status: 401, body: fail('unauthenticated', 'a door token exchanged for audience roster is required') }
  }
  if (route.publicDoor) return { status: 403, body: fail('forbidden', `${route.operationId} is the host's public door: no person calls it`) }

  const v = await verifyBearer(req.headers.authorization)
  if ('refused' in v) {
    console.error(`[dakhila] 401 ${route.operationId}: ${v.refused}${subject ? ` (certificate ${subject})` : ''}`)
    return { status: 401, body: fail('unauthenticated', 'a door token exchanged for audience roster is required') }
  }
  const user = await userOf(v.email)
  // An address-only read admits a verified address with no host user: a public
  // caller's visitors reading their own record. Every other operation still refuses one.
  if (!user && !route.addressOnly) {
    console.error(`[dakhila] 401 ${route.operationId}: the signed-in address is no user of the host`)
    return { status: 401, body: fail('unauthenticated', 'the signed-in address is not a user here') }
  }
  if (!tenant) return { status: 404, body: fail('not_found', 'no such tenant') }
  const caller = await callerIn(store, v, user?.id ?? null, tenant)
  // View-as and impersonation are the host's session state, believed only beside the host's certificate.
  const view = ports().identity.viewHeaders
  const viewedAsId = host ? header(req, view.viewedAs.toLowerCase()) : undefined
  const viewedAsName = host ? header(req, view.viewedAsName.toLowerCase()) : undefined
  const actor: Actor = {
    person: {
      userId: user?.id ?? '',
      name: user?.name ?? v.email,
      impersonator: (host ? header(req, view.impersonator.toLowerCase()) : undefined) ?? null,
      viewedAs: viewedAsId ? { userId: viewedAsId, name: viewedAsName ?? viewedAsId } : null,
    },
  }
  const call: PersonCall = { store, tenant, caller, actor, params, query, body: parsed.body, raw: req.raw, headers: req.headers }
  if (malformed) {
    return route.permission && !may(caller, route.permission)
      ? { status: 403, body: fail('forbidden', `${route.operationId} asks ${route.permission}`) }
      : { status: 404, body: fail('not_found', 'no such record') }
  }
  try {
    if (!await route.allowed(call)) {
      return { status: 403, body: fail('forbidden', `${route.operationId} asks ${route.permission ?? route.alsoAllowed ?? 'what its contract says'}`) }
    }
    return await route.handle(call)
  } catch (e) {
    if (e instanceof BodyRefused) return { status: 400, body: fail('bad_request', e.message) }
    throw e
  }
}

function read(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > MAX_BODY) { resolve(null); req.destroy(); return }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** Start listening where the host says (ports.ts `listen`): a unix socket the proxy alone may open, or a loopback
 *  port — the proxy is the one way in either way. index.ts `start` calls it. */
export function listen(): void {
  const server = createServer((req, res) => {
    read(req).then(raw => {
      if (raw === null) return send(res, 413, fail('too_large', 'the body is larger than any operation takes'))
      return answer({ method: req.method ?? 'GET', url: req.url ?? '/', headers: req.headers, raw })
        .then(a => send(res, a.status, a.body))
    }).catch(e => {
      // The failure's own words travel: a family's capture shows the payment vendor's refusal, a run's verdict names
      // it. The stack stays in the log.
      console.error(`[dakhila] 500 ${req.method} ${req.url}: ${(e as Error).stack ?? e}`)
      send(res, 500, fail('internal', e instanceof Error ? e.message : String(e)))
    })
  })
  const where = ports().listen
  if ('socket' in where) {
    const { socket } = where
    // A socket left by a stopped process refuses the bind; the path and its directory are the deployment's to choose.
    rmSync(socket, { force: true })
    server.listen(socket, () => {
      // Owner and group read and write: the group is the reverse proxy's, nobody else's.
      chmodSync(socket, 0o660)
      console.log(`[dakhila] listening on ${socket}`)
    })
    return
  }
  const { port } = where
  server.listen(port, '127.0.0.1', () => console.log(`[dakhila] listening on 127.0.0.1:${port}`))
}
