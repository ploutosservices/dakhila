function pgCause(err: unknown): { code?: string; constraint?: string } | null {
  const cause = (err as { cause?: unknown } | null)?.cause
  return cause && typeof cause === 'object' ? cause as { code?: string; constraint?: string } : null
}

export function isDuplicateEmailError(err: unknown): boolean {
  const cause = pgCause(err)
  return cause?.code === '23505' && cause?.constraint === 'persons_tenant_email_unique'
}

/** A phone number another live person already holds (persons_tenant_phone_unique). */
export function isDuplicatePhoneError(err: unknown): boolean {
  const cause = pgCause(err)
  return cause?.code === '23505' && cause?.constraint === 'persons_tenant_phone_unique'
}

/** What a person is told when the number they typed belongs to someone else. */
export const DUPLICATE_PHONE_MESSAGE = 'That phone number already belongs to someone in the roster. Every adult needs their own number; leave it blank for a child.'
