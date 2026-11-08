import { describe, it, expect } from 'vitest'
import { buildBoard, type DesiredClass, type ActualMember } from './classroom-board'

// The tenant's directory domain, handed in — a fixture here.
const D = 'school.test'

const cls = (over: Partial<DesiredClass> = {}): DesiredClass => ({
  classId: 'c1', shortCode: 'X1', section: null, classroomCourseId: null, meet: null,
  teachers: [], students: [], ...over,
})

const teacher = (id: string, name: string, classroomEmail: string | null = null) =>
  ({ personId: id, name, email: `${id}@home.example`, classroomEmail })

// A STUDENT WITH NO ADDRESS CARRIES THE RUN'S REASON FOR IT. A bare absent
// address is not a claim that the family must be emailed: the run names the two reasons
// (none at all, or contested with a sibling), and an address absent for any other
// cause — a class with no Google classroom, so no projection row — is silent. Passing no address and
// no reason here is therefore a fixture saying "nothing is known", and the board says nothing.
const student = (
  id: string, name: string, email: string | null, parentEmails: string[] = [],
  addressProblem: 'none' | 'contested' | undefined = email ? undefined : 'none',
) => ({ personId: id, name, email, parentEmails, addressProblem })

const member = (role: 'Teacher' | 'Student', email: string, name = email): ActualMember =>
  ({ courseId: 'course-1', role, email, name })

const kinds = (b: ReturnType<typeof buildBoard>) => b.moves.map(m => m.kind)

describe('buildBoard — what is missing', () => {
  it('wants an account before it wants anything else about that teacher', () => {
    const b = buildBoard(D, [cls({
      classroomCourseId: 'course-1',
      teachers: [teacher('t1', 'Tutor A')],
    })], [], 2026, null)

    // No add-teacher move: there is no address to add yet.
    expect(kinds(b)).toEqual(['create-account', 'no-meet'])
  })

  it('wants the teacher added once they have an address', () => {
    const b = buildBoard(D, [cls({
      classroomCourseId: 'course-1', meet: 'abc-defg-hij',
      teachers: [teacher('t1', 'Tutor A', 'nora@school.test')],
    })], [], 2026, null)

    expect(kinds(b)).toEqual(['add-teacher'])
    expect(b.moves[0].email).toBe('nora@school.test')
  })

  it('wants a classroom for a class that has a teacher', () => {
    const b = buildBoard(D, [cls({ teachers: [teacher('t1', 'N', 'n@school.test')] })], [], 2026, null)
    const m = b.moves.find(x => x.kind === 'create-classroom')!
    expect(m.actionable).toBe(true)
  })

  it('shows a classroom-less class with no teacher, but does not let it be pressed', () => {
    const b = buildBoard(D, [cls()], [], 2026, null)
    const m = b.moves.find(x => x.kind === 'create-classroom')!
    expect(m.actionable).toBe(false)
  })

  it('emails a join link only to an enrolled student who is not already in', () => {
    const b = buildBoard(D, [cls({
      classroomCourseId: 'course-1', meet: 'x',
      teachers: [teacher('t1', 'N', 'n@school.test')],
      students: [student('s1', 'Otto', 'otto@example.test'), student('s2', 'Mia', 'mia@example.test')],
    })], [member('Teacher', 'n@school.test'), member('Student', 'otto@example.test')], 2026, null)

    expect(kinds(b)).toEqual(['email-join'])
    expect(b.moves[0].subject).toBe('Mia')
  })

  it('asks the family when a student has no address of their own', () => {
    const b = buildBoard(D, [cls({
      classroomCourseId: 'course-1', meet: 'x',
      teachers: [teacher('t1', 'N', 'n@school.test')],
      students: [student('s1', 'Mia', null, ['mum@home.example', 'dad@home.example'])],
    })], [member('Teacher', 'n@school.test')], 2026, null)

    const m = b.moves.find(x => x.kind === 'email-parents')!
    expect(m.actionable).toBe(true)
    expect(m.action).toBe('EMAIL the family of Mia — Mia has no address')
  })

  it('shows a student nobody can be asked about, and refuses to make it pressable', () => {
    const b = buildBoard(D, [cls({
      classroomCourseId: 'course-1', meet: 'x',
      teachers: [teacher('t1', 'N', 'n@school.test')],
      students: [student('s1', 'Mia', null, [])],
    })], [member('Teacher', 'n@school.test')], 2026, null)

    const m = b.moves.find(x => x.kind === 'email-parents')!
    expect(m.actionable).toBe(false)
    expect(m.action).toContain('nobody to ask')
  })

  it('records a classroom with no Meet link, with nothing to press', () => {
    const b = buildBoard(D, [cls({
      classroomCourseId: 'course-1',
      teachers: [teacher('t1', 'N', 'n@school.test')],
    })], [member('Teacher', 'n@school.test')], 2026, null)

    const m = b.moves.find(x => x.kind === 'no-meet')!
    expect(m.actionable).toBe(false)
  })
})

