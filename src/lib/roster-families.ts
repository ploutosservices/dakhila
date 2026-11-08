import { db } from './db'
import { now } from './host'
import { persons, rosterFamilies, rosterFamilyTracker } from '../tables'
import { eq, and, inArray, isNull, sql, desc, max, getTableName } from 'drizzle-orm'
import { hostTables } from '../host-tables'
import { birthId, dropIds } from './registry-id'
import { logChanges, fieldHistory } from './record-history'

// FIELD-EDIT HISTORY: every change a person or family edit makes is kept, old value and new,
// so a parent's correction of their own record can be undone and answered for.
//
// Recorded HERE, at the one door, rather than at each caller: updatePerson and
// updateFamily are the roster's only writers of these tables, so a new caller
// inherits history without remembering to ask for it.
//
// A person's id IS its registry id (createPerson takes the registry id first and uses it as
// the row id), so person changes are logged under it directly. A FAMILY's changes are
// attributed to the family's own row id — see
// familyChangeSubject below for why that is honest rather than a cheat.
function diffFields<T extends Record<string, unknown>>(
  before: T, after: Partial<T>,
): Record<string, [unknown, unknown]> {
  const out: Record<string, [unknown, unknown]> = {}
  for (const [field, next] of Object.entries(after)) {
    if (next === undefined) continue
    const prev = before[field]
    // Normalise the empty forms a form produces: '' and null are the same
    // absence, and comparing them raw would log a change that did not happen.
    const a = prev === '' || prev === undefined ? null : prev
    const b = next === '' ? null : next
    if (JSON.stringify(a) !== JSON.stringify(b)) out[field] = [a, b]
  }
  return out
}

export type PersonData = {
  firstName: string
  lastName?: string | null
  role: string
  gender?: string | null
  phone?: string | null
  email?: string | null
  birthDate?: string | null
  firstGradeYear?: number | null
  preferredLanguage?: string | null
  guardian?: number | null
  familyId?: string | null
}

export async function createPerson(tenantId: string, data: PersonData): Promise<string> {
  return db.transaction(async tx => {
    const id = await birthId(tx, 'person', tenantId)
    await tx.insert(persons).values({ id, tenantId, ...data })
    return id
  })
}

export async function updatePerson(
  tenantId: string, personId: string, data: Partial<PersonData>, changedBy?: string | null,
): Promise<void> {
  const [before] = await db
    .select().from(persons)
    .where(and(eq(persons.id, personId), eq(persons.tenantId, tenantId))).limit(1)
  if (!before) return

  const changes = diffFields(before as Record<string, unknown>, data as Record<string, unknown>)
  await db.update(persons).set(data).where(and(eq(persons.id, personId), eq(persons.tenantId, tenantId)))

  await logChanges(personId, changedBy ?? null, changes)
}

export async function softDeletePersons(tenantId: string, personIds: string[]): Promise<void> {
  if (personIds.length === 0) return
  await db.update(persons).set({ deletedAt: now() }).where(and(inArray(persons.id, personIds), eq(persons.tenantId, tenantId)))
}

// THE DELETE, LIMITED: a family is deleted only when it has no enrollment and no other history — no foreign key is
// violated by the delete.
//
// A real delete, one transaction, and the DATABASE decides whether it may
// happen: anything still referencing the family or its people raises a foreign
// key violation, the transaction rolls back whole, and the caller is told what
// held it. Nothing is checked in advance — a pre-flight count is a second
// opinion that can disagree with the constraint, and the constraint is the one
// that is true at the moment of the write.
//
// No soft delete: a family that is gone is gone, so there is no hidden-but-present state for a
// read to forget to filter, and no removed family's address stays in a live mail group.
//
// The junk a registration form wrote has no attachments, which is the case this
// exists for. A family with an enrolment, an evaluation or a tracker row cannot
// be deleted, and should not be: that is history, not debris.
//
// THE HONEST LIMIT, stated once: constraints catch only DECLARED foreign keys.
// Anything pointing at a person by a loose id with no constraint would not stop
// this.
export class FamilyStillReferenced extends Error {
  constructor(readonly by: string) {
    super(`this family cannot be deleted: ${by} still refers to it or its people`)
  }
}

type PgError = { code?: string; constraint?: string; table?: string; detail?: string }

// The driver's error, wherever the query layer put it. Drizzle wraps a failed
// query in DrizzleQueryError and keeps the real one on `cause`; a bare pg client
// throws it directly. Both shapes reach here.
export function pgError(e: unknown): PgError | null {
  for (let cur: unknown = e, depth = 0; cur && depth < 5; cur = (cur as { cause?: unknown }).cause, depth++) {
    const c = cur as PgError
    if (typeof c.code === 'string') return c
  }
  return null
}

