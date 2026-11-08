// THE NEWSLETTERS' ROSTER HALF: whose classrooms a scoped list shows, and the caller's own for one posting
// (lib/newsletter-scope.ts). Who may: newsletter.read, else the caller's own family or its people. The postings are the
// host's.
import { may } from './access'
import type { PersonCall, Route } from './routes'
import { notFound, ok, S } from './op'
import { myNewsletterRooms, newsletterScope, ownsScope } from './lib/newsletter-scope'

const T = '/v1/tenants/{slug}/roster/newsletter-scope'
const OWN = "the caller's own family, or the caller or one of their family's people: matched by the address they signed in with"

export const NEWSLETTER_ROUTES: Route[] = [
  {
    method: 'GET', path: T, operationId: 'newsletter.scope',
    summary: "One family's (`family`) or one person's (`person`) classrooms, as a newsletters list's filter: its label, the course ids, the person as author, and whether the three-universes run was refused.",
    permission: 'newsletter.read', alsoAllowed: OWN,
    query: { family: S.str, person: S.str },
    allowed: async () => true,
    response: S.obj({ label: S.str, courseIds: S.list(S.str), authorPersonId: S.nullable(S.str), refused: S.bool }),
    handle: async c => {
      const pc = c as PersonCall
      const ask = { family: c.query.family ?? null, person: c.query.family ? null : (c.query.person ?? null) }
      // Found first, then who may: a missing family or person is not found for anyone.
      const scope = await newsletterScope(c.tenant.id, ask)
      if (!scope) return notFound('no such family or person')
      if (!may(pc.caller, 'newsletter.read') && !(await ownsScope(c.tenant.id, pc.caller.email, ask))) {
        return { status: 403, body: { error: `newsletter.scope asks newsletter.read or ${OWN}`, code: 'forbidden' } }
      }
      return ok(scope)
    },
  },
  {
    method: 'GET', path: `${T}/mine`, operationId: 'newsletter.mine',
    summary: "The caller's own person and every classroom of theirs and their family's, for opening one posting; 404 when the caller is not on the roster.",
    permission: null, alsoAllowed: 'the signed-in person, for their own: found by the address they signed in with, never a parameter',
    allowed: async () => true,
    response: S.obj({ personId: S.str, courseIds: S.list(S.str) }),
    handle: async c => {
      const mine = await myNewsletterRooms(c.tenant.id, (c as PersonCall).caller.email)
      return mine ? ok(mine) : notFound('the caller is not on the roster')
    },
  },
]