// The other direction: members Google holds that the roster does not place.
describe('buildBoard — what is extra', () => {
  it('finds a student in the classroom who is no longer enrolled', () => {
    const b = buildBoard(D, [cls({
      classroomCourseId: 'course-1', meet: 'x',
      teachers: [teacher('t1', 'N', 'n@school.test')],
      students: [student('s1', 'Otto', 'otto@example.test')],
    })], [
      member('Teacher', 'n@school.test'),
      member('Student', 'otto@example.test'),
      member('Student', 'gone@home.example', 'Someone Who Left'),
    ], 2026, null)

    const m = b.moves.find(x => x.kind === 'remove-student')!
    expect(m.subject).toBe('Someone Who Left')
    expect(m.reversible).toBe(true)
  })

  it('finds a teacher in the classroom who is no longer on the class', () => {
    const b = buildBoard(D, [cls({
      classroomCourseId: 'course-1', meet: 'x',
      teachers: [teacher('t1', 'N', 'n@school.test')],
    })], [
      member('Teacher', 'n@school.test'),
      member('Teacher', 'old@school.test', 'Former Teacher'),
    ], 2026, null)

    const m = b.moves.find(x => x.kind === 'remove-teacher')!
    expect(m.subject).toBe('Former Teacher')
  })

  it('ignores case when matching an address on either side', () => {
    const b = buildBoard(D, [cls({
      classroomCourseId: 'course-1', meet: 'x',
      teachers: [teacher('t1', 'N', 'Nora@School.test')],
      students: [student('s1', 'Otto', 'Otto@Example.test')],
    })], [
      member('Teacher', 'nora@school.test'),
      member('Student', 'otto@example.test'),
    ], 2026, null)

    expect(b.moves).toEqual([])
  })

  it('does not confuse one class\'s members with another\'s', () => {
    const b = buildBoard(D, [
      cls({ classId: 'c1', shortCode: 'X1', classroomCourseId: 'course-1', meet: 'x',
            teachers: [teacher('t1', 'N', 'n@school.test')],
            students: [student('s1', 'Otto', 'otto@example.test')] }),
      cls({ classId: 'c2', shortCode: 'X2', classroomCourseId: 'course-2', meet: 'x',
            teachers: [teacher('t2', 'M', 'm@school.test')],
            students: [student('s2', 'Mia', 'mia@example.test')] }),
    ], [
      member('Teacher', 'n@school.test'),
      member('Student', 'otto@example.test'),
      { courseId: 'course-2', role: 'Teacher', email: 'm@school.test', name: 'M' },
    ], 2026, null)

    // Only X2's student is missing; X1 is complete.
    expect(b.moves.map(m => `${m.shortCode}:${m.kind}`)).toEqual(['X2:email-join'])
  })
})

