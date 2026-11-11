// THE SEEDS: the comment codes, evaluation templates and role mailboxes' names a tenant starts with, handed in by the
// host's seed run (runs.ts `seed`). Runs only: no person reaches these.
// A role's mailbox address (roster_roles.email) never travels here: it is a role's mail, and no seed writes it.
import { and, eq } from 'drizzle-orm'
import type { Route } from './routes'
import { BodyRefused, field, ok, S } from './op'
import { rosterEvalTemplates, rosterRoles, rosterTeacherCommentCodes } from './tables'
import { birthId } from './lib/registry-id'

const T = '/v1/tenants/{slug}/roster/seeds'
const nobody = async () => false
const list = (b: unknown, k: string): Record<string, unknown>[] => {
  const v = field.obj(b)[k]
  if (!Array.isArray(v) || v.some(x => !x || typeof x !== 'object' || Array.isArray(x))) throw new BodyRefused(`${k} must be a list of objects`)
  return v as Record<string, unknown>[]
}

export const SEED_ROUTES: Route[] = [
  {
    method: 'PUT', path: `${T}/comment-codes`, operationId: 'seed.commentCodes',
    summary: "The teacher comment codes: all of them when the tenant holds none, else nothing.",
    permission: null, runs: ['seed'], allowed: nobody,
    request: S.obj({ codes: S.list(S.obj({ id: S.num, text: S.str })) }),
    response: S.obj({ seeded: S.num, skipped: S.num }),
    handle: async c => {
      const codes = list(c.body, 'codes').map(x => ({ id: field.num(x, 'id'), text: field.str(x, 'text') }))
      const held = await c.store.select({ id: rosterTeacherCommentCodes.id }).from(rosterTeacherCommentCodes)
        .where(eq(rosterTeacherCommentCodes.tenantId, c.tenant.id))
      if (held.length) return ok({ seeded: 0, skipped: held.length })
      for (const k of codes) await c.store.insert(rosterTeacherCommentCodes).values({ id: k.id, tenantId: c.tenant.id, text: k.text })
      return ok({ seeded: codes.length, skipped: 0 })
    },
  },
  {
    method: 'PUT', path: `${T}/eval-templates`, operationId: 'seed.evalTemplates',
    summary: "The evaluation templates: each level the tenant holds no template for is inserted; none is updated.",
    permission: null, runs: ['seed'], allowed: nobody,
    request: S.obj({ templates: S.list(S.obj({ level: S.num, sections: S.list(S.row('a section: name and criteria')) })) }),
    response: S.obj({ inserted: S.list(S.num), kept: S.num }),
    handle: async c => {
      const templates = list(c.body, 'templates').map(x => ({ level: field.num(x, 'level'), sections: field.obj(x).sections }))
      if (templates.some(t => !Array.isArray(t.sections))) throw new BodyRefused('each template\'s sections must be a list')
      const held = new Set((await c.store.select({ level: rosterEvalTemplates.courseLevel }).from(rosterEvalTemplates)
        .where(eq(rosterEvalTemplates.tenantId, c.tenant.id))).map(r => r.level))
      const missing = templates.filter(t => !held.has(t.level))
      for (const t of missing) await c.store.insert(rosterEvalTemplates).values({ tenantId: c.tenant.id, courseLevel: t.level, sections: t.sections })
      return ok({ inserted: missing.map(t => t.level), kept: held.size })
    },
  },
  {
    method: 'PUT', path: `${T}/roles`, operationId: 'seed.roles',
    summary: "The role mailboxes' names: a slug the tenant holds gets its name and description; a missing slug is inserted under a new record id. No address is written.",
    permission: null, runs: ['seed'], allowed: nobody,
    request: S.obj({ roles: S.list(S.obj({ slug: S.str, name: S.str, description: S.nullable(S.str) })) }),
    response: S.obj({ inserted: S.list(S.str), updated: S.list(S.str) }),
    handle: async c => {
      const roles = list(c.body, 'roles').map(x => ({ slug: field.str(x, 'slug'), name: field.str(x, 'name'), description: field.strOrNull(x, 'description') }))
      const inserted: string[] = []
      const updated: string[] = []
      for (const r of roles) {
        await c.store.transaction(async tx => {
          const [held] = await tx.select({ id: rosterRoles.id }).from(rosterRoles)
            .where(and(eq(rosterRoles.tenantId, c.tenant.id), eq(rosterRoles.slug, r.slug))).limit(1)
          if (held) {
            await tx.update(rosterRoles).set({ name: r.name, description: r.description }).where(eq(rosterRoles.id, held.id))
            updated.push(r.slug)
          } else {
            const id = await birthId(tx, 'role', c.tenant.id)
            await tx.insert(rosterRoles).values({ id, tenantId: c.tenant.id, slug: r.slug, name: r.name, description: r.description, email: null })
            inserted.push(r.slug)
          }
        })
      }
      return ok({ inserted, updated })
    },
  },
]
