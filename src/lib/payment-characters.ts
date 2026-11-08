// THE CHARACTER OF A PAYMENT — a business list, owned here and not in the store's vocabulary (a screen offers
// these without holding the schema). The column `cash_enrollment_payments.character` is text; the schema re-exports
// these for the layer's own writers.

// The character of enrollment money. Every cash_enrollment_payments row hangs off an enrollment,
// and money paid for an enrollment is tuition.
export const PAYMENT_CHARACTER_TUITION = 'tuition'

// THE CHARACTERS A BOOKING MAY CHOOSE — a list, not free text: what a booking offers is a closed
// choice. The COLUMN is text, so adding a character is one line here and no migration.
export const PAYMENT_CHARACTERS = [PAYMENT_CHARACTER_TUITION, 'donation'] as const
export type PaymentCharacter = (typeof PAYMENT_CHARACTERS)[number]
