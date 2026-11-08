// A REFUND PRESS'S OWN CHECK, store-free (paypal-refunds.ts re-exports it): a caller checks a press with it before the
// roster API refunds it, reaching none of paypal-refunds.ts's store writes.

export type RefundKind = 'enrollment' | 'event' | 'donation'

export const REFUND_KINDS: readonly RefundKind[] = ['enrollment', 'event', 'donation']

/** Refuses a press that names no payment kind the roster refunds, or carries no request id; null when it may go on. */
export function refundPressRefusal(kind: unknown, requestId: unknown): string | null {
  if (!REFUND_KINDS.includes(kind as RefundKind)) return 'Not a payment this site refunds.'
  if (typeof requestId !== 'string' || !/^[A-Za-z0-9-]{8,100}$/.test(requestId)) return 'The press carried no request id.'
  return null
}
