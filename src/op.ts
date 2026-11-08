// What every operation file shares: the answers in the roster's shapes, the body's fields read by type, the contract's
// schema words, and the two who-may rules (a permission, or the caller's own family).
import type { Permission } from './access-rule'
import { may, ownFamilyOf } from './access'
import type { Answer, PersonCall, Schema } from './routes'

export const ok = (body: unknown): Answer => ({ status: 200, body })
export const notFound = (what: string): Answer => ({ status: 404, body: { error: what, code: 'not_found' } })
export const badRequest = (why: string): Answer => ({ status: 400, body: { error: why, code: 'bad_request' } })
/** The operation's own code refused (the shared function returned `{ error }`): its words. */
export const refused = (error: string): Answer => ({ status: 422, body: { error, code: 'refused' } })
/** A shared function's `{ error } | value` result: 422 with its words, else 200 with the value. */
export const result = (r: unknown): Answer =>
  r && typeof r === 'object' && 'error' in r && typeof (r as { error: unknown }).error === 'string'
    ? refused((r as { error: string }).error) : ok(r ?? null)

/** A body field of a type, or a thrown BodyRefused the server answers 400. */
export class BodyRefused extends Error {}
type Body = Record<string, unknown>
const bodyOf = (b: unknown): Body => {
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw new BodyRefused('the body is not a JSON object')
  return b as Body
}
export const field = {
  str(b: unknown, k: string): string {
    const v = bodyOf(b)[k]
    if (typeof v !== 'string') throw new BodyRefused(`${k} must be a string`)
    return v
  },
  strOrNull(b: unknown, k: string): string | null {
    const v = bodyOf(b)[k]
    if (v === null || v === undefined) return null
    if (typeof v !== 'string') throw new BodyRefused(`${k} must be a string or null`)
    return v
  },
  num(b: unknown, k: string): number {
    const v = bodyOf(b)[k]
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new BodyRefused(`${k} must be a number`)
    return v
  },
  numOrNull(b: unknown, k: string): number | null {
    const v = bodyOf(b)[k]
    if (v === null || v === undefined) return null
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new BodyRefused(`${k} must be a number or null`)
    return v
  },
  strs(b: unknown, k: string): string[] {
    const v = bodyOf(b)[k]
    if (!Array.isArray(v) || v.some(x => typeof x !== 'string')) throw new BodyRefused(`${k} must be a list of strings`)
    return v as string[]
  },
  obj(b: unknown): Body { return bodyOf(b) },
}

// The contract's words for a schema.
export const S = {
  uuid: { type: 'string', format: 'uuid' } as Schema,
  str: { type: 'string' } as Schema,
  num: { type: 'number' } as Schema,
  bool: { type: 'boolean' } as Schema,
  date: { type: 'string', format: 'date' } as Schema,
  dateTime: { type: 'string', format: 'date-time' } as Schema,
  nullable: (s: Schema): Schema => ({ ...s, nullable: true }),
  list: (items: Schema): Schema => ({ type: 'array', items }),
  /** An object whose named properties are each given; `required` are those not marked optional with a `?`. */
  obj: (props: Record<string, Schema>): Schema => {
    const entries = Object.entries(props)
    return {
      type: 'object',
      required: entries.filter(([k]) => !k.endsWith('?')).map(([k]) => k),
      properties: Object.fromEntries(entries.map(([k, v]) => [k.replace(/\?$/, ''), v])),
    }
  },
  /** An object whose fields the named source declares (a stored row or a type in src/); the contract does not repeat
   *  that declaration. */
  row: (what: string): Schema => ({ type: 'object', description: `${what}; timestamps as date-time strings` }),
  done: { type: 'object', required: ['success'], properties: { success: { type: 'boolean' } } } as Schema,
}

/** Who may: the permission, or — when `ownFamily` names the family the call is about — the caller's own family. */
export async function mayOrOwn(c: PersonCall, permission: Permission, familyId: string | null): Promise<boolean> {
  if (may(c.caller, permission)) return true
  return familyId !== null && (await ownFamilyOf(c.store, c.caller)) === familyId
}
export const OWN_FAMILY = "the caller's own family: their live person's family in the tenant, matched by the address they signed in with"
