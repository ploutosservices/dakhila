// ONE CHECKOUT FOR EVERY THING A FAMILY PAYS THROUGH PAYPAL — an enrollment, an event (one code for one
// idea). What is being paid, and the rows a payment books, stay with each route; the
// order's total, the credit-card quote and the capture are here.
import type { Actor } from './outward-act'
import { captureOrder, patchOrderAmount, readApprovedOrder } from './paypal'
import { carriesCardFee, creditCardTotal, feeCardWords, moneyCents, type FeeContext } from './fees'
import { feeContext } from './fee-context'

/** The order's total: the amount, or the total Apple's sheet showed — the amount, or with a credit card's fee at Apple
 *  Pay's rate. Any other total was not reckoned here, and nothing is made. */
export function orderTotal(c: FeeContext, amount: number, sheetTotal: unknown, what: string): { total: string } | { error: string } {
  if (sheetTotal == null) return { total: amount.toFixed(2) }
  const shown = Number(sheetTotal).toFixed(2)
  if (shown !== amount.toFixed(2) && shown !== creditCardTotal(c, amount, 'apple_pay').toFixed(2)) {
    return { error: `The sheet showed ${moneyCents(c, Number(shown))}; the ${what} is ${moneyCents(c, amount)}. Nothing was charged.` }
  }
  return { total: shown }
}

export type Settled =
  | { kind: 'quote'; amount: string; fee: string; total: string }
  | { kind: 'refused'; error: string }
  | { kind: 'captured'; amount: string; charged: string; processingFee: string | null; captureId: string; surcharge: number | null }

/** Settle an approved order. A credit card answers with its fee and total first (a quote) and is captured only on the
 *  press that carries that total; any other card, and every wallet payment (PayPal, Venmo), is captured at once at the
 *  amount the order was made for. `amount` of the answer is A, what was owed; `charged` is what arrived. */
export async function settleApprovedOrder(tenantId: string, orderId: string, acceptedTotal: unknown, actor: Actor): Promise<Settled> {
  const order = await readApprovedOrder(orderId)
  const owed = parseFloat(order.enrollmentAmount)
  let surcharge: number | null = null
  const c = await feeContext(tenantId)
  if (carriesCardFee(c, order.cardType)) {
    const total = creditCardTotal(c, owed, order.cardWay)
    if (acceptedTotal == null) {
      return { kind: 'quote', amount: owed.toFixed(2), fee: (total - owed).toFixed(2), total: total.toFixed(2) }
    }
    if (Number(acceptedTotal).toFixed(2) !== total.toFixed(2)) {
      return { kind: 'refused', error: `The total shown was ${moneyCents(c, Number(acceptedTotal))}; it is ${moneyCents(c, total)}. Nothing was charged.` }
    }
    if (order.amount !== total.toFixed(2)) await patchOrderAmount(tenantId, orderId, total.toFixed(2), actor)
    surcharge = Math.round((total - owed) * 100) / 100
  } else if (order.amount !== order.enrollmentAmount) {
    // An order made for a credit card's total (Apple Pay's sheet) that PayPal says another card paid: the fee would be
    // charged to a card that owes none. Nothing is captured (never charge after the sheet).
    return { kind: 'refused', error: `This card is not a ${feeCardWords(c)}, and the total included a ${feeCardWords(c).replace(/ /g, '-')} fee. Nothing was charged.` }
  }

  const { capturedAmount, processingFee, captureId, cardType } = await captureOrder(tenantId, orderId, actor)
  // The fee was decided on the type the approved order read; the capture states it again. A disagreement is logged and
  // nothing is charged after the fact.
  if (cardType !== order.cardType) console.warn(`[paypal] order ${orderId}: approved as ${order.cardType}, captured as ${cardType}`)
  // A is what was owed; the surcharge and PayPal's charge cancel and neither is A. The money that arrived is charged.
  const amount = surcharge != null ? (parseFloat(capturedAmount) - surcharge).toFixed(2) : capturedAmount
  return { kind: 'captured', amount, charged: capturedAmount, processingFee, captureId, surcharge }
}