describe('buildBoard — a one-way move never looks like a reversible one', () => {
  it('marks every email move irreversible and every membership move reversible', () => {
    const b = buildBoard(D, [cls({
      classroomCourseId: 'course-1',
      teachers: [teacher('t1', 'Nora', 'nora@school.test'), teacher('t2', 'Rita')],
      students: [student('s1', 'Otto', 'otto@example.test'), student('s2', 'Mia', null, ['mum@home.example'])],
    })], [member('Student', 'gone@home.example')], 2026, null)

    const byKind = Object.fromEntries(b.moves.map(m => [m.kind, m.reversible]))
    expect(byKind['email-join']).toBe(false)
    expect(byKind['email-parents']).toBe(false)
    expect(byKind['add-teacher']).toBe(true)
    expect(byKind['create-account']).toBe(true)
    expect(byKind['remove-student']).toBe(true)
  })

  it('gives every move a stable id, so a selection survives a redraw', () => {
    const input: [DesiredClass[], ActualMember[]] = [[cls({
      classroomCourseId: 'course-1', meet: 'x',
      teachers: [teacher('t1', 'Nora', 'nora@school.test')],
      students: [student('s1', 'Otto', 'otto@example.test')],
    })], []]
    const a = buildBoard(D, ...input, 2026, null)
    const b = buildBoard(D, ...input, 2026, null)
    expect(a.moves.map(m => m.id)).toEqual(b.moves.map(m => m.id))
    expect(a.moves[0].id).toBe('add-teacher:c1:t1')
  })

  it('counts every kind, including the ones with no rows', () => {
    const b = buildBoard(D, [cls({ teachers: [teacher('t1', 'N', 'n@school.test')] })], [], 2026, null)
    expect(b.counts['create-classroom']).toBe(1)
    expect(b.counts['email-join']).toBe(0)
  })
})

describe('buildBoard — the boards (Example Board, Example Lounge)', () => {
  const board = { boardId: 'b1', name: 'Example Board', googleCourseId: 'board-1', inSnapshot: true }
  const onBoard = (role: 'Teacher' | 'Student', email: string): ActualMember =>
    ({ courseId: 'board-1', role, email, name: email })
  const classes = [
    cls({ classId: 'c1', shortCode: 'X1', classroomCourseId: 'course-1', meet: 'm',
          teachers: [teacher('t1', 'Tutor A', 'tutor.a@school.test'), teacher('t2', 'Tutor B', 'tutor.b@school.test')] }),
    cls({ classId: 'c2', shortCode: 'X2', classroomCourseId: 'course-2', meet: 'm',
          teachers: [teacher('t1', 'Tutor A', 'tutor.a@school.test'), teacher('t3', 'No Account')] }),
  ]

  it('adds every teacher of the year to a board once, as a STUDENT', () => {
    const b = buildBoard(D, classes, [
      member('Teacher', 'tutor.a@school.test'), member('Teacher', 'tutor.b@school.test'),
      onBoard('Student', 'tutor.b@school.test'),
    ], 2026, null, [board])
    const adds = b.moves.filter(m => m.kind === 'add-to-board')
    expect(adds.map(m => m.email)).toEqual(['tutor.a@school.test'])   // Tutor A once, not twice; Tutor B is on it
    expect(adds[0].action).toContain('as a student')
    expect(adds[0].boardId).toBe('b1')
    expect(adds[0].courseId).toBe('board-1')
    expect(adds[0].reversible).toBe(true)
    // A teacher with no address is asked for an account on the class, not for the board.
    expect(b.moves.some(m => m.kind === 'add-to-board' && m.personId === 't3')).toBe(false)
  })

  it('is satisfied by a teacher already promoted by hand on the board', () => {
    const b = buildBoard(D, classes, [onBoard('Teacher', 'tutor.a@school.test'), onBoard('Student', 'tutor.b@school.test')], 2026, null, [board])
    expect(b.moves.filter(m => m.kind === 'add-to-board')).toEqual([])
    expect(b.moves.filter(m => m.kind === 'remove-teacher' && m.boardId)).toEqual([])
  })

  it('never asks anything of a board the snapshot does not hold, and says so', () => {
    const lounge = { boardId: 'b2', name: 'Example Lounge', googleCourseId: 'lounge-1', inSnapshot: false }
    const b = buildBoard(D, classes, [], 2026, null, [lounge])
    expect(b.moves.filter(m => m.kind === 'add-to-board')).toEqual([])
    const row = b.moves.find(m => m.kind === 'board-not-synced')!
    expect(row.actionable).toBe(false)
    expect(row.boardId).toBe('b2')
    expect(b.counts['board-not-synced']).toBe(0)
  })
})

