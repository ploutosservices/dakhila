// How an email address is written to the database — a pure function, with no database, no session and no mail.

/**
 * The one way an email address is written to the database.
 *
 * Trim and lowercase, and nothing else. An address is a RESOURCE with exactly
 * one holder, and `Name@example.test` and `name@example.test` are the
 * same resource — storing both would let one person hold it twice and defeat the
 * unique index, which is the key everything else resolves through: a classroom
 * membership is matched back to an individual by address alone.
 *
 * It deliberately does NOT repair anything else. An address stored with a stray
 * character is the family's data, and correcting it here would be policing,
 * which is not ours to do. Case is different — it is not a
 * different value, it is the same value written differently.
 */
export function normalizeEmail(v: string | null | undefined): string | null {
  const e = (v ?? '').trim().toLowerCase()
  return e || null
}
