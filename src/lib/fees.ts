// THE ENROLLMENT FEE, over the school's rules (SchoolRules.fees, handed in by the host). The roster holds the logic
// and no school's number: a base for the first child and each after, tiers that add
// to it (a discount early, a surcharge late), each ending at a day of the year read in the tenant's zone with a grace
// window after it, and a card processor's rate per way a card pays.
//
// One partition: what a family is quoted and what it is charged come from the same tier, grace window included, so a
// quote and a charge never disagree. An expired tier is never shown: quoting a price a family can no longer get is the
// defect the schedule exists to prevent.
//
// THE CARD FEE. A credit card pays the processor's rate on top of the amount A; other ways pay A. The total G is the
// smallest whose fee, round(rate x G) + fixed, leaves A whole, so the fee equals the processor's charge and never
// exceeds it. Worked in cents, so no float decides a cent.
// Pure: it takes a fee context as an argument (fee-context.ts reads one through the ports).
import type { CardType, CardWay, SchoolRules } from '../ports'
import { dayBefore, dayWords, partsIn, startOfDayIn } from './zoned'

export type { CardWay } from '../ports'

/** How the school prints money: its currency, and the locale its numbers print in (SchoolRules.locale.numbers). */
export type MoneyRules = { currency: string; numbers: string }

/** What the fee engine reads: the school's fee rules, its money, its zone and the language its dates print in. */
export type FeeContext = MoneyRules & { fees: SchoolRules['fees']; timezone: string; language: string }

/** The school's money rules, from its rules. */
export function moneyRules(r: Pick<SchoolRules, 'currency' | 'locale'>): MoneyRules {
  return { currency: r.currency, numbers: r.locale.numbers }
}

/** An amount in the school's currency, whole units without cents, with cents when it has them. */
export function money(c: MoneyRules, amount: number): string {
  const whole = Number.isInteger(amount)
  return new Intl.NumberFormat(c.numbers, { style: 'currency', currency: c.currency, minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 }).format(amount)
}

/** An amount in the school's currency, always with cents. */
export function moneyCents(c: MoneyRules, amount: number): string {
  return moneyIn(c, amount)
}

/** An amount in the school's currency, always with cents and no grouping. */
export function moneyIn(c: MoneyRules, amount: number): string {
  return new Intl.NumberFormat(c.numbers, { style: 'currency', currency: c.currency, minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false }).format(amount)
}

/** The tier an instant falls in, by its position in the rules' order. */
function tierIndex(c: FeeContext, at: Date): number {
  const { year } = partsIn(at, c.timezone)
  const grace = c.fees.graceHours * 3_600_000
  const i = c.fees.tiers.findIndex(t => t.endsAt === null || at.getTime() < startOfDayIn(year, t.endsAt, c.timezone).getTime() + grace)
  return i === -1 ? c.fees.tiers.length - 1 : i
}

/** The name of the tier an instant falls in. */
export function feeTier(c: FeeContext, at: Date): string {
  return c.fees.tiers[tierIndex(c, at)].name
}

function base(c: FeeContext, studentCount: number): number {
  return c.fees.first + Math.max(0, studentCount - 1) * c.fees.additional
}

/** What `studentCount` children cost at an instant. */
export function calculateFee(c: FeeContext, studentCount: number, at: Date): number {
  if (studentCount === 0) return 0
  return base(c, studentCount) + c.fees.tiers[tierIndex(c, at)].adds
}

export type FeeScheduleRow = {
  tier: string
  /** Where it sits: the first tier, the last, or one between. */
  place: 'first' | 'middle' | 'last'
  period: string   // "Before {the tier's end}"
  label: string    // the tier's label
  amount: number   // what this student count costs in that tier
  current: boolean
}

function period(c: FeeContext, i: number): string {
  const tiers = c.fees.tiers
  const end = tiers[i].endsAt
  const start = i > 0 ? tiers[i - 1].endsAt : null
  if (!start && end) return `Before ${dayWords(end, c.language)}`
  if (start && !end) return `${dayWords(start, c.language)} onwards`
  if (start && end) return `${dayWords(start, c.language)} – ${dayWords(dayBefore(end), c.language)}`
  return 'All year'
}

/** The schedule to show a family: the tier in force and the tiers still ahead of it. */
export function feeSchedule(c: FeeContext, studentCount: number, at: Date): FeeScheduleRow[] {
  const current = tierIndex(c, at)
  const last = c.fees.tiers.length - 1
  return c.fees.tiers.slice(current).map((t, k) => {
    const i = current + k
    return {
      tier: t.name,
      place: i === 0 ? 'first' : i === last ? 'last' : 'middle',
      period: period(c, i),
      label: t.label,
      amount: studentCount === 0 ? 0 : base(c, studentCount) + t.adds,
      current: i === current,
    }
  })
}

