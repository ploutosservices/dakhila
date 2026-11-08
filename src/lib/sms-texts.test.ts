import { describe, it, expect, vi } from 'vitest'

// The rules of texting in the roster, as pure functions: what an incoming
// text does, row for row; what staff are shown; who staff may text; which status moves a text forward.
vi.mock('./db', () => ({ db: {} }))
vi.mock('./three-universes', () => ({ participants: () => null }))
vi.mock('./three-universes-load', () => ({ runThreeUniverses: async () => ({ accepted: false }) }))

import { decideNew, inboundAct, isUnread, shownOnArrival, statusMoves } from './sms-texts'

describe('unread for the principal —an incoming shown text, unmarked, whose sender staff see today', () => {
  const unread = { direction: 'in' as const, shown: true, readAt: null, senderShown: true }
  it('is unread', () => { expect(isUnread(unread)).toBe(true) })
  it('an outgoing text is not', () => { expect(isUnread({ ...unread, direction: 'out' })).toBe(false) })
  it('a text never shown to staff is not', () => { expect(isUnread({ ...unread, shown: false })).toBe(false) })
  it('a marked text is not', () => { expect(isUnread({ ...unread, readAt: new Date() })).toBe(false) })
  it('a sender no longer shown to staff — texts off, number changed, out of the map — is not', () => {
    expect(isUnread({ ...unread, senderShown: false })).toBe(false)
  })
})

describe('an incoming text — what it does', () => {
  const base = { keyword: null, person: true, mapped: true, consented: true } as const
  it('STOP ends every consent for the number, whoever sent it', () => {
    expect(inboundAct({ ...base, keyword: 'STOP' })).toBe('end-consent')
    expect(inboundAct({ ...base, keyword: 'STOP', person: false, mapped: false, consented: false })).toBe('end-consent')
    expect(inboundAct({ ...base, keyword: 'STOP', mapped: null })).toBe('end-consent')
  })
  it('HELP: nothing — Twilio has answered', () => {
    expect(inboundAct({ ...base, keyword: 'HELP' })).toBe('nothing')
    expect(inboundAct({ ...base, keyword: 'HELP', person: false, mapped: false })).toBe('nothing')
  })
  it('START from a participant records their yes; from anyone else, the reply', () => {
    expect(inboundAct({ ...base, keyword: 'START', consented: false })).toBe('record-consent')
    expect(inboundAct({ ...base, keyword: 'START', mapped: false })).toBe('reply')
    expect(inboundAct({ ...base, keyword: 'START', person: false, mapped: false })).toBe('reply')
  })
  it('a participant with texts on: staff see it', () => {
    expect(inboundAct(base)).toBe('show')
  })
  it('anyone else — not in the map, unknown, or texts off — gets the reply and is never shown', () => {
    expect(inboundAct({ ...base, consented: false })).toBe('reply')
    expect(inboundAct({ ...base, mapped: false, consented: false })).toBe('reply')
    expect(inboundAct({ ...base, person: false, mapped: false, consented: false })).toBe('reply')
  })
  it('a refused map: kept, nothing sent, nothing shown', () => {
    expect(inboundAct({ ...base, mapped: null, consented: false })).toBe('nothing')
    expect(inboundAct({ ...base, keyword: 'START', mapped: null })).toBe('nothing')
  })
})

describe('shown on arrival — staff see a consented participant\'s text and the STOP that ends it, nothing else', () => {
  it('consented', () => {
    expect(shownOnArrival({ keyword: null, consented: true })).toBe(true)
    expect(shownOnArrival({ keyword: 'STOP', consented: true })).toBe(true)
    expect(shownOnArrival({ keyword: 'HELP', consented: true })).toBe(false)
    expect(shownOnArrival({ keyword: 'START', consented: true })).toBe(false)
  })
  it('not consented — never, so a later yes does not reveal it', () => {
    for (const keyword of [null, 'STOP', 'START', 'HELP'] as const) expect(shownOnArrival({ keyword, consented: false })).toBe(false)
  })
})

describe('a text staff start', () => {
  const ok = { name: 'Ann Example', inMap: true, consentRow: 'c1', saidStop: false }
  it('goes to a participant whose texts are on, under that consent row', () => {
    expect(decideNew(ok)).toEqual({ ok: true, consentRow: 'c1' })
  })
  it('is refused by name otherwise', () => {
    expect(decideNew({ ...ok, saidStop: true })).toEqual({ ok: false, refused: 'Ann Example texted STOP' })
    expect(decideNew({ ...ok, consentRow: null })).toEqual({ ok: false, refused: 'Ann Example has not turned on school texts' })
    expect(decideNew({ ...ok, inMap: false })).toEqual({ ok: false, refused: "Ann Example is not in this year's map" })
    expect(decideNew({ ...ok, inMap: null }).ok).toBe(false)
  })
})

describe('a status moves forward only', () => {
  it('in Twilio\'s order', () => {
    expect(statusMoves('queued', 'sent')).toBe(true)
    expect(statusMoves('sent', 'delivered')).toBe(true)
    expect(statusMoves('delivered', 'sent')).toBe(false)
    expect(statusMoves('delivered', 'delivered')).toBe(false)
  })
  it('a final status never moves; an unknown one never moves a text', () => {
    expect(statusMoves('failed', 'delivered')).toBe(false)
    expect(statusMoves('undelivered', 'sent')).toBe(false)
    expect(statusMoves('sent', 'bogus')).toBe(false)
    expect(statusMoves(null, 'queued')).toBe(true)
  })
})
