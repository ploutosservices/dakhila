// A PERSON'S FAMILY ACTS: the four, run by lib/roster-person-acts.ts. Who
// may is asked inside each act — after the person is
// found — so every signed-in caller reaches the operation and the act answers its own words, a refusal among them.
import { may } from './access'
import type { PersonCall, Route } from './routes'
import { field, mayOrOwn, ok, S } from './op'
import type { FormFields } from './lib/roster-family-acts'
import { reconcileIntakeAddress } from './lib/intake-address'
import {
  addChildAct, addSpouseAct, isParentByRole, updateFamilyAddressAct, updatePersonAct, type Questions,
} from './lib/roster-person-acts'

const T = '/v1/tenants/{slug}/roster/persons'
const WHO = "roster.write, or a parent (mother or father) of the person's family; asked inside the act, after the person is found, and answered as the act's own 'Forbidden'"

function questions(c: PersonCall): Questions {
  return {
    mayEdit: async familyId => may(c.caller, 'roster.write') || isParentByRole(c.tenant.id, c.caller.email, familyId),
    mayRead: familyId => mayOrOwn(c, 'roster.read', familyId),
  }
}

function fields(b: unknown): FormFields {
  return field.obj(field.obj(b).fields) as FormFields
}

const FIELDS = S.obj({ fields: { type: 'object', description: "the form's fields as the door read them", additionalProperties: true } })
const RESULT = S.obj({ 'ok?': S.bool, 'error?': S.str, 'personId?': S.uuid })

const act = (path: string, operationId: string, summary: string, run: (tenantId: string, q: Questions, f: FormFields) => Promise<unknown>): Route => ({
  method: 'POST', path: `${T}/${path}`, operationId, summary,
  permission: null, alsoAllowed: WHO,
  allowed: async () => true,
  request: FIELDS,
  response: RESULT,
  handle: async c => ok(await run(c.tenant.id, questions(c as PersonCall), fields(c.body))),
})

export const PERSON_ACT_ROUTES: Route[] = [
  {
    method: 'POST', path: '/v1/tenants/{slug}/persons/reconcile-address', operationId: 'person.reconcileAddress',
    summary: "The intake fallback the host asks after a sign-in: when no person of the tenant holds the caller's address, one recent person (created within the school's intake claim window) whose name is the sign-in's display name and whose address no user holds takes the caller's address.",
    permission: null, alsoAllowed: 'the signed-in person, for the address they signed in with (never a parameter)',
    allowed: async () => true,
    request: S.obj({ displayName: S.nullable(S.str) }),
    response: S.done,
    handle: async c => {
      await reconcileIntakeAddress((c as PersonCall).caller.email, c.tenant.slug, field.strOrNull(c.body, 'displayName'))
      return ok({ success: true })
    },
  },
  act('spouses', 'person.addSpouse', "A spouse added to a person's family (the family made if there is none), as its other parent.", addSpouseAct),
  act('family-address', 'person.updateFamilyAddress', "A family's address saved; a person with no family gets one first. Answers family.get's refusal before its own.", updateFamilyAddressAct),
  act('update', 'person.update', "A person's fields saved; a first grade year earlier than the birth year plus the school's earliest first-grade age is refused.", updatePersonAct),
  act('children', 'person.addChild', "A child added to a person's family (the family made if there is none).", addChildAct),
]
