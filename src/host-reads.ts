// THE HOST'S LOOKUPS OF THE ROSTER'S PEOPLE: who holds an address, who a list of ids is, a family's number, a person's
// brief, a class's year, a family's teachers with no school account, who wrote a newsletter, and each linked class's
// teachers. Each is scoped to the path's tenant (another tenant's id or address answers nothing). Some are called by the host's runs (runs.ts), each named in `runs`; a run is limited by the handler.
import { and, asc, desc, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm'
import { may } from './access'
import type { Call, Route } from './routes'
import { BodyRefused, field, notFound, ok, S } from './op'
import { persons, rosterAvailableClasses, rosterFamilies, rosterTeachers } from './tables'
import { resolveAddressIdentity } from './lib/address-identity'
import { teacherClassroomAddress, teacherClassroomAddressSql } from './lib/teacher-classroom-address'
import { workspaceDomain } from './lib/role-mailbox'

const T = '/v1/tenants/{slug}/roster'
const forbidden = (error: string) => ({ status: 403, body: { error, code: 'forbidden' } })
const lc = (s: string | null | undefined) => (s ?? '').trim().toLowerCase()
const ids = (b: unknown, k: string): string[] => {
  const v = field.strs(b, k)
  if (v.some(x => !/^[0-9a-f-]{36}$/i.test(x))) throw new BodyRefused(`${k} must be a list of ids`)
  return [...new Set(v)]
}
const WITHS = ['family', 'contact'] as const
type With = typeof WITHS[number]
const withOf = (b: unknown): With[] => {
  const v = field.obj(b).with
  if (v === undefined || v === null) return []
  if (!Array.isArray(v) || v.some(x => !WITHS.includes(x))) throw new BodyRefused('with must be a list of family, contact')
  return v as With[]
}
const ruleOf = (b: unknown): 'own-exact' | 'own-or-classroom' => {
  const r = field.str(b, 'rule')
  if (r !== 'own-exact' && r !== 'own-or-classroom') throw new BodyRefused('rule must be own-exact or own-or-classroom')
  return r
}

export const HOST_READ_ROUTES: Route[] = [
  {
    method: 'POST', path: `${T}/persons/by-address`, operationId: 'person.byAddress',
    summary: "The persons holding each address, one row per address and person, by person id. Rule own-exact: persons.email as stored, deleted persons included; own-or-classroom: either address, lower-cased and trimmed, live persons only. With family: the family's number; with contact: the phone and the family's postal address, and the caller must also hold roster.read.",
    permission: 'google.read',
    runs: ['course-links'],
    request: S.obj({ addresses: S.list(S.str), rule: S.str, 'with?': S.nullable(S.list(S.str)) }),
    allowed: async c => may(c.caller, 'google.read') && (!withOf(c.body).includes('contact') || may(c.caller, 'roster.read')),
    response: S.list(S.obj({
      address: S.str, id: S.uuid, firstName: S.str, lastName: S.nullable(S.str), email: S.nullable(S.str),
      classroomEmail: S.nullable(S.str), familyId: S.nullable(S.uuid),
      'legacyFamilyId?': S.nullable(S.num),
      'phone?': S.nullable(S.str), 'addr1?': S.nullable(S.str), 'addr2?': S.nullable(S.str),
      'city?': S.nullable(S.str), 'state?': S.nullable(S.str), 'zip?': S.nullable(S.str),
    })),
    handle: async (c: Call) => {
      const rule = ruleOf(c.body)
      const want = withOf(c.body)
      // A run may ask own-exact only, with nothing added.
      if (!c.caller && (rule !== 'own-exact' || want.length)) return forbidden(`${(c.actor as { verb: string }).verb} may ask own-exact alone, with nothing added`)
      const raw = field.strs(c.body, 'addresses')
      const asked = rule === 'own-exact' ? [...new Set(raw)] : [...new Set(raw.map(lc).filter(Boolean))]
      if (!asked.length) return ok([])
      const match = rule === 'own-exact'
        ? and(eq(persons.tenantId, c.tenant.id), inArray(persons.email, asked))
        : and(eq(persons.tenantId, c.tenant.id), isNull(persons.deletedAt), or(
          inArray(sql`lower(trim(${persons.email}))`, asked), inArray(sql`lower(trim(${persons.classroomEmail}))`, asked)))
      const rows = await c.store.select({
        id: persons.id, firstName: persons.firstName, lastName: persons.lastName, email: persons.email,
        classroomEmail: persons.classroomEmail, familyId: persons.familyId, phone: persons.phone,
        legacyFamilyId: rosterFamilies.legacyFamilyId, addr1: rosterFamilies.addr1, addr2: rosterFamilies.addr2,
        city: rosterFamilies.city, state: rosterFamilies.state, zip: rosterFamilies.zip,
      }).from(persons).leftJoin(rosterFamilies, eq(rosterFamilies.id, persons.familyId)).where(match).orderBy(asc(persons.id))
      const out: Record<string, unknown>[] = []
      for (const address of asked) {
        for (const r of rows) {
          const holds = rule === 'own-exact' ? r.email === address : lc(r.email) === address || lc(r.classroomEmail) === address
          if (!holds) continue
          out.push({
            address, id: r.id, firstName: r.firstName, lastName: r.lastName, email: r.email, classroomEmail: r.classroomEmail,
            familyId: r.familyId,
            ...(want.includes('family') ? { legacyFamilyId: r.legacyFamilyId } : {}),
            ...(want.includes('contact') ? { phone: r.phone, addr1: r.addr1, addr2: r.addr2, city: r.city, state: r.state, zip: r.zip } : {}),
          })
        }
      }
      return ok(out)
    },
  },
  {
    method: 'POST', path: `${T}/persons/names`, operationId: 'person.names',
    summary: "First and last names of the given persons in the tenant, deleted persons included, so ids held in older records still resolve.",
    permission: 'google.read',
    request: S.obj({ ids: S.list(S.uuid) }),
    allowed: async c => may(c.caller, 'google.read'),
    response: S.list(S.obj({ id: S.uuid, firstName: S.str, lastName: S.nullable(S.str) })),
    handle: async c => {
      const want = ids(c.body, 'ids')
      if (!want.length) return ok([])
      return ok(await c.store.select({ id: persons.id, firstName: persons.firstName, lastName: persons.lastName })
        .from(persons).where(and(eq(persons.tenantId, c.tenant.id), inArray(persons.id, want))))
    },
  },
  {
    method: 'POST', path: `${T}/families/numbers`, operationId: 'family.numbers',
    summary: "The family number (legacy_family_id) of each given family in the tenant.",
    permission: 'google.read',
    request: S.obj({ ids: S.list(S.uuid) }),
    allowed: async c => may(c.caller, 'google.read'),
    response: S.list(S.obj({ id: S.uuid, legacyFamilyId: S.nullable(S.num) })),
    handle: async c => {
      const want = ids(c.body, 'ids')
      if (!want.length) return ok([])
      return ok(await c.store.select({ id: rosterFamilies.id, legacyFamilyId: rosterFamilies.legacyFamilyId })
        .from(rosterFamilies).where(and(eq(rosterFamilies.tenantId, c.tenant.id), inArray(rosterFamilies.id, want))))
    },
  },
  {
    method: 'GET', path: `${T}/persons/{id}/brief`, operationId: 'person.brief',
    summary: "A person's first and last name, e-mail address and family id, deleted persons included; 404 when the tenant holds no such person.",
    permission: 'google.write',
    allowed: async c => may(c.caller, 'google.write'),
    response: S.obj({ firstName: S.str, lastName: S.nullable(S.str), email: S.nullable(S.str), familyId: S.nullable(S.uuid) }),
    handle: async c => {
      const [p] = await c.store.select({ firstName: persons.firstName, lastName: persons.lastName, email: persons.email, familyId: persons.familyId })
        .from(persons).where(and(eq(persons.tenantId, c.tenant.id), eq(persons.id, c.params.id))).limit(1)
      return p ? ok(p) : notFound('person not found')
    },
  },
  {
    method: 'GET', path: `${T}/classes/{id}/brief`, operationId: 'class.brief',
    summary: "A class's year and section; 404 when the tenant holds no such class.",
    permission: 'google.write',
    allowed: async c => may(c.caller, 'google.write'),
    response: S.obj({ year: S.num, section: S.nullable(S.str) }),
    handle: async c => {
      const [k] = await c.store.select({ year: rosterAvailableClasses.year, section: rosterAvailableClasses.section })
        .from(rosterAvailableClasses).where(and(eq(rosterAvailableClasses.tenantId, c.tenant.id), eq(rosterAvailableClasses.id, c.params.id))).limit(1)
      return k ? ok(k) : notFound('class not found')
    },
  },
  {
    method: 'GET', path: `${T}/families/{id}/teachers-without-account`, operationId: 'family.teachersWithoutAccount',
    summary: "The family's live members and its mother and father who teach a class of `year` and hold no school address, by id: the people a principal may make a school account for. `year` is required (400 without it).",
    permission: 'roster.write',
    query: { year: S.num },
    allowed: async c => may(c.caller, 'roster.write'),
    response: S.list(S.obj({ id: S.uuid, firstName: S.str, lastName: S.nullable(S.str) })),
    handle: async c => {
      const year = parseInt(c.query.year ?? '', 10)
      if (!Number.isFinite(year)) return { status: 400, body: { error: 'year is required', code: 'bad_request' } }
      const [family] = await c.store.select({ motherId: rosterFamilies.motherId, fatherId: rosterFamilies.fatherId })
        .from(rosterFamilies).where(and(eq(rosterFamilies.tenantId, c.tenant.id), eq(rosterFamilies.id, c.params.id))).limit(1)
      if (!family) return notFound('family not found')
      const members = (await c.store.select({ id: persons.id }).from(persons)
        .where(and(eq(persons.tenantId, c.tenant.id), eq(persons.familyId, c.params.id), isNull(persons.deletedAt)))).map(r => r.id)
      const pool = [...new Set([...members, family.motherId, family.fatherId].filter((v): v is string => !!v))]
      if (!pool.length) return ok([])
      const domain = await workspaceDomain(c.tenant.id)
      return ok(await c.store.selectDistinct({ id: persons.id, firstName: persons.firstName, lastName: persons.lastName })
        .from(persons)
        .innerJoin(rosterTeachers, eq(rosterTeachers.personId, persons.id))
        .innerJoin(rosterAvailableClasses, eq(rosterAvailableClasses.id, rosterTeachers.classId))
        .where(and(eq(persons.tenantId, c.tenant.id), inArray(persons.id, pool), eq(rosterAvailableClasses.year, year), isNull(teacherClassroomAddressSql(domain))))
        .orderBy(asc(persons.id)))
    },
  },
  {
    method: 'POST', path: `${T}/persons/identities`, operationId: 'person.identities',
    summary: "Who each address is in the tenant: a live person's own address first, then a school classroom address, else unknown (resolveAddressIdentity), per address.",
    permission: 'newsletter.read',
    runs: ['newsletter-authors'],
    request: S.obj({ addresses: S.list(S.str) }),
    allowed: async c => may(c.caller, 'newsletter.read'),
    response: S.list(S.obj({ address: S.str, identity: S.row('src/lib/address-identity.ts AddressIdentity') })),
    handle: async c => {
      const asked = [...new Set(field.strs(c.body, 'addresses'))]
      return ok(await Promise.all(asked.map(async address => ({ address, identity: await resolveAddressIdentity(c.tenant.id, address) }))))
    },
  },
  {
    method: 'GET', path: `${T}/classroom/teacher-addresses`, operationId: 'classroom.teacherAddresses',
    summary: "For each class of `year` linked to a Google Classroom course, by class id: the course and its live teachers, the lead first then by person id, each with their school classroom address (null when none), whether they lead, and their names. `year` is required (400 without it).",
    permission: 'google.read',
    runs: ['meet-teachers'],
    query: { year: S.num },
    allowed: async c => may(c.caller, 'google.read'),
    response: S.list(S.obj({
      classId: S.uuid, courseId: S.str,
      teachers: S.list(S.obj({ address: S.nullable(S.str), isLead: S.bool, firstName: S.str, lastName: S.nullable(S.str) })),
    })),
    handle: async c => {
      const year = parseInt(c.query.year ?? '', 10)
      if (!Number.isFinite(year)) return { status: 400, body: { error: 'year is required', code: 'bad_request' } }
      const domain = await workspaceDomain(c.tenant.id)
      const rows = await c.store.select({
        classId: rosterAvailableClasses.id, courseId: rosterAvailableClasses.classroomCourseId,
        personId: persons.id, isLead: sql<boolean>`${rosterTeachers.typeOfTeacher} = 'lead'`, email: persons.email, classroomEmail: persons.classroomEmail,
        firstName: persons.firstName, lastName: persons.lastName,
      }).from(rosterAvailableClasses)
        .leftJoin(rosterTeachers, eq(rosterTeachers.classId, rosterAvailableClasses.id))
        .leftJoin(persons, and(eq(persons.id, rosterTeachers.personId), isNull(persons.deletedAt)))
        .where(and(eq(rosterAvailableClasses.tenantId, c.tenant.id), eq(rosterAvailableClasses.year, year), isNotNull(rosterAvailableClasses.classroomCourseId)))
        .orderBy(asc(rosterAvailableClasses.id), desc(sql`${rosterTeachers.typeOfTeacher} = 'lead'`), asc(persons.id))
      const out = new Map<string, { classId: string; courseId: string; teachers: unknown[] }>()
      for (const r of rows) {
        const k = out.get(r.classId) ?? { classId: r.classId, courseId: r.courseId as string, teachers: [] }
        if (r.personId) k.teachers.push({ address: teacherClassroomAddress(r, domain), isLead: !!r.isLead, firstName: r.firstName, lastName: r.lastName })
        out.set(r.classId, k)
      }
      return ok([...out.values()])
    },
  },
]
