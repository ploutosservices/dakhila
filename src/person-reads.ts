// THE ROSTER'S PERSON, STUDENT AND ROLE READS, each with its who-may. The reader keeps its words and its layout.
import { may, ownFamilyOf } from './access'
import type { PersonCall, Route } from './routes'
import { notFound, ok, S } from './op'
import { personsPage } from './lib/roster-persons-list'
import { studentsForList } from './lib/roster-students'
import { tenantRoles } from './lib/roster-roles'
import { getFamily, getFamilyMembers, getFieldHistory, getPersonByEmail, getPersonById } from './lib/roster-families'
import { studentClassHistory, teachingHistory } from './lib/roster-person-history'
import { joinedIndex } from './lib/student-joined'
import { newsletterRows, personCourseIds, tenantHasNewsletters } from './lib/newsletters-store'
import { runThreeUniverses } from './lib/three-universes-load'
import { volunteerHistory } from './lib/volunteering'
import { eventHistory } from './lib/events'

const T = '/v1/tenants/{slug}/roster'
const OWN = "a caller without roster.read: their own family only"
/** The roster reader's gate: roster.read, or household.read. */
const rosterReader = async (c: PersonCall) => may(c.caller, 'roster.read') || may(c.caller, 'household.read')
/** The reads' scope: every row for roster.read, else the caller's own family's. */
const scopeOf = async (c: PersonCall) => may(c.caller, 'roster.read') ? 'all' as const : { familyId: await ownFamilyOf(c.store, c.caller) }

export const PERSON_READ_ROUTES: Route[] = [
  {
    method: 'GET', path: `${T}/persons`, operationId: 'person.list',
    summary: "One page of the live persons, searched by `q` and narrowed to `role`, `limit` rows from `offset`; with the counts per role for the search.",
    permission: 'roster.read', alsoAllowed: `household.read reaches it too; ${OWN}`,
    query: { q: S.str, role: S.str, limit: S.num, offset: S.num },
    allowed: rosterReader,
    response: S.obj({ roleCountRows: S.list(S.obj({ role: S.nullable(S.str), n: S.num })), rows: S.list(S.row('a person: id, names, role, email, phone, preferred language and family (src/lib/roster-persons-list.ts personsPage)')) }),
    handle: async c => {
      const n = (k: string, d: number) => { const v = parseInt(c.query[k] ?? '', 10); return Number.isFinite(v) ? v : d }
      return ok(await personsPage(c.tenant.id, await scopeOf(c as PersonCall), {
        q: c.query.q ?? '', role: c.query.role ?? '', limit: n('limit', 50), offset: n('offset', 0),
      }))
    },
  },
  {
    method: 'GET', path: `${T}/students`, operationId: 'student.list',
    summary: 'The students list: every live student for roster.read, else the caller\'s own family\'s.',
    permission: 'roster.read', alsoAllowed: `household.read reaches it too; ${OWN}`,
    allowed: rosterReader,
    response: S.list(S.row('a student (src/lib/roster-students.ts studentsForList)')),
    handle: async c => ok(await studentsForList(c.tenant.id, await scopeOf(c as PersonCall))),
  },
  {
    method: 'GET', path: `${T}/roles`, operationId: 'role.list',
    summary: "The tenant's role mailboxes: name, slug, address and description.",
    permission: 'roster.write',
    allowed: async c => may(c.caller, 'roster.write'),
    response: S.list(S.row('a roster_roles row')),
    handle: async c => ok(await tenantRoles(c.tenant.id)),
  },
  {
    method: 'GET', path: `${T}/persons/{id}/page`, operationId: 'person.page',
    summary: "One person in full: the person, the caller's own person, the family and its members, the person's classes by year with whether each class's Classroom is joined, what they taught, their field history, their classroom postings and their volunteering and events.",
    permission: 'roster.read', alsoAllowed: 'household.read reaches it too',
    allowed: rosterReader,
    response: S.obj({
      caller: S.nullable(S.obj({ role: S.nullable(S.str), familyId: S.nullable(S.uuid) })),
      person: S.row('the persons row'),
      family: S.nullable(S.row('the roster_families row')),
      members: S.list(S.row('a live persons row of the family')),
      classes: S.list(S.row('a class the person was enrolled in, with its year and department')),
      joined: S.obj({}),
      teaching: S.list(S.row('a class the person taught')),
      fieldHistory: S.list(S.row('a field change: field, old and new value, who and when (changedAt)')),
      postings: S.nullable(S.list(S.row('a classroom posting (src/lib/newsletters-store.ts)'))),
      volunteering: S.list(S.row('a volunteering line')),
      events: S.list(S.row('an event the person was in the audience of')),
    }),
    handle: async c => {
      const pc = c as PersonCall
      const person = await getPersonById(c.tenant.id, c.params.id)
      if (!person) return notFound('no such person in this tenant')
      const caller = await getPersonByEmail(c.tenant.id, pc.caller.email)
      const [family, members, classes, teaching, fieldHistory, volunteering, events] = await Promise.all([
        person.familyId ? getFamily(c.tenant.id, person.familyId) : null,
        person.familyId ? getFamilyMembers(c.tenant.id, person.familyId) : [],
        studentClassHistory(person.id),
        teachingHistory(person.id),
        getFieldHistory(person.id),
        volunteerHistory(c.tenant.id, [person.id]),
        eventHistory(c.tenant.id, [person.id]),
      ])
      // Whether each class's Google Classroom has been joined — the run's answer, per <student, class>:
      // asked only when the person has classes; the run is shared with the postings.
      const run = classes.length > 0 || await tenantHasNewsletters(c.tenant.id) ? await runThreeUniverses(c.tenant.id) : null
      const index = classes.length > 0 ? await joinedIndex(c.tenant.id, run!) : null
      const joined = Object.fromEntries(classes.map(k => [k.classId, index?.get(person.id, k.classId) ?? null]))
      // THIS PERSON'S CLASSROOM POSTINGS (a person can see their own too): a tenant with none asks nothing.
      const postings = await tenantHasNewsletters(c.tenant.id)
        ? (await newsletterRows(c.tenant.id, { courseIds: personCourseIds(run!, person.id) ?? [], authorPersonId: person.id })).rows
        : null
      return ok({
        caller: caller ? { role: caller.role, familyId: caller.familyId } : null,
        person, family, members, classes, joined, teaching, fieldHistory, postings, volunteering, events,
      })
    },
  },
]
