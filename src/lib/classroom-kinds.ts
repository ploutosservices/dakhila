// The KINDS of difference between the roster and Google Classroom, and how they
// read on screen.
//
// This file imports NOTHING, so any reader, in any bundle, may import it without reaching the store
// (classroom-board.ts does).

export type MoveKind =
  | 'create-account'      // a teacher on the class has no school address
  | 'create-classroom'    // the class has no Google Classroom
  | 'add-teacher'         // assigned on the roster, not a teacher of the course
  | 'remove-teacher'      // a teacher of the course, not assigned on the roster
  | 'remove-student'      // in the course, not enrolled (dropped, moved class)
  | 'email-teacher'       // account exists, the teacher has not been told
  | 'email-join'          // enrolled with an address, not in the course
  | 'email-parents'       // enrolled with NO address of their own
  | 'no-meet'             // the course carries no Meet link (nothing to press)
  | 'add-to-board'        // a teacher's school address is not on a board (the school board, or any other board)
  | 'board-not-synced'    // a board's Google course is not in the snapshot (nothing to press)

// NO KIND FOR "this class has no teacher". Whether a class has a teacher
// does not change the program. The only programming consequence
// is that the run emits no projection for such a class, so the board has nothing to compare its
// room against and makes no claim about it — which is a silence in classroom-board.ts,
// not a row. A row would have been a roster to-do on a board of Google moves.

export const KIND_LABEL: Record<MoveKind, string> = {
  'create-classroom': 'Needs a classroom',
  'create-account':   'Needs an account',
  'email-parents':    'Student has no email',
  'email-join':       'Student has not joined',
  'add-teacher':      'Teacher not in classroom',
  'remove-teacher':   'Extra teacher in classroom',
  'remove-student':   'Extra student in classroom',
  'email-teacher':    'Teacher not told yet',
  'no-meet':          'No Meet link',
  'add-to-board':     'Teacher not on a board',
  'board-not-synced': 'Board not in the snapshot',
}

/**
 * What the BUTTON on the row says. A generic label makes the reader look
 * somewhere else to find out what pressing it does, which is the one thing a
 * button must say by itself.
 *
 * So the button names the act, in the words a principal would use. Every label
 * is a verb phrase, and the ones that send mail say "Email" so a one-way move
 * reads as one before it is pressed.
 */
export const KIND_BUTTON: Record<MoveKind, string> = {
  'create-classroom': 'Create classroom',
  'create-account':   'Create account',
  // Both send the one family email, so both say "Email family".
  'email-parents':    'Email family',
  'email-join':       'Email family',
  'add-teacher':      'Add teacher',
  'remove-teacher':   'Remove teacher',
  'remove-student':   'Remove student',
  'email-teacher':    'Email teacher',
  'no-meet':          'Add Meet link',
  'add-to-board':     'Add to board',
  'board-not-synced': 'Refresh from Google',
}

/**
 * Which moves put somebody IN a classroom and which take somebody OUT: remove and add
 * are told apart by their tone (KIND_TONE): an add and a removal are marked as such; every other kind keeps its
 * worded button, because creating, emailing and asking are not the same act as either.
 */
export const KIND_TONE: Partial<Record<MoveKind, 'add' | 'remove'>> = {
  'add-teacher':    'add',
  'add-to-board':   'add',
  'remove-teacher': 'remove',
  'remove-student': 'remove',
}

/**
 * Tab order: what the school acts on first, not alphabetical. A principal
 * opening the board should land on work, and a class with no classroom blocks
 * everything downstream of it.
 */
export const KIND_ORDER: MoveKind[] = [
  'create-classroom', 'create-account', 'email-parents', 'email-join',
  'add-teacher', 'remove-teacher', 'remove-student', 'add-to-board', 'email-teacher', 'no-meet',
  'board-not-synced',
]
