// AN EVENT PAYMENT'S CONSTANTS AND SHAPES, store-free — split from
// event-payments.ts so the dashboard, which reads the rows from the roster API, does not reach its tables by
// import.

/** The smallest payment an event takes. */
export const EVENT_PAYMENT_MIN = 1

/** How many of an open event's latest payments the principal's view lists. */
export const EVENT_PAYMENTS_LATEST = 5

export type PayableEvent = { id: string; title: string; date: string; payUntil: string }

/** An event's paid payment as data; the family's display name is built by the page (family-label.ts). */
export type EventPaymentData = { id: string; familyId: string; amount: number; surcharge: number | null; processingFee: number | null; paidAt: string | null; order: string | null; method: string }
export type EventPaymentRow = EventPaymentData & { family: string }
