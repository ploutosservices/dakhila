// Where a payer sends Zelle money: the tenant's bursar role and the payee name Zelle holds for it (the
// tenant value `zelle-payee-name`), with the code a payer scans drawn from the two. Where the tenant
// declares either not — or declares a person's mailbox — the sentence saying so, shown where the address would be.
// Never a literal.
import { roleMailbox } from './role-mailbox'
import { dowryValue } from './dowry'
import { codeImage, zelleCodeUrl, type PaypalCode } from './payment-codes'

/** What the Zelle instructions show: the mailbox, payee name and code, or the sentence saying why there are none. */
export type ZelleTo = { mailbox: string; payeeName: string; code: string } | { refused: string }

export async function zelleTo(tenantId: string | null): Promise<ZelleTo> {
  if (!tenantId) return { refused: 'This request names no tenant, so it has no Zelle mailbox to show.' }
  try {
    const mailbox = await roleMailbox(tenantId, 'bursar')
    const payeeName = await dowryValue(tenantId, 'zelle-payee-name')
    return { mailbox, payeeName, code: await codeImage(zelleCodeUrl(payeeName, mailbox)) }
  } catch (e) {
    return { refused: e instanceof Error ? e.message : String(e) }
  }
}

/** The code PayPal manages for the tenant's account (the tenant value `paypal-qr-url`), drawn at render. */
export async function paypalCode(tenantId: string): Promise<PaypalCode> {
  try {
    return { code: await codeImage(await dowryValue(tenantId, 'paypal-qr-url')) }
  } catch (e) {
    return { refused: e instanceof Error ? e.message : String(e) }
  }
}
