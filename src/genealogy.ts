// A FAMILY TENANT'S GENEALOGY. `persons` and `person_relationships` are the roster's, so genealogy's reads and acts are
// these operations (lib/genealogy.ts). Who may: a genealogy writer, or a person recorded in the tree (found by the
// address the caller signed in with), who changes only their direct family. The checks run in a fixed order, so a
// refusal always carries the same words.
import { may } from './access'
import type { PersonCall, Route } from './routes'
import { field, ok, refused, S } from './op'
import {
  getPersonByEmail, getPersonsByTenant, getAllRelationshipsByTenant, getDirectFamily, getPersonById,
  getRelationshipsByPerson, createGenealogyPerson, addRelationship, isMarriedIn, relationshipPeople,
  endRelationshipRow, updateGenealogyPerson, deleteRelationship, type GenealogyPersonFields,
} from './lib/genealogy'

const T = '/v1/tenants/{slug}/genealogy'
const WRITE = 'genealogy.write' as const
const IN_TREE = "a person recorded in the tree, found by the address the caller signed in with: their own direct family (themselves, their spouses and their descendants)"

/** The caller's own person in the tree, or null. */
const selfOf = (c: PersonCall) => getPersonByEmail(c.tenant.id, c.caller.email)

/** A writer, or a person in the tree: who may reach any genealogy operation. */
const writerOrInTree = async (c: PersonCall) => may(c.caller, WRITE) || !!(await selfOf(c))

/** For a caller who is not a writer: whether every one of `ids` is in their direct family. */
async function inOwnFamily(c: PersonCall, ...ids: string[]): Promise<boolean> {
  const self = await selfOf(c)
  if (!self) return false
  const family = await getDirectFamily(c.tenant.id, self.id)
  return ids.some(id => family.has(id))
}

/** The person form's fields, as sent. */
function personFields(b: unknown): GenealogyPersonFields {
  const s = (k: string) => field.strOrNull(b, k)
  const n = (k: string) => field.numOrNull(b, k)
  return {
    firstName: field.str(b, 'firstName'), lastName: s('lastName'), gender: s('gender'), birthYear: n('birthYear'),
    birthDate: s('birthDate'), deathYear: n('deathYear'), deathDate: s('deathDate'), notes: s('notes'), email: s('email'),
    phone: s('phone'), city: s('city'), country: s('country'), websiteUrl: s('websiteUrl'), facebookUrl: s('facebookUrl'),
    instagramUrl: s('instagramUrl'), linkedinUrl: s('linkedinUrl'),
  }
}
const PERSON_FIELDS = S.obj({
  firstName: S.str, 'lastName?': S.nullable(S.str), 'gender?': S.nullable(S.str), 'birthYear?': S.nullable(S.num),
  'birthDate?': S.nullable(S.date), 'deathYear?': S.nullable(S.num), 'deathDate?': S.nullable(S.date), 'notes?': S.nullable(S.str),
  'email?': S.nullable(S.str), 'phone?': S.nullable(S.str), 'city?': S.nullable(S.str), 'country?': S.nullable(S.str),
  'websiteUrl?': S.nullable(S.str), 'facebookUrl?': S.nullable(S.str), 'instagramUrl?': S.nullable(S.str), 'linkedinUrl?': S.nullable(S.str),
})
const created = S.obj({ success: S.bool, id: S.uuid })
const RELATIONSHIP = S.obj({ id: S.uuid, personAId: S.uuid, personBId: S.uuid, type: S.str, status: S.str, endYear: S.nullable(S.num) })

const TREE = S.obj({
  persons: S.list(S.row('a persons row')),
  relationships: S.list(RELATIONSHIP),
  self: S.nullable(S.row("the caller's own persons row")),
  directFamily: S.list(S.uuid),
  may: S.obj({ write: S.bool, tenantWrite: S.bool }),
  selected: S.nullable(S.obj({
    person: S.nullable(S.row('the asked persons row')),
    relationships: S.list(S.row('a related person: relationshipId, personId, names, gender, years, type, status, endYear')),
  })),
})

/** The tree, and the person asked (the path's `person`) with their relationships. getPersonById reads the id as given. */
async function tree(c: PersonCall) {
  const self = await selfOf(c)
  const [persons, relationships, family] = await Promise.all([
    getPersonsByTenant(c.tenant.id), getAllRelationshipsByTenant(c.tenant.id),
    self ? getDirectFamily(c.tenant.id, self.id) : Promise.resolve(new Set<string>()),
  ])
  const person = c.params.person ?? null
  return ok({
    persons, relationships, self, directFamily: [...family],
    may: { write: may(c.caller, WRITE), tenantWrite: may(c.caller, 'tenant.write') },
    selected: person ? { person: await getPersonById(person), relationships: await getRelationshipsByPerson(person) } : null,
  })
}

