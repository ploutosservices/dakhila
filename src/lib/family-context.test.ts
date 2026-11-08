import { describe, it, expect } from 'vitest'
import { buildFees, money, assertDeIdentified, emptyFamilyContext } from './family-context'

import { FAKE_RULES } from '../ports-fake'
import { moneyRules } from './fees'

// The invented school's currency and number locale; the roster prints money with two decimals and no grouping.
const CUR = moneyRules(FAKE_RULES)
/** An amount as the invented school prints it: "150,00 €", the space unbreakable. */
const eur = (s: string) => `${s} €`
import { schoolYearLabel } from './enrollment'

describe('money', () => {
  it('always renders two decimals so a model can quote it verbatim', () => {
    expect(money(150, CUR)).toBe(eur('150,00'))
    expect(money(0, CUR)).toBe(eur('0,00'))
    expect(money(1458.5, CUR)).toBe(eur('1458,50'))
  })
})

describe('buildFees — FEE === incoming cash with the character of tuition', () => {
  it('sums tuition cash into the fee', () => {
    const f = buildFees({ money: CUR,
      year: 2026, status: 'enrolled', registrationDate: '2026-06-01',
      received: [{ character: 'tuition', amount: 150 }],
    })
    expect(f.fee).toBe(150)
    expect(f.unpaid).toBe(false)
    expect(f.display.fee).toBe(eur('150,00'))
  })

  // A family with no cash is REPORTED, not omitted — and it says unpaid rather than leaving a blank to interpret.
  it('a family that paid nothing is reported as unpaid, not as missing data', () => {
    const f = buildFees({ money: CUR,
      year: 2026, status: 'pending', registrationDate: null,
      received: [],
    })
    expect(f.fee).toBe(0)
    expect(f.unpaid).toBe(true)
    expect(f.display.fee).toBe(eur('0,00'))
    expect(f.received).toEqual([])
  })

  // FEE-RULE R5. The character is stored on the payment, so a non-tuition arrival can
  // never inflate the fee — it rides along in `received` and stops there.
  it('non-tuition cash rides along in received but never lands in the fee', () => {
    const f = buildFees({ money: CUR,
      year: 2026, status: 'enrolled', registrationDate: null,
      received: [{ character: 'donation', amount: 500 }, { character: 'tuition', amount: 150 }],
    })
    expect(f.fee).toBe(150)
    expect(f.received.map(r => r.character)).toEqual(['donation', 'tuition'])
    expect(f.received.find(r => r.character === 'donation')!.display).toBe(eur('500,00'))
  })

  it('partial payments add up to one fee figure', () => {
    const f = buildFees({ money: CUR,
      year: 2026, status: 'enrolled', registrationDate: null,
      received: [{ character: 'tuition', amount: 100 }, { character: 'tuition', amount: 50 }],
    })
    expect(f.fee).toBe(150)
  })

  it('carries the registration date through verbatim — a date has no timezone', () => {
    const f = buildFees({ money: CUR,
      year: 2019, status: 'Registered', registrationDate: '2019-08-14',
      received: [],
    })
    expect(f.registrationDate).toBe('2019-08-14')
    expect(f.schoolYear).toBe(schoolYearLabel(2019))
  })
})

const UNAVAILABLE = { attendance: 'none kept', announcements: 'none kept', calendar: 'school-wide only' }

describe('placeholders — kept so a missing candidate is not forgotten', () => {
  it('the empty (non-member) answer carries the same shape as a real one', () => {
    const c = emptyFamilyContext(2026, new Date('2026-07-23T00:00:00Z'), UNAVAILABLE)
    expect(c.familyId).toBeNull()
    expect(c.students).toEqual([])
    expect(c.fees).toBeNull()
    expect(c.evaluations).toEqual([])
    expect(c.attendance).toEqual([])
    expect(c.announcements).toEqual([])
    expect(c.calendar).toEqual([])
  })

  // An empty array must never be read as "this family has none" — every placeholder says
  // why it is empty, in the host's words.
  it('every placeholder has the reason the host hands in', () => {
    const c = emptyFamilyContext(2026, new Date('2026-07-23T00:00:00Z'), UNAVAILABLE)
    expect(c.unavailable).toEqual(UNAVAILABLE)
  })

  it('the placeholders survive the de-identification gate', () => {
    expect(() => assertDeIdentified(emptyFamilyContext(2026, new Date(), UNAVAILABLE))).not.toThrow()
  })
})

describe('assertDeIdentified — the invariant is enforced, not promised', () => {
  it('passes a well-formed payload', () => {
    expect(() => assertDeIdentified({
      familyId: 'f-1',
      students: [{ key: 'p-1', classes: [{ shortCode: 'X3', fullName: 'Lang A 1', joinUrl: null }] }],
      fees: { amountDue: 150, display: { due: eur('150,00') } },
      evaluations: [{ studentKey: 'p-1', classFullName: 'Lang A 1' }],
    })).not.toThrow()
  })

  it('rejects a name anywhere in the tree', () => {
    expect(() => assertDeIdentified({
      students: [{ key: 'p-1', name: 'Otto' }],
    })).toThrow(/personal field "name"/)
  })

  it('rejects personal fields however deeply nested', () => {
    expect(() => assertDeIdentified({
      a: { b: [{ c: { dateOfBirth: '2015-04-02' } }] },
    })).toThrow(/dateOfBirth/)
  })

  it('rejects contact and address fields', () => {
    expect(() => assertDeIdentified({ email: 'x@example.test' })).toThrow()
    expect(() => assertDeIdentified({ phone: '555' })).toThrow()
    expect(() => assertDeIdentified({ addr1: '1 Main St' })).toThrow()
    expect(() => assertDeIdentified({ zip: '00000' })).toThrow()
    expect(() => assertDeIdentified({ age: 11 })).toThrow()
  })

  it('allows a CLASS fullName — a course title is not a person', () => {
    expect(() => assertDeIdentified({
      classes: [{ fullName: 'Lang A 1' }],
      evaluations: [{ classFullName: 'Lang A 1' }],
    })).not.toThrow()
  })

  it('names the reason in the error so the next person understands the rule', () => {
    expect(() => assertDeIdentified({ firstName: 'Otto' })).toThrow(/must carry no names/)
  })
})
