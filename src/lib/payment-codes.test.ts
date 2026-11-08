import { describe, it, expect, vi } from 'vitest'
import QRCode from 'qrcode'

// THE CODES A PAYER SCANS CARRY THE TENANT'S DECLARED VALUES. The Zelle code's payload decodes to the
// payee name and the bursar's mailbox the tenant declares, and the PayPal code is
// the address the tenant declares, unchanged.
vi.mock('./role-mailbox', () => ({ roleMailbox: async () => 'bursar@school.test' }))
vi.mock('./dowry', () => ({
  dowryValue: async (_t: string, key: string) =>
    key === 'zelle-payee-name' ? 'A SCHOOL INC' : 'https://www.paypal.com/qrcodes/managed/test-id',
}))

import { zelleCodeUrl, codeImage } from './payment-codes'
import { zelleTo, paypalCode } from './zelle-to'

const payloadOf = (url: string) => JSON.parse(Buffer.from(new URL(url).searchParams.get('data')!, 'base64').toString())
/** The text a code's symbol holds, read back from the symbol's own segments. */
const textOf = (text: string) => QRCode.create(text).segments.map(s => Buffer.from(s.data as unknown as Uint8Array).toString()).join('')

describe('the Zelle code', () => {
  it('carries {name, token} at Zelle\'s enrolment page', () => {
    const url = zelleCodeUrl('A SCHOOL INC', 'bursar@school.test')
    expect(new URL(url).host).toBe('enroll.zellepay.com')
    expect(payloadOf(url)).toEqual({ name: 'A SCHOOL INC', token: 'bursar@school.test' })
  })
  it('is drawn from the declared pair', async () => {
    const to = await zelleTo('t1')
    expect(to).toMatchObject({ mailbox: 'bursar@school.test', payeeName: 'A SCHOOL INC' })
    // The image is the symbol of exactly that URL, and the symbol's own text decodes to the declared pair.
    expect('code' in to && to.code).toBe(await codeImage(zelleCodeUrl('A SCHOOL INC', 'bursar@school.test')))
    expect(payloadOf(textOf(zelleCodeUrl('A SCHOOL INC', 'bursar@school.test')))).toEqual({ name: 'A SCHOOL INC', token: 'bursar@school.test' })
  })
  it('names no tenant, shows no code', async () => {
    expect(await zelleTo(null)).toEqual({ refused: expect.stringMatching(/names no tenant/) })
  })
})

describe('the PayPal code', () => {
  it('is the declared address, drawn', async () => {
    const r = await paypalCode('t1')
    expect('code' in r && r.code).toBe(await codeImage('https://www.paypal.com/qrcodes/managed/test-id'))
    expect(textOf('https://www.paypal.com/qrcodes/managed/test-id')).toBe('https://www.paypal.com/qrcodes/managed/test-id')
  })
})