/**
 * Every table that points at roster_families or persons, and whether the database would
 * REFUSE a delete or silently CASCADE it — read from the catalogue, never listed here.
 *
 * WHY THIS EXISTS. A delete may break no history, and letting the constraints decide does not deliver that: some
 * foreign keys are ON DELETE CASCADE, and a cascade does not raise 23503 — it deletes. A family with an enrollment
 * would be removed with its enrollments, relationships and identities, silently, reporting success.
 *
 * READ FROM pg_constraint RATHER THAN A LIST, deliberately: a list does not survive someone adding a cascade later;
 * a foreign key added tomorrow is checked the day it exists.
 *
 * THE PARENTS ARE EXACTLY THE TABLES THIS FUNCTION DELETES FROM — roster_families, persons and the record-id table
 * (a person IS its record id). The record-id table's attachments cascade too, so a family whose members carried
 * attachments would lose them silently if it were left out. That the parent list is the set of tables deleted from
 * is the property that keeps the two in step.
 *
 * THE EXCLUSION IS THAT SAME SET, and it is not the same statement: a row this delete removes
 * itself is not an outside claim on what it removes — persons.id -> the record-id table is the person being
 * deleted, not somebody holding it.
 *
 * A host's change log on a record is an outside claim like any other, and is refused by its table's name: an edited
 * person is not deleted. Nothing logs a change on create, so a registration made in error is still removable.
 */
async function claimsOnFamily(tx: typeof db, tenantId: string, familyId: string, memberIds: string[]) {
  const registry = getTableName(hostTables().registry.id.table)
  const rows = await tx.execute(sql`
    SELECT c.conrelid::regclass::text AS child_table,
           a.attname                  AS child_column,
           c.confrelid::regclass::text AS parent_table
      FROM pg_constraint c
      JOIN unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON TRUE
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
     WHERE c.contype = 'f'
       AND c.confrelid IN ('roster_families'::regclass, 'persons'::regclass, ${registry}::regclass)
       AND c.conrelid NOT IN ('roster_families'::regclass, 'persons'::regclass, ${registry}::regclass)
  `)

  const held: string[] = []
  for (const r of rows.rows as Array<{ child_table: string; child_column: string; parent_table: string }>) {
    // A person's id IS its registry id, and so is the family's: roster_families is asked about the
    // family's id, persons about the members', and the registry about both.
    const ids = r.parent_table === 'roster_families' ? [familyId]
      : r.parent_table === registry ? [...memberIds, familyId] : memberIds
    if (ids.length === 0) continue
    // An explicit IN list rather than `= ANY($1::uuid[])`: drizzle binds a JS array as ONE
    // parameter, so Postgres sees a scalar and answers "malformed array literal" from inside
    // the check. A guard that fails must fail as itself.
    const hit = await tx.execute(sql`
      SELECT 1 FROM ${sql.raw(`"${r.child_table}"`)}
       WHERE ${sql.raw(`"${r.child_column}"`)} IN (${sql.join(ids.map(i => sql`${i}`), sql`, `)})
       LIMIT 1`)
    if (hit.rows.length > 0) held.push(r.child_table)
  }
  return [...new Set(held)]
}

export async function hardDeleteFamily(tenantId: string, familyId: string): Promise<{ persons: number }> {
  try {
    return await db.transaction(async (tx) => {
      const members = await tx
        .select({ id: persons.id })
        .from(persons)
        .where(and(eq(persons.tenantId, tenantId), eq(persons.familyId, familyId)))
      const memberIds = members.map(m => m.id)

      // REFUSE BEFORE DELETING, rather than letting the constraints decide: a constraint that is
      // ON DELETE CASCADE takes its rows with it without a word, and the guarantee cannot depend on
      // which constraints happen to cascade. Inside the transaction, so the check and the delete
      // see the same rows.
      const held = await claimsOnFamily(tx as unknown as typeof db, tenantId, familyId, memberIds)
      if (held.length > 0) throw new FamilyStillReferenced(held.join(', '))

      // The family's own parent pointers reference these persons, so they are cut
      // first — they are part of the family being deleted, not an outside claim on
      // it, and leaving them would make the family hold its own people hostage.
      await tx.update(rosterFamilies)
        .set({ motherId: null, fatherId: null })
        .where(and(eq(rosterFamilies.id, familyId), eq(rosterFamilies.tenantId, tenantId)))

      if (memberIds.length > 0) {
        await tx.delete(persons)
          .where(and(inArray(persons.id, memberIds), eq(persons.tenantId, tenantId)))
        // A person IS its record id (persons.id references the registry). Leaving the registry
        // row behind is exactly the debris this delete exists to remove — an id
        // that resolves to nothing.
        await dropIds(tx, memberIds, tenantId)
      }

      await tx.delete(rosterFamilies)
        .where(and(eq(rosterFamilies.id, familyId), eq(rosterFamilies.tenantId, tenantId)))
      // The family is a record id: its registry row goes last, once nothing names it.
      await dropIds(tx, [familyId], tenantId)

      return { persons: memberIds.length }
    })
  } catch (e) {
    // 23503 is Postgres' foreign_key_violation. The constraint name carries the
    // table that still points here, which is the sentence the person needs — a
    // bare "could not delete" sends them looking, and looking is what a delete
    // behind a confirmation is supposed to spare them.
    //
    // UNWRAP FIRST: drizzle raises DrizzleQueryError and hangs the driver's error
    // off `cause`, so reading `code` from the top-level object finds nothing and
    // every refusal escapes as a 500 — a shape only a real database produces.
    const pg = pgError(e)
    if (pg?.code === '23503') {
      throw new FamilyStillReferenced(pg.table || pg.constraint || pg.detail || 'another record')
    }
    throw e
  }
}

