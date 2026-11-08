import { describe, it, expect } from 'vitest'
import { meetUrl, parseMeetCode } from './meet-url'

describe('parseMeetCode — the last part of whatever Google Classroom copied', () => {
  it('keeps a bare code', () => {
    expect(parseMeetCode('abc-defg-hij')).toBe('abc-defg-hij')
  })
  it('takes the code out of the full link Google Classroom copies', () => {
    expect(parseMeetCode('https://meet.google.com/abc-defg-hij')).toBe('abc-defg-hij')
  })
  it('drops the query string Google appends', () => {
    expect(parseMeetCode('https://meet.google.com/abc-defg-hij?authuser=0&hs=122')).toBe('abc-defg-hij')
  })
  it('ignores words pasted in front of the link', () => {
    expect(parseMeetCode('Meet link: https://meet.google.com/abc-defg-hij')).toBe('abc-defg-hij')
  })
  it('tolerates a trailing slash, surrounding spaces and capitals', () => {
    expect(parseMeetCode('  HTTPS://MEET.GOOGLE.COM/ABC-DEFG-HIJ/  ')).toBe('abc-defg-hij')
  })
  it('falls back to the last path segment when the text has no code shape', () => {
    expect(parseMeetCode('https://meet.google.com/lookup/abcxyz123')).toBe('abcxyz123')
  })
  it('is null for nothing, and for a bare host with no code', () => {
    expect(parseMeetCode('')).toBeNull()
    expect(parseMeetCode('   ')).toBeNull()
    expect(parseMeetCode(undefined)).toBeNull()
    expect(parseMeetCode('https://meet.google.com/')).toBeNull()
    expect(parseMeetCode('meet.google.com')).toBeNull()
  })
  it('round-trips through meetUrl', () => {
    expect(meetUrl(parseMeetCode('https://meet.google.com/abc-defg-hij?hs=1'))).toBe('https://meet.google.com/abc-defg-hij')
  })
})
