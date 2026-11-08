// THE SEAM READS: the family card, teacher card and chatbot context a public caller shows, for the person the caller's
// token names — the address they signed in with at the door, never an id (lib/seam-answers.ts). The host checks the
// visitor's token, exchanges it for this API and words the address rule's two refusals; here those refusals are named
// codes. The session read is `session.mine`.
import { may } from './access'
import type { PersonCall, Route, Answer } from './routes'
import { ok, S } from './op'
import { requireTenant } from './lib/roster-public-url'
import { CLASSROOM_ADDRESS_MESSAGE } from './lib/address-identity'
import { familyCardAnswer, teacherCardAnswer, familyContextAnswer, type SeamAnswer } from './lib/seam-answers'

const T = '/v1/tenants/{slug}/roster/seam'
const ADDRESS_RULE = "the caller's own record: the person whose address is the one they signed in with"

/** The address rule's refusals as named codes; the host words them. */
function answerOf(a: SeamAnswer): Answer {
  if (a.kind === 'classroom') return { status: 422, body: { error: CLASSROOM_ADDRESS_MESSAGE, code: 'classroom-address' } }
  if (a.kind === 'unknown') return { status: 422, body: { error: 'No such account', code: 'no-such-account' } }
  return ok(a.body)
}

export const SEAM_ROUTES: Route[] = [
  {
    method: 'GET', path: `${T}/family-card`, operationId: 'seam.familyCard',
    summary: "The family card: the caller's family — its eligible people with their classes this session year, and the family's card from the current run — or `family` false. 422 classroom-address when the caller signed in with a classroom address.",
    permission: null, alsoAllowed: ADDRESS_RULE, addressOnly: true,
    allowed: async () => true,
    response: S.row('the family card (src/lib/seam-answers.ts familyCardAnswer)'),
    handle: async c => answerOf(await familyCardAnswer(await requireTenant(c.tenant.id), (c as PersonCall).caller.email)),
  },
  {
    method: 'GET', path: `${T}/teacher-card`, operationId: 'seam.teacherCard',
    summary: "The teacher card: the caller's classrooms this session year, each with its roster classes and students. 422 classroom-address for a classroom address, no-such-account for an address no person holds.",
    permission: null, alsoAllowed: ADDRESS_RULE, addressOnly: true,
    allowed: async () => true,
    response: S.row('the teacher card (src/lib/seam-answers.ts teacherCardAnswer)'),
    handle: async c => answerOf(await teacherCardAnswer(await requireTenant(c.tenant.id), (c as PersonCall).caller.email)),
  },
  {
    method: 'GET', path: `${T}/family-context`, operationId: 'seam.familyContext',
    summary: "The chatbot context: the caller's family de-identified, the help that fits them, and the principal's work when the caller may write the roster (null otherwise).",
    permission: null, alsoAllowed: `${ADDRESS_RULE}; the principal's work only to a roster.write holder`, addressOnly: true,
    allowed: async () => true,
    response: S.row('the family context (src/lib/seam-answers.ts familyContextAnswer)'),
    handle: async c => {
      const pc = c as PersonCall
      return ok(await familyContextAnswer(await requireTenant(c.tenant.id), pc.caller.email, await may(pc.caller, 'roster.write')))
    },
  },
]