export async function getActiveStudents(tenantId: string, familyId: string): Promise<{ id: string }[]> {
  return db
    .select({ id: persons.id })
    .from(persons)
    .where(and(
      eq(persons.tenantId, tenantId),
      eq(persons.familyId, familyId),
      inArray(persons.role, ['boy', 'girl']),
      isNull(persons.deletedAt),
    ))
}

export type FamilyData = {
  motherId?: string | null
  fatherId?: string | null
  addr1?: string | null
  addr2?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
}

// Every family gets its tenant's next family number at birth, through this one door; callers must not pass
// legacyFamilyId themselves. Each tenant numbers its own families.
export async function nextLegacyFamilyId(tenantId: string): Promise<number> {
  const [{ maxId }] = await db.select({ maxId: max(rosterFamilies.legacyFamilyId) }).from(rosterFamilies)
    .where(eq(rosterFamilies.tenantId, tenantId))
  return (maxId ?? 0) + 1
}

export async function createFamily(tenantId: string, data: FamilyData): Promise<string> {
  const legacyFamilyId = await nextLegacyFamilyId(tenantId)
  return db.transaction(async tx => {
    const id = await birthId(tx, 'family', tenantId)
    await tx.insert(rosterFamilies).values({ id, tenantId, legacyFamilyId, ...data })
    return id
  })
}

// A deleted family is not found because it is GONE — there is no hidden-but-present state for a
// read to forget to filter.
export async function getFamily(tenantId: string, familyId: string) {
  const [family] = await db
    .select()
    .from(rosterFamilies)
    .where(and(
      eq(rosterFamilies.id, familyId),
      eq(rosterFamilies.tenantId, tenantId),
    ))
    .limit(1)
  return family ?? null
}

// A family's address changes are attributed to the family's MOTHER row when one
// exists, else the father's — the family is the entity, and its record is
// reached through its parents. Recorded with a
// 'family.' prefix so a reader can always tell a family fact from a personal
// one, and so the two never collide on a field name.
async function familyChangeSubject(tenantId: string, familyId: string): Promise<string | null> {
  const [f] = await db
    .select({ motherId: rosterFamilies.motherId, fatherId: rosterFamilies.fatherId })
    .from(rosterFamilies)
    .where(and(eq(rosterFamilies.id, familyId), eq(rosterFamilies.tenantId, tenantId))).limit(1)
  return f?.motherId ?? f?.fatherId ?? null
}

export async function updateFamily(
  tenantId: string, familyId: string, data: FamilyData, changedBy?: string | null,
): Promise<void> {
  const [before] = await db
    .select().from(rosterFamilies)
    .where(and(eq(rosterFamilies.id, familyId), eq(rosterFamilies.tenantId, tenantId))).limit(1)
  if (!before) return

  const changes = diffFields(before as Record<string, unknown>, data as Record<string, unknown>)
  await db.update(rosterFamilies).set(data).where(and(eq(rosterFamilies.id, familyId), eq(rosterFamilies.tenantId, tenantId)))

  if (Object.keys(changes).length === 0) return
  const subject = await familyChangeSubject(tenantId, familyId)
  if (!subject) return   // a family with no parent yet has nothing to hang history on
  await logChanges(subject, changedBy ?? null,
    Object.fromEntries(Object.entries(changes).map(([field, change]) => [`family.${field}`, change])))
}

export type FieldChange = {
  id: string
  changedAt: Date
  field: string
  oldValue: unknown
  newValue: unknown
  changedByName: string | null
}

