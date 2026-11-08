// A phone number as a person reads it, by the school's phone rule (SchoolRules.locale.phone): a national number in its
// national format, one carrying the country code with "+code " before it, anything else as it was given.
import type { PhoneRules } from '../ports'

function shaped(digits: string, format: string): string {
  let i = 0
  return format.replace(/#/g, () => digits[i++] ?? '')
}

export function formatPhone(raw: string | null | undefined, phone: PhoneRules): string {
  if (!raw) return '—'
  const digits = raw.replace(/\D/g, '')
  if (digits.length === phone.nationalDigits) return shaped(digits, phone.nationalFormat)
  if (digits.length === phone.countryCode.length + phone.nationalDigits && digits.startsWith(phone.countryCode)) {
    return `+${phone.countryCode} ${shaped(digits.slice(phone.countryCode.length), phone.nationalFormat)}`
  }
  return raw
}