describe('buildBoard — the lead teacher owns every classroom', () => {
  const lead = 'owner@school.test'
  it('never proposes removing the lead teacher, in any letter case', () => {
    const c = cls({ classroomCourseId: 'course-1', meet: 'm', teachers: [teacher('t1', 'N', 'n@school.test')] })
    const b = buildBoard(D, [c], [member('Teacher', 'n@school.test'), member('Teacher', 'Owner@School.test')], 2026, null, [], lead)
    expect(b.moves.filter(m => m.kind === 'remove-teacher')).toEqual([])
  })
  it('still proposes removing any other teacher who is not on the class', () => {
    const c = cls({ classroomCourseId: 'course-1', meet: 'm', teachers: [] })
    const b = buildBoard(D, [c], [member('Teacher', lead), member('Teacher', 'gone@school.test')], 2026, null, [], lead)
    expect(b.moves.filter(m => m.kind === 'remove-teacher').map(m => m.email)).toEqual(['gone@school.test'])
  })
})

describe('buildBoard — one Google classroom serving several roster classes', () => {
  // A room shared by two or three classes is compared per ROOM: a student of the other class in the same room is no
  // removal.
  const shared = (): DesiredClass[] => [
    cls({
      classId: 'cA', shortCode: 'X5', classroomCourseId: 'course-1', meet: 'x',
      teachers: [teacher('t1', 'N', 'n@school.test')],
      students: [student('s1', 'Otto', 'otto@example.test')],
    }),
    cls({
      classId: 'cB', shortCode: 'X6', classroomCourseId: 'course-1', meet: 'x',
      teachers: [teacher('t1', 'N', 'n@school.test')],
      students: [student('s2', 'Mia', 'mia@example.test')],
    }),
  ]

  it('does not ask to remove a student the OTHER class in the same room enrolls', () => {
    const b = buildBoard(D, shared(), [
      member('Teacher', 'n@school.test'),
      member('Student', 'otto@example.test'),
      member('Student', 'mia@example.test'),
    ], 2026, null)

    expect(b.moves.filter(m => m.kind === 'remove-student')).toEqual([])
    expect(b.counts['remove-student']).toBe(0)
  })

  it('still asks to remove somebody no class of that room enrolls, once', () => {
    const b = buildBoard(D, shared(), [
      member('Teacher', 'n@school.test'),
      member('Student', 'otto@example.test'),
      member('Student', 'mia@example.test'),
      member('Student', 'stranger@home.example'),
    ], 2026, null)

    const removals = b.moves.filter(m => m.kind === 'remove-student')
    expect(removals).toHaveLength(1)
    expect(removals[0].email).toBe('stranger@home.example')
    // The row names the ROOM, not one of the classes sharing it — a reader has to be able to see
    // that removing them takes them out of both.
    expect(removals[0].classCode).toBe('X5 + X6')
  })

  it('does not ask to remove a teacher of the other class in the same room', () => {
    const classes = shared()
    classes[1].teachers = [teacher('t2', 'M', 'm@school.test')]
    const b = buildBoard(D, classes, [
      member('Teacher', 'n@school.test'),
      member('Teacher', 'm@school.test'),
      member('Student', 'otto@example.test'),
      member('Student', 'mia@example.test'),
    ], 2026, null)

    expect(b.moves.filter(m => m.kind === 'remove-teacher')).toEqual([])
  })

  it('reports a teacher no class of the room assigns, and never the lead teacher', () => {
    const b = buildBoard(D, shared(), [
      member('Teacher', 'n@school.test'),
      member('Teacher', 'lead@school.test'),
      member('Teacher', 'gone@school.test'),
      member('Student', 'otto@example.test'),
      member('Student', 'mia@example.test'),
    ], 2026, null, [], 'lead@school.test')

    const t = b.moves.filter(m => m.kind === 'remove-teacher')
    expect(t).toHaveLength(1)
    expect(t[0].email).toBe('gone@school.test')
  })
})