/** The fee rule as one sentence to a family: the base, and each tier's discount or surcharge. */
export function feeRuleWords(c: FeeContext): string {
  const tiers = c.fees.tiers
  const parts = tiers.map((t, i) => {
    if (t.adds < 0 && t.endsAt) return `${money(c, -t.adds)} per-family discount before ${dayWords(t.endsAt, c.language)}`
    if (t.adds > 0 && i > 0 && tiers[i - 1].endsAt) return `${money(c, t.adds)} per-family surcharge from ${dayWords(tiers[i - 1].endsAt!, c.language)}`
    return null
  }).filter(Boolean)
  return `${money(c, c.fees.first)} first student, ${money(c, c.fees.additional)} each additional.` + (parts.length ? ` ${parts.join('; ')}.` : '')
}

/** The note on the tier in force, in words, for a mail: the discount still open, or the surcharge in effect or ahead. */
export function feeTierNote(c: FeeContext, at: Date): { place: FeeScheduleRow['place']; strong: string; rest: string } {
  const tiers = c.fees.tiers
  const i = tierIndex(c, at)
  const t = tiers[i]
  const place: FeeScheduleRow['place'] = i === 0 ? 'first' : i === tiers.length - 1 ? 'last' : 'middle'
  const surcharge = tiers.findIndex((x, k) => k > 0 && x.adds > 0)
  const surchargeWords = surcharge > 0 && tiers[surcharge - 1].endsAt
    ? `A ${money(c, tiers[surcharge].adds)} per-family surcharge applies from ${dayWords(tiers[surcharge - 1].endsAt!, c.language)}.`
    : ''
  if (t.adds < 0 && t.endsAt) {
    return { place, strong: `${t.label} is open now.`, rest: `Enroll before ${dayWords(t.endsAt, c.language)} to receive the ${t.label.toLowerCase()} discount of ${money(c, -t.adds)} per family.` }
  }
  if (place === 'last') return { place, strong: `${t.label} is now in effect.`, rest: surchargeWords }
  return { place, strong: `The ${t.label.toLowerCase()} enrollment period is in effect (${period(c, i)}).`, rest: surchargeWords }
}

function cardFeeCents(c: FeeContext, totalCents: number, way: CardWay): number {
  const { basisPoints, fixedCents } = c.fees.cardRates[way]
  return Math.floor((totalCents * basisPoints + 5000) / 10000) + fixedCents
}

/** The processing fee on an amount a card paid, at the rate of the way it paid. */
export function creditCardFee(c: FeeContext, paid: number, way: CardWay = 'card'): number {
  return cardFeeCents(c, Math.round(paid * 100), way) / 100
}

/** The total a credit card pays for an amount, at the rate of the way it paid. */
export function creditCardTotal(c: FeeContext, amount: number, way: CardWay = 'card'): number {
  const { basisPoints, fixedCents } = c.fees.cardRates[way]
  const a = Math.round(amount * 100)
  let g = Math.floor((a + fixedCents) * 10000 / (10000 - basisPoints)) - 2
  while (g - cardFeeCents(c, g, way) < a) g++
  return g / 100
}

const CARD_WORDS: Record<CardType, string> = {
  CREDIT: 'credit card', DEBIT: 'debit card', PREPAID: 'prepaid card', STORE: 'store card', UNKNOWN: 'card',
}

/** Whether a card of this type carries the card fee (SchoolRules.fees.cardsCarryingFee: the law the school is under
 *  decides which may be charged it). */
export function carriesCardFee(c: Pick<FeeContext, 'fees'>, cardType: CardType | null): boolean {
  return cardType !== null && c.fees.cardsCarryingFee.includes(cardType)
}

/** The cards that carry the fee, in words: "credit card". */
export function feeCardWords(c: Pick<FeeContext, 'fees'>): string {
  return c.fees.cardsCarryingFee.map(t => CARD_WORDS[t]).join(' or ')
}

/** The card rule as the family reads it, before any card is entered in the card fields: what the cards that carry the
 *  fee add, to cover the processor's charge, and which cards and the processor's own balance do not. */
export function creditCardFeeRule(c: FeeContext): string {
  const { basisPoints, fixedCents } = c.fees.cardRates.card
  const processor = c.fees.ways.find(w => w.method === c.fees.cardFeeMethod)?.name ?? c.fees.cardFeeMethod
  const free = [...c.fees.cardsNamedFree.map(t => `${CARD_WORDS[t]}s`), processor]
  return `A ${feeCardWords(c)} adds ${basisPoints / 100}% + ${money(c, fixedCents / 100)} to cover ${processor}'s charge; ` +
    `${free.join(' and ')} do not. You see the fee and the total before you pay.`
}
