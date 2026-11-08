// PERSONS BY ID, NAMED — the one read a screen needs to print who a list of ids is.
import { inArray } from 'drizzle-orm'
import { db } from './db'
import { persons } from '../tables'

/** First and last names of the given persons (deleted rows included — the ids came from somewhere that names them). */
export async function personNames(personIds: string[]) {
  if (!personIds.length) return []
  return db.select({ id: persons.id, firstName: persons.firstName, lastName: persons.lastName })
    .from(persons).where(inArray(persons.id, personIds))
}