describe('buildBoard — a class the roster check cannot speak for', () => {
  // Whether a class has a teacher does not change the program. The program's only consequence is that the run emits no projection for
  // such a class, so the board places nobody and judges nobody in its room — a SILENCE, not a row.
  it('places nobody and judges nobody in a room it has no projection for', () => {
    const b = buildBoard(D, [cls({
      classId: 'cA', shortCode: 'X5', classroomCourseId: 'course-1', meet: 'x',
      excluded: 'no-teacher',
      students: [student('s1', 'Otto', 'otto@example.test')],
    })], [member('Student', 'somebody@home.example')], 2026, null)

    // No join email for a room nobody was projected into, and no removal of the member in it.
    expect(kinds(b)).toEqual([])
  })

  it('still reports what needs no projection — a class with no classroom', () => {
    // The roster alone says this class has no Google classroom, so the exclusion does not silence
    // it. Not pressable, because there is no teacher to own the classroom that would be created.
    const b = buildBoard(D, [cls({ classId: 'cA', shortCode: 'X8', classroomCourseId: null, excluded: 'no-teacher' })],
      [], 2026, null)
    expect(kinds(b)).toEqual(['create-classroom'])
    expect(b.moves[0].actionable).toBe(false)
  })

  it('judges nobody in a room shared with a class it cannot speak for', () => {
    // The room holds a member no class names. It is still not reported, because one of the classes
    // sharing the room has no projection and the member may well belong to it.
    const b = buildBoard(D, [
      cls({ classId: 'cA', shortCode: 'X5', classroomCourseId: 'course-1', meet: 'x', excluded: 'no-teacher' }),
      cls({
        classId: 'cB', shortCode: 'X6', classroomCourseId: 'course-1', meet: 'x',
        teachers: [teacher('t1', 'N', 'n@school.test')],
        students: [student('s2', 'Mia', 'mia@example.test')],
      }),
    ], [
      member('Teacher', 'n@school.test'),
      member('Student', 'mia@example.test'),
      member('Student', 'stranger@home.example'),
    ], 2026, null)

    expect(b.moves.filter(m => m.kind === 'remove-student')).toEqual([])
    expect(b.counts['remove-student']).toBe(0)
  })

  it('says nothing at all about a class the check dropped on a data error', () => {
    const b = buildBoard(D, [cls({
      classId: 'cA', shortCode: 'X1', classroomCourseId: 'course-1', meet: 'x', excluded: 'data-error',
      teachers: [teacher('t1', 'N', 'n@school.test')],
      students: [student('s1', 'Otto', 'otto@example.test')],
    })], [member('Student', 'stranger@home.example')], 2026, null)
    expect(kinds(b)).toEqual([])
  })
})

describe('buildBoard — a missing address needs a reason', () => {
  // The projection is keyed by COURSE: keyed by (class, person) instead, every student of a class with no classroom
  // would look address-less and the board would offer to email families about an address they already have.
  it('says nothing about a student whose address is simply not in the projection', () => {
    const b = buildBoard(D, [cls({
      classId: 'cA', shortCode: 'X1', classroomCourseId: null,
      teachers: [teacher('t1', 'N', 'n@school.test')],
      // No address and the run named no reason — what a class with no classroom looks like. Written
      // out rather than through the helper: passing `undefined` to a defaulted parameter takes the
      // default, so the helper cannot express "no reason" at all.
      students: [{ personId: 's1', name: 'Otto', email: null, parentEmails: ['mum@home.example'] }],
    })], [], 2026, null)

    expect(kinds(b)).toEqual(['create-classroom'])
    expect(b.counts['email-parents']).toBe(0)
  })

  it('still asks the family when the run says there is no address at all', () => {
    const b = buildBoard(D, [cls({
      classroomCourseId: 'course-1', meet: 'x',
      teachers: [teacher('t1', 'N', 'n@school.test')],
      students: [student('s1', 'Mia', null, ['mum@home.example'], 'none')],
    })], [member('Teacher', 'n@school.test')], 2026, null)

    const m = b.moves.find(x => x.kind === 'email-parents')!
    expect(m.actionable).toBe(true)
    expect(m.reversible).toBe(false)
  })

  it('names the sibling when one address is contested', () => {
    const b = buildBoard(D, [cls({
      classroomCourseId: 'course-1', meet: 'x',
      teachers: [teacher('t1', 'N', 'n@school.test')],
      students: [{
        personId: 's1', name: 'Ida', email: null, parentEmails: ['mum@home.example'],
        addressProblem: 'contested' as const, contestedBy: 'sibling' as const, contendingWith: ['Eva'],
      }],
    })], [member('Teacher', 'n@school.test')], 2026, null)

    const m = b.moves.find(x => x.kind === 'email-parents')!
    expect(m.action).toContain('Ida and Eva')
    expect(m.action).toContain('can represent only one of them')
  })
})
