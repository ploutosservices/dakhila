// THE PAYMENT CODES A PAYER SCANS — drawn at render from what the tenant declares, never a picture of
// one tenant's account served to every tenant.
//
// What each code carries:
//   Zelle   https://enroll.zellepay.com/qr-codes?data=<base64 of {"name":"<payee name>","token":"<payee address>"}>
//   PayPal  https://www.paypal.com/qrcodes/managed/<id>?utm_source=payandgetpaid
// The Zelle name is the payee name Zelle holds (the tenant value `zelle-payee-name`), the token the bursar role's
// mailbox; the PayPal address is a code PayPal manages for the school's account (the tenant value `paypal-qr-url`).
import QRCode from 'qrcode'

/** The address a Zelle code carries: Zelle's own enrolment page, its payload the payee's name and token. */
export function zelleCodeUrl(payeeName: string, token: string): string {
  const data = Buffer.from(JSON.stringify({ name: payeeName, token })).toString('base64')
  return `https://enroll.zellepay.com/qr-codes?data=${data}`
}

/** The PayPal code a page shows, or the sentence saying why there is none. */
export type PaypalCode = { code: string } | { refused: string }

/** The code for a text, as an image a page can show (a data: URL). */
export function codeImage(text: string): Promise<string> {
  return QRCode.toDataURL(text, { margin: 1, width: 192 })
}