// The history a person's record shows. Family changes hang off the parent row,
// so a family's address history appears on both parents' records — which is
// correct: it is the family's fact, and either parent may have made it.
export async function getFieldHistory(personId: string, limit = 50): Promise<FieldChange[]> {
  return fieldHistory(personId, limit)
}

/** A family just made names its parents, who were born into it (createFamilyAct). */
export async function setFamilyParents(tenantId: string, familyId: string, motherId: string | null, fatherId: string | null): Promise<void> {
  await db.update(rosterFamilies).set({ motherId, fatherId }).where(and(eq(rosterFamilies.id, familyId), eq(rosterFamilies.tenantId, tenantId)))
}

export async function batchInsertTrackerRows(tenantId: string, familyIds: string[], year: number, status: number): Promise<void> {
  if (familyIds.length === 0) return
  await db.insert(rosterFamilyTracker)
    .values(familyIds.map(familyId => ({ tenantId, familyId, year, enrollmentStatus: status })))
    .onConflictDoNothing()
}

export async function setTrackerStatus(tenantId: string, familyId: string, year: number, status: number): Promise<void> {
  await db.update(rosterFamilyTracker)
    .set({ enrollmentStatus: status })
    .where(and(
      eq(rosterFamilyTracker.tenantId, tenantId),
      eq(rosterFamilyTracker.familyId, familyId),
      eq(rosterFamilyTracker.year, year),
    ))
}

export async function upsertTrackerStatusUpdate(tenantId: string, familyId: string, year: number, status: number): Promise<void> {
  await db.insert(rosterFamilyTracker)
    .values({ tenantId, familyId, year, enrollmentStatus: status })
    .onConflictDoUpdate({
      target: [rosterFamilyTracker.tenantId, rosterFamilyTracker.familyId, rosterFamilyTracker.year],
      set: { enrollmentStatus: status },
    })
}

export async function getPersonByEmail(tenantId: string, email: string) {
  const [person] = await db
    .select({ id: persons.id, role: persons.role, familyId: persons.familyId })
    .from(persons)
    .where(and(eq(persons.tenantId, tenantId), sql`lower(${persons.email}) = lower(${email})`, isNull(persons.deletedAt)))
    .limit(1)
  return person ?? null
}

// WHO ALREADY HOLDS THIS ADDRESS — one address per person is a UNIQUE INDEX
// (persons_tenant_email_unique, on tenant + lower(email) where not deleted), so a save
// that collides raises 23505 from whichever write happens to hit it first, and the caller
// would know only "some address, somewhere". This names who holds it.
//
// `exceptPersonId` is the row being written: putting an address back on the person who
// already has it is not a collision, and treating it as one would refuse every save that
// leaves a parent's own address alone.
export async function findEmailOwner(tenantId: string, email: string, exceptPersonId: string | null) {
  const [owner] = await db
    .select({ id: persons.id, firstName: persons.firstName, lastName: persons.lastName, familyId: persons.familyId })
    .from(persons)
    .where(and(
      eq(persons.tenantId, tenantId),
      sql`btrim(lower(${persons.email})) = btrim(lower(${email}))`,
      isNull(persons.deletedAt),
      ...(exceptPersonId ? [sql`${persons.id} <> ${exceptPersonId}`] : []),
    ))
    .limit(1)
  return owner ?? null
}

export async function getAllFamilyIds(tenantId: string): Promise<string[]> {
  const rows = await db
    .select({ id: rosterFamilies.id })
    .from(rosterFamilies)
    .where(eq(rosterFamilies.tenantId, tenantId))
  return rows.map(r => r.id)
}

export async function getPersonsByIds(tenantId: string, personIds: string[]) {
  if (personIds.length === 0) return []
  return db.select().from(persons).where(and(eq(persons.tenantId, tenantId), inArray(persons.id, personIds), isNull(persons.deletedAt)))
}

// An id that is not a UUID names nobody. Asked of Postgres it is a 500 (a uuid column refuses
// the cast), so a person page for a non-id would crash instead of answering 404.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function getPersonById(tenantId: string, personId: string) {
  if (!UUID_RE.test(personId)) return null
  const [person] = await db
    .select()
    .from(persons)
    .where(and(eq(persons.id, personId), eq(persons.tenantId, tenantId), isNull(persons.deletedAt)))
    .limit(1)
  return person ?? null
}

export async function getFamilyMembers(tenantId: string, familyId: string) {
  return db
    .select()
    .from(persons)
    .where(and(
      eq(persons.tenantId, tenantId),
      eq(persons.familyId, familyId),
      isNull(persons.deletedAt),
    ))
    .orderBy(persons.role, persons.firstName)
}

// What a family is called lives in family-label.ts, which has no store.
export { familySurname } from './family-label'
