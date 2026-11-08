// A phone number in full international form, for links and for the texting provider. Pure.
// The school's phone rule (SchoolRules.locale.phone) says what a bare national number is: that many digits get its
// country code; the country code followed by a national number already carries it; anything else of seven digits or
// more is passed through as its own digits.
import type { PhoneRules } from '../ports'

export function e164(raw: string, phone: PhoneRules): string | null {
  const d = raw.replace(/\D/g, '')
  if (d.length === phone.nationalDigits) return `+${phone.countryCode}${d}`
  if (d.length === phone.countryCode.length + phone.nationalDigits && d.startsWith(phone.countryCode)) return `+${d}`
  return d.length >= 7 ? `+${d}` : null
}
