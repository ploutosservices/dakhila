// THE TOKEN CHECK. The bearer is a person's door token EXCHANGED for audience `roster` by the host's client.
// `iss` is the one placed issuer, checked before any network call; keys from that issuer's discovery document, RS256
// only, an unknown `kid` refetching the key set (jose's remote set does, once per cooldown); `exp` with 60 s leeway;
// `aud` roster; `azp` the host's client — a token any other client exchanged is refused; `typ` Bearer — a sign-in
// id_token never serves; `email_verified` true and `email` present. A door that cannot be reached is a refusal, never
// a 500; the reason goes to the log, never to the caller.
import { createRemoteJWKSet, decodeJwt, jwtVerify, type JWTPayload } from 'jose'
import { ports } from './ports'

/** The service's own name: the audience a token must be addressed to. The one client whose exchanged tokens it takes
 *  is the host's: ports.ts `identity.callerClient`. */
export const AUDIENCE = 'roster'

export type Verified = { email: string; roles: string[]; givenRoles: string[] }
export type Refusal = { refused: string }

let keys: ReturnType<typeof createRemoteJWKSet> | null = null
let discoveryRead = false

async function keySet(issuer: string): Promise<ReturnType<typeof createRemoteJWKSet>> {
  if (keys) return keys
  // Under the host's declared bound for a call to the door, as every outward call is.
  const doc = await ports().host.bounded('oidc', async signal => {
    const res = await fetch(`${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`, { signal })
    if (!res.ok) throw new Error(`discovery answered ${res.status}`)
    return await res.json() as { issuer?: string; jwks_uri?: string }
  })
  if (doc.issuer !== issuer || !doc.jwks_uri) throw new Error('discovery names another issuer or no jwks_uri')
  keys = createRemoteJWKSet(new URL(doc.jwks_uri), { timeoutDuration: 5000 })
  discoveryRead = true
  return keys
}

/** Whether the door's discovery has been read by this process — `/api/health` says it. */
export async function doorReachable(): Promise<boolean> {
  try { await keySet(ports().identity.issuer); return true } catch { return discoveryRead }
}

/** A claim at a dotted path, `{audience}` filled with the roster's audience; undefined where the path holds nothing. */
function claimAt(p: JWTPayload, path: string): unknown {
  return path.replace('{audience}', AUDIENCE).split('.')
    .reduce<unknown>((v, k) => (v !== null && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined), p)
}

/** The first of these claim paths that holds a value. */
function firstClaim(p: JWTPayload, paths: string[]): unknown {
  for (const path of paths) {
    const v = claimAt(p, path)
    if (v !== undefined && v !== null) return v
  }
  return undefined
}

/** The roles the door's access token carries, where the host says its door puts them (Identity.roleClaims): the
 *  roster's own, and those given across applications. */
function rolesOf(p: JWTPayload): { roles: string[]; givenRoles: string[] } {
  const { roster, given } = ports().identity.roleClaims
  const strings = (v: unknown) => Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  return { roles: strings(firstClaim(p, roster)), givenRoles: strings(firstClaim(p, given)) }
}

export async function verifyBearer(header: string | undefined): Promise<Verified | Refusal> {
  const m = /^Bearer\s+(\S+)$/i.exec(header ?? '')
  if (!m) return { refused: 'no bearer' }
  const token = m[1]
  const { issuer, callerClient } = ports().identity
  let claimed: JWTPayload
  try { claimed = decodeJwt(token) } catch { return { refused: 'not a JWT' } }
  if (claimed.iss !== issuer) return { refused: `iss ${String(claimed.iss)} is not the placed issuer` }
  let payload: JWTPayload
  try {
    ;({ payload } = await jwtVerify(token, await keySet(issuer), {
      issuer, audience: AUDIENCE, algorithms: ['RS256'], clockTolerance: 60,
    }))
  } catch (e) {
    return { refused: `verify: ${(e as Error).message}` }
  }
  if (payload.azp !== callerClient) return { refused: `azp ${String(payload.azp)} is not ${callerClient}` }
  if (payload.typ !== 'Bearer') return { refused: `typ ${String(payload.typ)} is not Bearer` }
  if (payload.email_verified !== true) return { refused: 'email not verified' }
  if (typeof payload.email !== 'string' || !payload.email) return { refused: 'no email' }
  return { email: payload.email, ...rolesOf(payload) }
}
