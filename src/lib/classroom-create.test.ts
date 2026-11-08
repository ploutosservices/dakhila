import { describe, it, expect, vi, beforeEach } from 'vitest'
import { usePorts } from '../ports'
import { fakePorts } from '../ports-fake'

// Google writes are production-only: off production createClassroomForClasses must touch neither the secret store nor Google,
// and say what it would have made.
const prod = vi.hoisted(() => ({ v: false }))
const serviceAccountKey = vi.fn(async () => '{}')
const coursesCreate = vi.fn()

vi.mock('./outward-act', () => ({ outwardAct: async (_s: unknown, run: () => Promise<{ value: unknown }>) => (await run()).value, ViewAsRefused: class extends Error {} }))
vi.mock('./host', () => ({ isProduction: () => prod.v }))
vi.mock('./year-context', () => ({ enrollmentYearOf: async () => 2026 }))
vi.mock('./google-school', () => ({ leadTeacherEmail: async () => 'lead@school.test', leadTeacherFor: async () => 'lead@school.test' }))
vi.mock('googleapis', () => ({
  google: {
    options: () => {},
    auth: { JWT: class {} },
    classroom: () => ({ courses: { create: (...a: unknown[]) => coursesCreate(...a), patch: vi.fn() } }),
  },
}))
vi.mock('./db', () => ({
  db: { select: () => ({ from: () => ({ where: async () => [{ id: 'c1', courseId: null }] }) }) },
}))

// The host's Google clients: an authoriser the mocked Classroom client ignores.
beforeEach(() => {
  serviceAccountKey.mockClear(); coursesCreate.mockReset()
  usePorts(fakePorts({ google: { jwt: () => ({}) as never, auth: () => ({}) as never, serviceAccountKey } }))
})

describe('createClassroomForClasses off production', () => {
  it('creates nothing at Google, opens no key, and says what production would have made', async () => {
    prod.v = false
    const { createClassroomForClasses } = await import('./classroom-create')
    const res = await createClassroomForClasses('t1', 'Lang A 3', '', ['c1'], { person: { userId: 'u1' } })
    expect(coursesCreate).not.toHaveBeenCalled()
    expect(serviceAccountKey).not.toHaveBeenCalled()
    expect(res.courseId).toBeUndefined()
    expect(res.error).toBeUndefined()
    expect(res.notMade).toMatch(/^not made in this environment — Google Classroom: a new course 'Lang A 3' owned by lead@school\.test for 1 class/)
  })

  it('on production it goes to Google', async () => {
    prod.v = true
    coursesCreate.mockResolvedValue({ data: {} })
    const { createClassroomForClasses } = await import('./classroom-create')
    const res = await createClassroomForClasses('t1', 'Lang A 3', '', ['c1'], { person: { userId: 'u1' } })
    expect(coursesCreate).toHaveBeenCalledTimes(1)
    expect(res.error).toBe('Classroom created but returned no ID')
  })
})
