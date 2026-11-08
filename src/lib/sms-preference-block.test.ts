import { describe, it, expect, vi } from 'vitest'

// The texting preference in an email: the three states from the facts, and the block's
// words.
vi.mock('./db', () => ({ db: {} }))

import { textingState } from './sms-consent'
import { blockOf, stateLines } from './sms-preference-block'
import { e164 as e164With } from './phone-e164'

// A country whose national numbers are ten digits under code 1, as an example rule.
const e164 = (raw: string) => e164With(raw, { countryCode: '1', nationalDigits: 10, nationalFormat: '(###) ###-####' })

describe('the three states', () => {
  const none = { live: false, ended: false, optedOut: false, stopped: false }
  it('send: a live yes for the number held today', () => {
    expect(textingState({ ...none, live: true })).toBe('send')
    expect(textingState({ ...none, live: true, ended: true })).toBe('send')   // an earlier yes ended, a new one live
  })
  it('do not send: opted out, a yes that ended, or a STOP', () => {
    expect(textingState({ ...none, optedOut: true })).toBe('do-not-send')
    expect(textingState({ ...none, ended: true })).toBe('do-not-send')
    expect(textingState({ ...none, stopped: true })).toBe('do-not-send')   // a STOP with no consent row ever
  })
  it('ask: nothing at all for this number', () => {
    expect(textingState(none)).toBe('ask')
  })
  it('the roster\'s written number and the stored E.164 are one number', () => {
    expect(e164('(555) 555-1234')).toBe('+15555551234')
    expect(e164('555.555.1234')).toBe('+15555551234')
    expect(e164('1-555-555-1234')).toBe('+15555551234')
  })
})

describe('the block', () => {
  const url = 'https://roster.example.test/school/dashboard'
  const reminder = 'a text the evening before an example event'
  const place = 'the example place'
  it('the block\'s words with the school\'s reminder, one line per number, and the link to the school\'s place', () => {
    const b = blockOf([{ phone: '(555) 555-1234', state: 'send' }, { phone: '(555) 555-9876', state: 'ask' }, { phone: '555 555 0000', state: 'do-not-send' }], url, reminder, place)!
    expect(stateLines(reminder)).toEqual({ send: `we will send ${reminder}`, 'do-not-send': 'you have opted not to get SMS', ask: 'please update your preference' })
    expect(b.text).toBe([
      'Text messages:',
      `  (555) 555-1234: we will send ${reminder}`,
      '  (555) 555-9876: please update your preference',
      '  555 555 0000: you have opted not to get SMS',
      `To change yours, sign in to ${place}: ${url}`,
    ].join('\n'))
    expect(b.html).toContain(`<a href="${url}">${place}</a>`)
  })
  it('escapes what the roster wrote', () => {
    const b = blockOf([{ phone: '<b>555</b> & co', state: 'ask' }], url, reminder, place)!
    expect(b.html).toContain('&lt;b&gt;555&lt;/b&gt; &amp; co')
    expect(b.html).not.toContain('<b>555')
  })
  it('no numbers, no block', () => {
    expect(blockOf([], url, reminder, place)).toBeNull()
  })
})