export const GENEALOGY_ROUTES: Route[] = [
  {
    method: 'GET', path: `${T}/tree`, operationId: 'genealogy.tree',
    summary: "The tree: every live person and every relationship, the caller's own person and direct family, and what the caller may change.",
    permission: WRITE, alsoAllowed: IN_TREE,
    allowed: writerOrInTree,
    response: TREE,
    handle: c => tree(c as PersonCall),
  },
  {
    method: 'GET', path: `${T}/tree/persons/{person}`, operationId: 'genealogy.treeAt',
    summary: 'The tree as genealogy.tree answers it, and the person of the path with their relationships.',
    permission: WRITE, alsoAllowed: IN_TREE,
    allowed: writerOrInTree,
    response: TREE,
    handle: c => tree(c as PersonCall),
  },
  {
    method: 'POST', path: `${T}/persons`, operationId: 'genealogy.createPerson',
    summary: 'A root person: no parent, the first of a new line.',
    permission: WRITE,
    allowed: async c => may(c.caller, WRITE),
    request: PERSON_FIELDS,
    response: created,
    handle: async c => {
      const fields = personFields(c.body)
      if (!fields.firstName) return refused('Name is required.')
      return ok({ success: true, id: await createGenealogyPerson(c.tenant.id, fields) })
    },
  },
  {
    method: 'POST', path: `${T}/persons/{id}/children`, operationId: 'genealogy.addChild',
    summary: 'A child of a bloodline person, made and related to them.',
    permission: WRITE, alsoAllowed: IN_TREE,
    allowed: writerOrInTree,
    request: PERSON_FIELDS,
    response: created,
    handle: async c => {
      const pc = c as PersonCall
      if (!may(pc.caller, WRITE) && !(await inOwnFamily(pc, c.params.id))) return refused('Forbidden.')
      if (await isMarriedIn(c.tenant.id, c.params.id)) return refused('A child can only be added to a bloodline member.')
      const fields = personFields(c.body)
      if (!fields.firstName) return refused('Name is required.')
      const id = await createGenealogyPerson(c.tenant.id, fields)
      await addRelationship(c.tenant.id, c.params.id, id, 'parent-child')
      return ok({ success: true, id })
    },
  },
  {
    method: 'POST', path: `${T}/persons/{id}/spouses`, operationId: 'genealogy.addSpouse',
    summary: 'A spouse of a person, made and related to them.',
    permission: WRITE, alsoAllowed: IN_TREE,
    allowed: writerOrInTree,
    request: PERSON_FIELDS,
    response: created,
    handle: async c => {
      const pc = c as PersonCall
      if (!may(pc.caller, WRITE) && !(await inOwnFamily(pc, c.params.id))) return refused('Forbidden.')
      const fields = personFields(c.body)
      if (!fields.firstName) return refused('Name is required.')
      const id = await createGenealogyPerson(c.tenant.id, fields)
      await addRelationship(c.tenant.id, c.params.id, id, 'spouse')
      return ok({ success: true, id })
    },
  },
  {
    method: 'PUT', path: `${T}/persons/{id}`, operationId: 'genealogy.updatePerson',
    summary: "A person's fields, written as the form gives them.",
    permission: WRITE, alsoAllowed: IN_TREE,
    allowed: writerOrInTree,
    request: PERSON_FIELDS,
    response: S.done,
    handle: async c => {
      const pc = c as PersonCall
      if (!may(pc.caller, WRITE) && !(await inOwnFamily(pc, c.params.id))) return refused('Forbidden.')
      const fields = personFields(c.body)
      if (!fields.firstName) return refused('Name is required.')
      await updateGenealogyPerson(c.params.id, fields)
      return ok({ success: true })
    },
  },
  {
    method: 'POST', path: `${T}/relationships/{id}/end`, operationId: 'genealogy.endRelationship',
    summary: 'A spouse relationship ended: divorced, separated or widowed, with the year.',
    permission: WRITE, alsoAllowed: IN_TREE,
    allowed: writerOrInTree,
    request: S.obj({ status: S.str, endYear: S.nullable(S.num) }),
    response: S.done,
    handle: async c => {
      const pc = c as PersonCall
      if (!may(pc.caller, WRITE)) {
        const rel = await relationshipPeople(c.params.id)
        if (!rel) return refused('Relationship not found.')
        if (!(await inOwnFamily(pc, rel.personAId, rel.personBId))) return refused('Forbidden.')
      }
      const status = field.str(c.body, 'status')
      if (!['divorced', 'separated', 'widowed'].includes(status)) return refused('Invalid status.')
      await endRelationshipRow(c.params.id, status, field.numOrNull(c.body, 'endYear'))
      return ok({ success: true })
    },
  },
  {
    method: 'DELETE', path: `${T}/relationships/{id}`, operationId: 'genealogy.removeRelationship',
    summary: 'A relationship removed.',
    permission: WRITE,
    allowed: async c => may(c.caller, WRITE),
    response: S.done,
    handle: async c => { await deleteRelationship(c.params.id); return ok({ success: true }) },
  },
]
