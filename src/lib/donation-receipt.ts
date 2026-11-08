// A DONATION'S TAX RECEIPT, one letter for every way a donation arrives (the provider's capture, a bank deposit): the
// school's own words (legal name, its legal status, the name and number of its tax id — school-words) and the amount in
// its currency. The roster writes no school's standing itself.
import { schoolWord } from './school-words'
import { feeContext } from './fee-context'
import { moneyCents } from './fees'

export type ReceiptLine = { label: string; value: string }

/** The receipt's HTML body, its plain body and its subject, for a donation of `amount`; `lines` are the letter's
 *  facts after the greeting (the day first), the amount set between the first and the rest. */
export async function donationReceipt(tenantId: string, p: {
  donorName: string; amount: number; via?: string; lines: ReceiptLine[]
}): Promise<{ html: string; text: string; subject: string; legalName: string }> {
  const [name, legalName, legalStatus, taxIdName, taxId, heading, statement, c] = await Promise.all([
    schoolWord(tenantId, 'name'), schoolWord(tenantId, 'legal-name'), schoolWord(tenantId, 'legal-status'),
    schoolWord(tenantId, 'tax-id-name'), schoolWord(tenantId, 'tax-id'), schoolWord(tenantId, 'receipt-heading'),
    schoolWord(tenantId, 'receipt-statement'), feeContext(tenantId),
  ])
  const amount = moneyCents(c, p.amount)
  const via = p.via ? ` via ${p.via}` : ''
  // The day first, then the amount, then the rest.
  const ordered = [p.lines[0], { label: 'Amount', value: amount }, ...p.lines.slice(1)].filter(Boolean)
  const html =
    `<p>Dear ${p.donorName},</p>
     <p>Thank you for your generous donation of <strong>${amount}</strong> to ${legalName}${via}.</p>
     <p>${heading} ${legalName} is a ${legalStatus} (${taxIdName}: ${taxId}). ${statement}</p>
     <p>${ordered.map(l => `${l.label}: ${l.value}`).join('<br/>')}</p>
     <p>Thank you for supporting ${name}.</p>`
  return {
    html,
    text: `Dear ${p.donorName},\n\nThank you for your donation of ${amount}. ${taxIdName}: ${taxId}.\n\n${legalName}`,
    subject: `Thank you for your donation to ${legalName}`,
    legalName,
  }
}
