// The token check: each refusal it promises, and the one token it takes.
// The door is a stub: its discovery and key set answer from a key made here; nothing reaches the network.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { SignJWT, exportJWK, generateKeyPair, type JWTPayload } from 'jose'

const ISSUER = 'https://door.example.test/realms/sample'
let sign: (claims: JWTPayload, opts?: { alg?: string; issuer?: string }) => Promise<string>

beforeAll(async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256')
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' }
  const { usePorts } = await import('./ports')
  const { fakePorts } = await import('./ports-fake')
  usePorts(fakePorts({
    identity: {
      issuer: ISSUER, callerClient: 'host-app', hostApplication: 'host-app', certificateHeader: 'X-Client-Identity',
      viewHeaders: { viewedAs: 'X-Viewed-As', viewedAsName: 'X-Viewed-As-Name', impersonator: 'X-Impersonator' },
      runHeader: 'X-Run',
      roleClaims: { roster: ['grants.{audience}'], given: ['grants.everywhere'] },
      ownDeployment: () => 'sample', deploymentOf: () => 'sample', applicationOf: () => 'host-app',
    },
    host: { production: () => false, environment: () => 'test', page: (name, id) => `/school/${name}${id ? `/${id}` : ''}`, route: (name, id) => `/api/school/${name}${id ? `/${id}` : ''}`, smsCallbacks: () => false, bounded: (_call, run) => run(AbortSignal.timeout(5000)) },
  }))
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const u = String(input instanceof Request ? input.url : input)
    if (u.endsWith('/.well-known/openid-configuration')) return Response.json({ issuer: ISSUER, jwks_uri: `${ISSUER}/certs` })
    if (u.endsWith('/certs')) return Response.json({ keys: [jwk] })
    return new Response('no', { status: 404 })
  }))
  sign = async (claims, opts = {}) => new SignJWT(claims)
    .setProtectedHeader({ alg: opts.alg ?? 'RS256', kid: 'k1' })
    .setIssuer(opts.issuer ?? ISSUER).setIssuedAt().setExpirationTime('5m')
    .sign(privateKey)
})
afterAll(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

const good: JWTPayload = {
  aud: 'roster', azp: 'host-app', typ: 'Bearer', email: 'p@example.test', email_verified: true,
  grants: { roster: ['school:principal'], 'host-app': ['school:keeper'], everywhere: ['Overseer'] },
}

describe('verifyBearer', () => {
  it("takes the host's exchanged token and reads only the roster client's roles", async () => {
    const { verifyBearer } = await import('./token')
    const v = await verifyBearer(`Bearer ${await sign(good)}`)
    expect(v).toEqual({ email: 'p@example.test', roles: ['school:principal'], givenRoles: ['Overseer'] })
  })

  it.each([
    ['no bearer', async () => undefined, /no bearer/],
    ['another issuer, before any network call', async () => `Bearer ${await sign(good, { issuer: 'https://other.example.test/realms/sample' })}`, /placed issuer/],
    ['another audience', async () => `Bearer ${await sign({ ...good, aud: 'another-app' })}`, /verify/],
    ['another client exchanged it', async () => `Bearer ${await sign({ ...good, azp: 'another-app' })}`, /azp/],
    ['a sign-in id_token', async () => `Bearer ${await sign({ ...good, typ: 'ID' })}`, /typ/],
    ['an unverified address', async () => `Bearer ${await sign({ ...good, email_verified: false })}`, /not verified/],
    ['no address', async () => `Bearer ${await sign({ ...good, email: undefined })}`, /no email/],
  ])('refuses %s', async (_name, header, why) => {
    const { verifyBearer } = await import('./token')
    const v = await verifyBearer(await header())
    expect(v).toHaveProperty('refused')
    expect((v as { refused: string }).refused).toMatch(why)
  })
})
