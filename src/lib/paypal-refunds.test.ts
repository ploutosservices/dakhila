import { describe, expect, test } from 'vitest'
import { refundAmountRefusal, tuitionPart } from './paypal-refunds'
import { moneyRules } from './fees'
import { FAKE_RULES } from '../ports-fake'
import { ROLE_BUNDLES } from '../access-rule'

describe('a refund amount', () => {
  test('the remainder or less is refunded; more, nothing, or a fraction of a cent is refused', () => {
    const m = moneyRules(FAKE_RULES)
    expect(refundAmountRefusal(52.53, 52.53, m)).toBeNull()
    expect(refundAmountRefusal(0.5, 1.52, m)).toBeNull()
    expect(refundAmountRefusal(500, 52.53, m)).toMatch(/At most 52,53 €/)
    expect(refundAmountRefusal(0, 10, m)).toMatch(/greater than zero/)
    expect(refundAmountRefusal(1.005, 10, m)).toMatch(/two decimal places/)
  })
})

describe('the tuition part of a refund: tuition first, the card fee after it',() => {
  test('100 of tuition paid as 102.53: 50, then 52.53, gives back 50 and 50 of tuition', () => {
    expect(tuitionPart(50, 0, 100)).toBe(50)
    expect(tuitionPart(52.53, 50, 100)).toBe(50)
  })
  test('a refund of the fee alone, after all the tuition, gives back no tuition', () => {
    expect(tuitionPart(2.53, 100, 100)).toBe(0)
  })
})

describe('who may refund: bursar.approve, in the accounting bundle', () => {
  test('accounting holds it; a family and a teacher do not', () => {
    expect(ROLE_BUNDLES.accounting).toContain('bursar.approve')
    expect(ROLE_BUNDLES.family).not.toContain('bursar.approve')
    expect(ROLE_BUNDLES.teacher).not.toContain('bursar.approve')
  })
})
