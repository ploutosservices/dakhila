// THE FEE ENGINE'S LOGIC on an invented school (ports-fake.ts FAKE_RULES): tiers, grace, the schedule, the words and the
// card gross-up, in a zone that is not the server's. A host tests its own school's rules in its own suite.
import { describe, expect, test } from 'vitest'
import { FAKE_RULES } from '../ports-fake'
import { calculateFee, carriesCardFee, creditCardFee, creditCardFeeRule, creditCardTotal, feeRuleWords, feeSchedule, feeTier, feeTierNote, type FeeContext } from './fees'
import { countedChildren, tuitionOwed } from './tuition-owed'

// Berlin: +01:00 in March before the switch, +02:00 from April.
const c: FeeContext = { fees: FAKE_RULES.fees, currency: FAKE_RULES.currency, numbers: FAKE_RULES.locale.numbers, timezone: 'Europe/Berlin', language: FAKE_RULES.locale.language }

describe('tiers end at the school day in its zone, with the grace after', () => {
  const cases: Array<[string, string, number]> = [
    ['2026-03-15T01:59:00+01:00', 'early', 60],      // inside the 2-hour grace after March 15
    ['2026-03-15T02:01:00+01:00', 'standard', 70],
    ['2026-04-15T01:59:00+02:00', 'standard', 70],
    ['2026-04-15T02:01:00+02:00', 'late', 85],
  ]
  for (const [at, tier, two] of cases) {
    test(`${at} is ${tier}`, () => {
      const d = new Date(at)
      expect(feeTier(c, d)).toBe(tier)
      expect(calculateFee(c, 2, d)).toBe(two)
      expect(feeSchedule(c, 2, d).find(r => r.current)!.amount).toBe(two)
    })
  }
  test('no children cost nothing', () => expect(calculateFee(c, 0, new Date('2026-01-10T12:00:00Z'))).toBe(0))
})

describe('the schedule and its words come from the rules', () => {
  test('ahead of every tier', () => {
    const rows = feeSchedule(c, 1, new Date('2026-01-10T12:00:00Z'))
    expect(rows.map(r => [r.place, r.period, r.label, r.amount])).toEqual([
      ['first', 'Before 15. März', 'Early', 30], ['middle', '15. März – 14. April', 'Standard', 40], ['last', '15. April onwards', 'Late', 55],
    ])
  })
  test('an expired tier is never shown', () => {
    expect(feeSchedule(c, 1, new Date('2026-05-01T12:00:00Z')).map(r => r.tier)).toEqual(['late'])
  })
  test('the rule and the notes, in the school currency', () => {
    // The invented school prints its numbers in de-DE: the amount, an unbreakable space, the sign.
    const eur = (n: number) => `${n} €`
    expect(feeRuleWords(c)).toBe(`${eur(40)} first student, ${eur(30)} each additional. ${eur(10)} per-family discount before 15. März; ${eur(15)} per-family surcharge from 15. April.`)
    expect(feeTierNote(c, new Date('2026-01-10T12:00:00Z')).rest).toBe(`Enroll before 15. März to receive the early discount of ${eur(10)} per family.`)
    expect(feeTierNote(c, new Date('2026-04-01T12:00:00Z')).strong).toBe('The standard enrollment period is in effect (15. März – 14. April).')
  })
})

describe('which cards carry the fee, and the rule in words', () => {
  test("the school's cards carry it, others and no card do not", () => {
    expect(carriesCardFee(c, 'CREDIT')).toBe(true)
    expect(carriesCardFee(c, 'STORE')).toBe(true)
    expect(carriesCardFee(c, 'DEBIT')).toBe(false)
    expect(carriesCardFee(c, null)).toBe(false)
  })
  test('the rule names the cards, the rate, the processor and the cards it names free', () => {
    expect(creditCardFeeRule(c)).toBe(`A credit card or store card adds 3% + 0,30 € to cover Card Co's charge; debit cards and prepaid cards and Card Co do not. You see the fee and the total before you pay.`)
  })
})

describe('the card total is the smallest that leaves the amount whole', () => {
  for (const way of ['card', 'apple_pay'] as const) {
    test(way, () => {
      for (let cents = 100; cents <= 50000; cents += 37) {
        const g = creditCardTotal(c, cents / 100, way)
        expect(Math.round((g - creditCardFee(c, g, way)) * 100)).toBeGreaterThanOrEqual(cents)
        const below = Math.round(g * 100 - 1) / 100
        expect(Math.round((below - creditCardFee(c, below, way)) * 100)).toBeLessThan(cents)
      }
    })
  }
})

describe('what is owed', () => {
  test('a drop-out on or before the school day, in its zone, is not counted', () => {
    expect(countedChildren(c, 2026, [null, new Date('2026-04-30T21:59:00Z')])).toBe(1)   // 23:59 April 30 in Berlin
    expect(countedChildren(c, 2026, [null, new Date('2026-04-30T22:01:00Z')])).toBe(2)   // 00:01 May 1 in Berlin
  })
  test('unpaid is priced at the instant given', () => {
    expect(tuitionOwed(c, { status: 'enrolled', year: 2026, firstPaid: null, droppedOutAt: [null] }, new Date('2026-05-01T12:00:00Z'))).toBe(55)
    expect(tuitionOwed(c, { status: 'cancelled', year: 2026, firstPaid: null, droppedOutAt: [null] }, new Date('2026-05-01T12:00:00Z'))).toBe(0)
  })
})
