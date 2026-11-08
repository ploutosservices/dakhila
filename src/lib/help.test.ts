import { describe, it, expect, beforeEach } from 'vitest'
import { cultureClassWords, familyHelp, teacherHelp, schoolHelp } from './help'
import { usePorts } from '../ports'
import { fakePorts, FAKE_RULES } from '../ports-fake'

beforeEach(() => { usePorts(fakePorts()) })
import { assertDeIdentified, emptyFamilyContext } from './family-context'

const ADMISSION = 'someone@example.test'
const SCHOOL = 'Example School'
const LAST_CULTURE = FAKE_RULES.courses.lastCultureGrade
const WAYS = FAKE_RULES.fees.ways.map(w => w.name)
const STATUS = 'is an invented charity.'
const BASIS = 'by an invented rule'
const RECEIPT = 'gift note'
const CONTROLS = { payButton: 'Pay now', enrollmentPlace: 'the invented status card', homePlace: 'the invented home page', editButton: 'Change', enrolledWord: 'Signed up', signInAccount: 'invented login', recordFeature: 'Your record, and a {edit} control.', recordShows: 'The invented home page lists your record.' }
const TEACHER_WORDS = { purpose: 'The {at} address is for class only.', use: 'Use {at} for class; the {school} roster takes your own address, not {domain}.', setupTitle: 'Adding the account', setup: 'Add {at} on your device; see {page}.', firstSignIn: 'The directory asks for a new password.' }
const UNAVAILABLE = { attendance: 'none kept', announcements: 'none kept', calendar: 'school-wide only' }

describe('the host\'s controls are the host\'s words', () => {
  it('names the controls and places it hands in', () => {
    const sections = familyHelp({ admissionEmail: ADMISSION, schoolName: SCHOOL, courses: FAKE_RULES.courses, paymentWays: WAYS, donationStatus: STATUS, placementBasis: BASIS, receiptName: RECEIPT, controls: CONTROLS })
    const enrollment = sections.find(s => s.id === 'enrollment')!
    expect(enrollment.feature).toContain('the status is a Pay now button')
    expect(enrollment.body).toContain('the invented status card shows a "Pay now" button')
    expect(enrollment.body).toContain('appear on the invented home page.')
    expect(sections.find(s => s.id === 'family-record')!.body).toContain('use the Change button')
    expect(sections.find(s => s.id === 'family-record')!.body).toContain('The invented home page lists your record. ')
    expect(sections.find(s => s.id === 'family-record')!.feature).toBe('Your record, and a Change control.')
  })
})

describe('the payment ways and the school\'s standing are the school\'s words', () => {
  it('names its ways, and says of itself what it hands in', () => {
    const donate = familyHelp({ admissionEmail: ADMISSION, schoolName: SCHOOL, courses: FAKE_RULES.courses, paymentWays: WAYS, donationStatus: STATUS, placementBasis: BASIS, receiptName: RECEIPT, controls: CONTROLS }).find(s => s.id === 'donate')!
    expect(donate.feature).toBe('Card Co or Bank Transfer or Cash, with an automatic gift note.')
    expect(donate.body).toContain(`${SCHOOL} is an invented charity.`)
  })
})

describe('cultureClassWords', () => {
  it("says the school's own range, and where a higher grade goes", () => {
    expect(cultureClassWords(FAKE_RULES.courses)).toBe(`X1–X${LAST_CULTURE} by grade; grade ${LAST_CULTURE} and above in X${LAST_CULTURE}`)
    const last = FAKE_RULES.courses.grades.last
    expect(cultureClassWords({ ...FAKE_RULES.courses, lastCultureGrade: last })).toBe(`X1–X${last} by grade`)
  })
})

