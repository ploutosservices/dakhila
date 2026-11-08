// THE WORDS A PARENT SEES ABOUT TEXT MESSAGES, with no store (sms-consent.ts re-exports them). They are what the
// carriers are told a parent sees, and what the consent row records verbatim — change them here and the next consent records the
// new words.

// The words the school's texting campaign declares: the carriers' consent form, with what the school texts about (its
// own words, the school word `texting-topics`).
export function consentText(school: string, topics: string): string {
  return `I agree to receive text messages from ${school} about ${topics} ` +
    'at this number. Message frequency varies. Message and data rates may apply. Reply STOP to opt out, ' +
    'HELP for help.'
}

/** What a parent sees once they have said yes — the same words as the confirmation text the campaign declares. */
export function confirmationText(school: string): string {
  return `You are signed up for ${school} text messages at this number. Message frequency varies. ` +
    'Message and data rates may apply. Reply HELP for help, STOP to opt out.'
}

export type TextingState = 'send' | 'do-not-send' | 'ask'
