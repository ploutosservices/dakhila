import { describe, expect, test } from 'vitest'
import { isDuplicateEmailError, isDuplicatePhoneError } from './db-errors'

describe('isDuplicateEmailError', () => {
  test('true for a persons_tenant_email_unique violation', () => {
    const err = new Error('Failed query: insert into "persons" ...', {
      cause: { code: '23505', constraint: 'persons_tenant_email_unique' },
    })
    expect(isDuplicateEmailError(err)).toBe(true)
  })

  test('false for a different unique constraint violation', () => {
    const err = new Error('Failed query', {
      cause: { code: '23505', constraint: 'some_other_unique_index' },
    })
    expect(isDuplicateEmailError(err)).toBe(false)
  })

  test('false for a non-DB error', () => {
    expect(isDuplicateEmailError(new Error('Forbidden'))).toBe(false)
  })

  test('false for a non-error value', () => {
    expect(isDuplicateEmailError('not an error')).toBe(false)
  })
})

describe('isDuplicatePhoneError', () => {
  test('true for a persons_tenant_phone_unique violation', () => {
    expect(isDuplicatePhoneError({ cause: { code: '23505', constraint: 'persons_tenant_phone_unique' } })).toBe(true)
  })
  test('false for the email index or another code', () => {
    expect(isDuplicatePhoneError({ cause: { code: '23505', constraint: 'persons_tenant_email_unique' } })).toBe(false)
    expect(isDuplicatePhoneError({ cause: { code: '23503', constraint: 'persons_tenant_phone_unique' } })).toBe(false)
  })
})