describe('familyHelp', () => {
  it('carries the admission address the caller supplies, and writes none of its own', () => {
    const sections = familyHelp({ admissionEmail: ADMISSION, schoolName: SCHOOL, courses: FAKE_RULES.courses, paymentWays: WAYS, donationStatus: STATUS, placementBasis: BASIS, receiptName: RECEIPT, controls: CONTROLS })
    const withAddress = sections.filter(s => s.body.includes('@'))
    expect(withAddress.length).toBeGreaterThan(0)
    // Every address in the text is the one passed in: this reads the output, where a source scan cannot.
    for (const s of withAddress) {
      for (const found of s.body.match(/\S+@\S+/g) ?? []) {
        expect(found.replace(/[.,]$/, '')).toBe(ADMISSION)
      }
    }
  })

  it('gives every section a stable id and non-empty text', () => {
    const sections = familyHelp({ admissionEmail: ADMISSION, schoolName: SCHOOL, courses: FAKE_RULES.courses, paymentWays: WAYS, donationStatus: STATUS, placementBasis: BASIS, receiptName: RECEIPT, controls: CONTROLS })
    expect(sections.length).toBeGreaterThan(0)
    expect(new Set(sections.map(s => s.id)).size).toBe(sections.length)
    for (const s of sections) {
      expect(s.id).toMatch(/^[a-z-]+$/)
      expect(s.title.trim()).not.toBe('')
      expect(s.body.trim()).not.toBe('')
    }
  })

  it('tells a parent which account to sign in with, so no second family is made', () => {
    // A parent signing in with a second account makes a second, empty family unless
    // something tells them which account to use.
    const notLinked = familyHelp({ admissionEmail: ADMISSION, schoolName: SCHOOL, courses: FAKE_RULES.courses, paymentWays: WAYS, donationStatus: STATUS, placementBasis: BASIS, receiptName: RECEIPT, controls: CONTROLS }).find(s => s.id === 'not-linked')
    expect(notLinked?.body).toContain('same invented login')
    expect(notLinked?.body).toContain('second, empty family record')
  })

  it('survives the de-identification gate inside a real payload', () => {
    const ctx = emptyFamilyContext(2026, new Date('2026-09-10T00:00:00Z'), UNAVAILABLE, familyHelp({ admissionEmail: ADMISSION, schoolName: SCHOOL, courses: FAKE_RULES.courses, paymentWays: WAYS, donationStatus: STATUS, placementBasis: BASIS, receiptName: RECEIPT, controls: CONTROLS }))
    expect(() => assertDeIdentified(ctx)).not.toThrow()
    expect(ctx.help.length).toBeGreaterThan(0)
  })

  it('still serves help to a signed-in person with no family — that is who needs it', () => {
    const ctx = emptyFamilyContext(2026, new Date(), UNAVAILABLE, familyHelp({ admissionEmail: ADMISSION, schoolName: SCHOOL, courses: FAKE_RULES.courses, paymentWays: WAYS, donationStatus: STATUS, placementBasis: BASIS, receiptName: RECEIPT, controls: CONTROLS }))
    expect(ctx.familyId).toBeNull()
    expect(ctx.help.map(s => s.id)).toContain('not-linked')
  })
})

describe('schoolHelp — scoped to the person the token names', () => {
  it('gives a non-teacher family help only', () => {
    const ids = schoolHelp({ admissionEmail: ADMISSION, domain: 'school.test', schoolName: SCHOOL, courses: FAKE_RULES.courses, paymentWays: WAYS, donationStatus: STATUS, placementBasis: BASIS, receiptName: RECEIPT, controls: CONTROLS, teacherWords: TEACHER_WORDS, teaches: false }).map(s => s.id)
    expect(ids).toContain('enrollment')
    expect(ids.some(id => id.startsWith('teacher-'))).toBe(false)
  })

  it('gives a teacher BOTH — one person may be a teacher and a parent on one address', () => {
    const sections = schoolHelp({ admissionEmail: ADMISSION, domain: 'school.test', schoolName: SCHOOL, courses: FAKE_RULES.courses, paymentWays: WAYS, donationStatus: STATUS, placementBasis: BASIS, receiptName: RECEIPT, controls: CONTROLS, teacherWords: TEACHER_WORDS, teaches: true })
    expect(sections.some(s => s.audience === 'family')).toBe(true)
    expect(sections.some(s => s.audience === 'teacher')).toBe(true)
    expect(sections.map(s => s.id)).toContain('teacher-classroom-login')
  })

  it('every section says which hat it answers', () => {
    for (const s of schoolHelp({ admissionEmail: ADMISSION, domain: 'school.test', schoolName: SCHOOL, courses: FAKE_RULES.courses, paymentWays: WAYS, donationStatus: STATUS, placementBasis: BASIS, receiptName: RECEIPT, controls: CONTROLS, teacherWords: TEACHER_WORDS, teaches: true })) {
      expect(['family', 'teacher']).toContain(s.audience)
    }
  })

  it('answers how a teacher signs in to their classroom', () => {
    const s = teacherHelp({ admissionEmail: ADMISSION, domain: 'school.test', schoolName: SCHOOL, teacherWords: TEACHER_WORDS }).find(x => x.id === 'teacher-classroom-login')
    expect(s?.body).toContain('classroom.google.com')
    expect(s?.body).toContain('@school.test')
    expect(s?.body).toContain('welcome email')
  })

  it('never carries a teacher\'s temporary password or their school address', () => {
    // The address is per-person and is kept off every contact surface and every
    // de-identified payload; the password is in their own mail and this text goes to a model.
    const text = schoolHelp({ admissionEmail: ADMISSION, domain: 'school.test', schoolName: SCHOOL, courses: FAKE_RULES.courses, paymentWays: WAYS, donationStatus: STATUS, placementBasis: BASIS, receiptName: RECEIPT, controls: CONTROLS, teacherWords: TEACHER_WORDS, teaches: true }).map(s => s.body).join(' ')
    // It points at where the password is rather than carrying one.
    expect(text).toContain('temporary password is in your welcome email')
    // No local part in front of the school domain — "@<domain>" is spoken about as a
    // kind of address, never as one person's address.
    expect(text.match(/[A-Za-z0-9._%+-]+@school\.test/g)).toBeNull()
  })

  it('a teacher payload still passes the de-identification gate', () => {
    const ctx = emptyFamilyContext(2026, new Date(), UNAVAILABLE, schoolHelp({ admissionEmail: ADMISSION, domain: 'school.test', schoolName: SCHOOL, courses: FAKE_RULES.courses, paymentWays: WAYS, donationStatus: STATUS, placementBasis: BASIS, receiptName: RECEIPT, controls: CONTROLS, teacherWords: TEACHER_WORDS, teaches: true }))
    expect(() => assertDeIdentified(ctx)).not.toThrow()
  })
})
