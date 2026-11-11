// The run caller (runs.ts): the caller checks (header, certificate, operation, run name) come before anything is read,
// and every request naming a run is logged. Nothing here reaches a store: an admitted run is tested against a running
// API by the host.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const HOST = 'CN=host@sample'
const OTHER_APP = 'CN=other-app@sample'
const OTHER_DEPLOYMENT = 'CN=host@elsewhere'

beforeAll(async () => {
  const { usePorts } = await import('./ports')
  const { fakePorts } = await import('./ports-fake')
  const base = fakePorts({})
  usePorts({
    ...base,
    identity: {
      ...base.identity,
      hostApplication: 'host',
      applicationOf: s => /^CN=([^@]+)@/.exec(s)![1],
      deploymentOf: s => /@(.+)$/.exec(s)![1],
      ownDeployment: () => 'sample',
    },
  })
})
afterEach(() => vi.restoreAllMocks())

const call = async (path: string, headers: Record<string, string>, method = 'GET') => {
  const { answer } = await import('./server')
  return answer({ method, url: path, headers, raw: '' })
}
const as = (run: string, subject: string | null = HOST) => ({ 'x-run': run, ...(subject ? { 'x-client-identity': subject } : {}) })
const LINKS = '/v1/tenants/school/roster/classroom/links'

describe('a run is refused before anything is read', () => {
  it('a bearer beside the run header is 400', async () => {
    expect((await call(LINKS, { ...as('course-links'), authorization: 'Bearer x' })).status).toBe(400)
  })
  it('a repeated run header (joined with a comma) is 400', async () => {
    expect((await call(LINKS, as('course-links, seed'))).status).toBe(400)
  })
  it('no certificate, another application, another deployment: 403', async () => {
    for (const s of [null, OTHER_APP, OTHER_DEPLOYMENT]) expect((await call(LINKS, as('course-links', s))).status).toBe(403)
  })
  it('a public-door operation is 403', async () => {
    const { ROUTES } = await import('./routes')
    const door = ROUTES.find(r => r.publicDoor && r.method === 'GET')!
    const path = door.path.replace(/\{(\w+)\}/g, (_, n: string) => n === 'slug' ? 'school' : 'not-an-id')
    expect((await call(path, as('course-links'))).status).toBe(403)
  })
  it('an unlisted name is 403', async () => {
    expect((await call(LINKS, as('anything'))).status).toBe(403)
  })
  it('every run, on every operation that does not name it, is 403', async () => {
    const { ROUTES } = await import('./routes')
    const { RUNS } = await import('./runs')
    for (const run of RUNS) {
      for (const r of ROUTES.filter(r => !r.runs?.includes(run))) {
        const path = r.path.replace(/\{(\w+)\}/g, (_, n: string) => n === 'slug' ? 'school' : '00000000-0000-0000-0000-000000000000')
        const a = await call(path, as(run), r.method)
        expect(a.status, `${run} on ${r.operationId}`).toBe(403)
      }
    }
  })
})

describe('the log', () => {
  it('writes one line per run request, naming the run, the operation and the answer', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await call(LINKS, as('seed'))
    await call(LINKS, as('nobody-knows'))
    await call('/v1/no/such/path', as('seed'))
    const lines = log.mock.calls.map(c => String(c[0])).filter(l => l.startsWith('[dakhila] run '))
    expect(lines[0]).toMatch(/^\[dakhila\] run seed classroom\.links 403 \d+ms$/)
    expect(lines[1]).toMatch(/^\[dakhila\] run unlisted classroom\.links 403 \d+ms$/)
    expect(lines[2]).toMatch(/^\[dakhila\] run seed - 404 \d+ms$/)
  })
  it('writes nothing for a call with no run header', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await call(LINKS, {}).catch(() => null)
    expect(log.mock.calls.some(c => String(c[0]).startsWith('[dakhila] run '))).toBe(false)
  })
})

describe('the seeds admit no person', () => {
  it('each seed operation is run-only', async () => {
    const { ROUTES } = await import('./routes')
    const seeds = ROUTES.filter(r => r.operationId.startsWith('seed.'))
    expect(seeds.length).toBe(3)
    for (const r of seeds) {
      expect(r.permission).toBeNull()
      expect(r.runs).toEqual(['seed'])
      expect(await r.allowed({} as never)).toBe(false)
    }
  })
})
