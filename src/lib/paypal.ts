// THE ROSTER'S PAYMENTS: the payment provider's verbs, through the host's payments port (ports.ts `payments`). Every act
// that moves money is recorded by the host as the actor's act.
import { ports, type Actor } from '../ports'

export type { CardWay, CardType, OrderCapture, ApprovedOrder, RefundAnswer, DisputeAnswer, PaypalTransaction } from '../ports'

const pay = () => ports().payments

export const createOrder = async (tenantId: string, amount: string, actor: Actor, owed?: string) =>
  pay().createOrder(tenantId, amount, actor, owed)
export const patchOrderAmount = async (tenantId: string, orderId: string, amount: string, actor: Actor) =>
  pay().patchOrderAmount(tenantId, orderId, amount, actor)
export const captureOrder = async (tenantId: string, orderId: string, actor: Actor) => pay().captureOrder(tenantId, orderId, actor)
export const readApprovedOrder = async (orderId: string) => pay().readApprovedOrder(orderId)
export const readOrderCapture = async (orderId: string) => pay().readOrderCapture(orderId)
export const refundCapture = async (tenantId: string, captureId: string, amount: string, requestId: string, actor: Actor) =>
  pay().refundCapture(tenantId, captureId, amount, requestId, actor)
export const readRefund = async (refundId: string) => pay().readRefund(refundId)
export const readRefundWithCapture = async (refundId: string) => pay().readRefundWithCapture(refundId)
export const readCapture = async (captureId: string) => pay().readCapture(captureId)
export const readDispute = async (disputeId: string) => pay().readDispute(disputeId)
export const readPaypalTransactions = async (sinceDate: string) => pay().readTransactions(sinceDate)
