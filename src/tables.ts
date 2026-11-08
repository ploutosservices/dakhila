// THE ROSTER'S TABLES: the drizzle definitions of the roster's
// tables; the host's schema re-exports every one. The roster holds definitions, never
// migration steps: the host generates its steps from these into its own list. A column referencing a host table
// (tenants, users, registry, ledgerEntries, ledgerAccounts) reads it through hostTables() — the host's tables, registered by the host before anything
// builds DDL from these; drizzle reads a reference only then, so a process that never builds DDL registers none.
import {
  pgTable,
  text,
  varchar,
  timestamp,
  boolean,
  uuid,
  integer,
  numeric,
  primaryKey,
  unique,
  uniqueIndex,
  index,
  jsonb,
  date,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { hostTables } from './host-tables'

// Each parent's own consent to the school's text messages, for their own number. A live consent has
// optedOutAt null; rows are never deleted — they are the proof the carriers ask for.
export const smsConsents = pgTable('sms_consents', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => hostTables().tenants.id, { onDelete: 'cascade' }),
  personId: uuid('person_id').notNull().references(() => persons.id),
  phone: text('phone').notNull(),                      // E.164, as it was when they agreed
  consentText: text('consent_text').notNull(),         // the exact words they agreed to
  optedInAt: timestamp('opted_in_at', { withTimezone: true }).notNull().defaultNow(),
  optedOutAt: timestamp('opted_out_at', { withTimezone: true }),
  optedOutVia: text('opted_out_via'),                  // 'stop' for a STOP texted, else the host's word for its own switch (schoolWord 'opt-out-source')
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// A person's "no" to the invitation to text — an "optout". Not a consent: it agrees to nothing.
// Live while withdrawnAt is null; turning texts on for the same number withdraws it. Never deleted.
export const smsOptOuts = pgTable('sms_opt_outs', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => hostTables().tenants.id, { onDelete: 'cascade' }),
  personId: uuid('person_id').notNull().references(() => persons.id),
  phone: text('phone').notNull(),                      // E.164
  optedOutAt: timestamp('opted_out_at', { withTimezone: true }).notNull().defaultNow(),
  withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
})

// Every text the school number receives or sends. Kept in every environment; shown to staff only
// for a participant whose texts are on. intendedTo: the real destination of a text sent off production, where
// toNumber is the host's test recipient. Never deleted.
export const smsMessages = pgTable('sms_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => hostTables().tenants.id, { onDelete: 'cascade' }),
  direction: text('direction').notNull().$type<'in' | 'out'>(),
  messageSid: text('message_sid').notNull(),
  fromNumber: text('from_number').notNull(),
  toNumber: text('to_number').notNull(),
  intendedTo: text('intended_to'),
  body: text('body').notNull(),
  numMedia: integer('num_media').notNull().default(0),
  optOutType: text('opt_out_type').$type<'STOP' | 'START' | 'HELP'>(),
  personId: uuid('person_id').references(() => persons.id),
  kind: text('kind').$type<'new' | 'auto'>(),
  shown: boolean('shown').notNull().default(false),   // decided when written; never changes
  // The school's read mark on an incoming shown text: who handled it and when; never unset.
  readAt: timestamp('read_at', { withTimezone: true }),
  readBy: uuid('read_by').references(() => hostTables().users.id),
  sentBy: uuid('sent_by').references(() => hostTables().users.id),
  status: text('status'),
  errorCode: text('error_code'),
  receivedAt: timestamp('received_at', { withTimezone: true }),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [
  uniqueIndex('sms_messages_sid_uniq').on(t.messageSid),
  index('sms_messages_from_idx').on(t.tenantId, t.fromNumber, t.createdAt),
  index('sms_messages_person_idx').on(t.tenantId, t.personId, t.createdAt),
])

export const persons = pgTable('persons', {
  id: uuid('id').primaryKey().references(() => hostTables().registry.id),
  tenantId: uuid('tenant_id').notNull().references(() => hostTables().tenants.id, { onDelete: 'cascade' }),
  firstName: text('first_name').notNull(),
  lastName: text('last_name'),
  middleName: text('middle_name'),
  gender: text('gender'),           // 'male' | 'female' | 'unknown' | 'boy' | 'girl'
  birthYear: integer('birth_year'),
  birthDate: date('birth_date'),
  // Rank within a sibling set, smaller = elder. Sparse and optional: it serves where
  // birth_year is empty,
  // and it is needed wherever a family's words for a relative depend on who is the elder. Null means "birth order unknown", which the
  // namer answers honestly with the English term rather than a guess.
  birthOrder: integer('birth_order'),
  deathYear: integer('death_year'),
  deathDate: date('death_date'),
  // Roster fields — null for genealogy persons
  phone: text('phone'),
  email: text('email'),
  // Google Classroom address. A school-domain address held ONLY so a teacher can be
  // added to a Classroom course on the school's directory. NOT contact info, NOT a sign-in identity — email stays the one identity.
  // Read by the Classroom code only; excluded from contact surfaces and de-identified
  // payloads. Purely a classroom attribute.
  classroomEmail: text('classroom_email'),
  role: text('role'),               // 'mother' | 'father' | 'boy' | 'girl'
  firstGradeYear: integer('first_grade_year'),
  preferredLanguage: text('preferred_language'),
  guardian: integer('guardian'),              // 0=own email, 1=mother, 2=father
  // The person's id in the school's earlier database (SchoolRules.codes.legacyIdColumn heads it on the sheet). The
  // stored column keeps its first name; renaming it is a migration.
  legacyId: integer('legacy_mfs_id'),
  legacyFamilyId: integer('legacy_family_id'),
  // A foreign key. For a tenant running the roster the store refuses a live person without
  // one; a blanket .notNull() is wrong: genealogy persons share this table and have no family.
  familyId: uuid('family_id').references((): AnyPgColumn => rosterFamilies.id),
  city: text('city'),
  country: text('country'),
  notes: text('notes'),
  websiteUrl: text('website_url'),
  facebookUrl: text('facebook_url'),
  instagramUrl: text('instagram_url'),
  linkedinUrl: text('linkedin_url'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => [
  // Live rows only: a soft-deleted person is not a holder of the address,
  // and an index that says otherwise reserves it against a living one — with no
  // row visible in any UI to explain the refusal. Both indexes normalize AS THE
  // RUN COMPARES — btrim then lower; btrim is the store-side
  // approximation of the run's Unicode trim, defense-in-depth, not the
  // assertion's definition.
  uniqueIndex('persons_tenant_email_unique').on(table.tenantId, sql`btrim(lower(${table.email}))`)
    .where(sql`${table.email} IS NOT NULL AND ${table.deletedAt} IS NULL`),
  uniqueIndex('persons_tenant_classroom_email_unique').on(table.tenantId, sql`btrim(lower(${table.classroomEmail}))`)
    .where(sql`${table.classroomEmail} IS NOT NULL AND ${table.deletedAt} IS NULL`),
  // One phone number, one person — the last ten digits, any formatting: the US phone shape the roster stores.
  uniqueIndex('persons_tenant_phone_unique').on(table.tenantId, sql`right(regexp_replace(${table.phone}, '\\D', '', 'g'), 10)`)
    .where(sql`${table.phone} IS NOT NULL AND ${table.deletedAt} IS NULL AND regexp_replace(${table.phone}, '\\D', '', 'g') <> ''`),
])

export const personRelationships = pgTable('person_relationships', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => hostTables().tenants.id, { onDelete: 'cascade' }),
  personAId: uuid('person_a_id').notNull().references(() => persons.id),
  personBId: uuid('person_b_id').notNull().references(() => persons.id),
  type: text('type').notNull(),     // 'parent-child' | 'spouse'
  status: text('status').notNull().default('active'), // 'active' | 'divorced' | 'separated' | 'widowed'
  endYear: integer('end_year'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const rosterFamilies = pgTable('roster_families', {
  id: uuid('id').primaryKey().references(() => hostTables().registry.id),
  tenantId: uuid('tenant_id').notNull().references(() => hostTables().tenants.id, { onDelete: 'cascade' }),
  motherId: uuid('mother_id').references(() => persons.id),
  fatherId: uuid('father_id').references(() => persons.id),
  addr1: text('addr1'),
  addr2: text('addr2'),
  city: text('city'),
  state: text('state'),
  zip: text('zip'),
  timezone: text('timezone'),
  legacyFamilyId: integer('legacy_family_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // NO deleted_at, deliberately: a family delete is real, limited to a family with no enrollment and no other history,
  // made in one transaction, and the foreign keys pointing here are what refuse it otherwise. A read needs no
  // deleted_at filter.
})

// Fixed catalog of courses, each in a department: one of the school's languages, its culture department, or another
// of its own (SchoolRules.courses)
export const rosterCourseCatalog = pgTable('roster_course_catalog', {
  id:         uuid('id').primaryKey().references(() => hostTables().registry.id),
  tenantId:   uuid('tenant_id').notNull().references(() => hostTables().tenants.id, { onDelete: 'cascade' }),
  legacyId:    integer('legacy_id'),
  department:  text('department').notNull(),
  department2: integer('department2'),
  level:       integer('level').notNull(),
  shortCode:   text('short_code').notNull(),   // the school's code for the course
  fullName:    text('full_name').notNull(),
  createdAt:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// A course offered in a specific school year
export const rosterAvailableClasses = pgTable('roster_available_classes', {
  id:        uuid('id').primaryKey().references(() => hostTables().registry.id),
  tenantId:  uuid('tenant_id').notNull().references(() => hostTables().tenants.id, { onDelete: 'cascade' }),
  legacyId:  integer('legacy_id'),
  courseId:  uuid('course_id').references(() => rosterCourseCatalog.id),
  year:      integer('year').notNull(),        // a calendar year, four digits
  section:   text('section'),
  startTime: text('start_time'),              // 'HH:MM', start before end; the store refuses any other form
  endTime:   text('end_time'),
  // No Meet here: a Meet is the Google Classroom course's, held in the host's Classroom mirror — one store.
  classroomCourseId: text('classroom_course_id'),        // the Google course id, as the host's Classroom mirror keys it
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// Student enrolled in a class
export const rosterEnrollments = pgTable('roster_enrollments', {
  id:           uuid('id').primaryKey().defaultRandom(),
  tenantId:     uuid('tenant_id').notNull().references(() => hostTables().tenants.id, { onDelete: 'cascade' }),
  legacyId:     integer('legacy_id'),
  studentId:    uuid('student_id').notNull().references(() => persons.id),
  classId:      uuid('class_id').notNull().references(() => rosterAvailableClasses.id),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  droppedOutAt: timestamp('dropped_out_at', { withTimezone: true }),
  deletedAt:    timestamp('deleted_at', { withTimezone: true }),
})

// Teacher assigned to a class
export const rosterTeachers = pgTable('roster_teachers', {
  id:       uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => hostTables().tenants.id, { onDelete: 'cascade' }),
  legacyId: integer('legacy_id'),
  classId:  uuid('class_id').notNull().references(() => rosterAvailableClasses.id),
  personId: uuid('person_id').notNull().references(() => persons.id),
  // lead | regular | backup — a label for the principal; no permission reads it.
  typeOfTeacher: text('type_of_teacher', { enum: ['lead', 'regular', 'backup'] }).notNull().default('regular'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// Teacher vacation mark — a teacher marks a school day they are not available
// to teach; the principal sees the marks. Discrete school days only, never
// a range (it is not a continuous function): setTeacherVacation() is the
// one door and refuses any date that is not a school-day event. The mark is the
// datum — unmarking deletes the row (a toggle, not an archival record).
export const rosterTeacherUnavailability = pgTable('roster_teacher_unavailability', {
  id:        uuid('id').primaryKey().defaultRandom(),
  tenantId:  uuid('tenant_id').notNull().references(() => hostTables().tenants.id, { onDelete: 'cascade' }),
  personId:  uuid('person_id').notNull().references(() => persons.id),
  date:      date('date').notNull(),   // a school day, enforced at the lib door
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique().on(t.tenantId, t.personId, t.date)])

// Event calendar — school year events (class sessions, holidays, special events, etc.)
// eventType is a bitmask; type meanings stored in roster_event_types
export const rosterEvents = pgTable('roster_events', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenantId:    uuid('tenant_id').notNull().references(() => hostTables().tenants.id, { onDelete: 'cascade' }),
  legacyId:    integer('legacy_id'),
  eventType:   integer('event_type').notNull(),
  date:        date('date').notNull(),
  weekNumber:  integer('week_number'),
  startTime:   text('start_time'),
  endTime:     text('end_time'),
  classId:              uuid('class_id').references(() => rosterAvailableClasses.id),
  description:          text('description'),
  googleCalendarEventId: text('google_calendar_event_id'),
  createdAt:            timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// Lookup table for event type bitmask values
export const rosterEventTypes = pgTable('roster_event_types', {
  id:          integer('id').primaryKey(),              // power of 2: 1, 2, 4, 8 …
  tenantId:    uuid('tenant_id').notNull().references(() => hostTables().tenants.id, { onDelete: 'cascade' }),
  name:        text('name').notNull(),
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// Per-family enrollment status for each school year
// enrollmentStatus: one of the school's status codes (SchoolRules.codes.enrollmentStatus), never renumbered
export const rosterFamilyTracker = pgTable('roster_family_tracker', {
  id:               uuid('id').primaryKey().defaultRandom(),
  tenantId:         uuid('tenant_id').notNull().references(() => hostTables().tenants.id, { onDelete: 'cascade' }),
  legacyId:         integer('legacy_id'),
  familyId:         uuid('family_id').notNull().references(() => rosterFamilies.id),
  year:             integer('year').notNull(),
  enrollmentStatus: integer('enrollment_status'),
  previousStatus:   integer('previous_status'),
  tuition:          numeric('tuition'),
  registrationDate: date('registration_date'),
  createdAt:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
},
(t) => [unique().on(t.tenantId, t.familyId, t.year)]
)

// Evaluation criteria templates — one per course level
// sections: [{ name: string, criteria: string[] }]
export const rosterEvalTemplates = pgTable('roster_eval_templates', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenantId:    uuid('tenant_id').notNull().references(() => hostTables().tenants.id, { onDelete: 'cascade' }),
  courseLevel: integer('course_level').notNull(),
  sections:    jsonb('sections').notNull(),          // { name: string, criteria: string[] }[]
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// Lookup table for the school's teacher comment codes
export const rosterTeacherCommentCodes = pgTable('roster_teacher_comment_codes', {
  id:        integer('id').primaryKey(),
  tenantId:  uuid('tenant_id').notNull().references(() => hostTables().tenants.id, { onDelete: 'cascade' }),
  text:      text('text').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// One evaluation per student per class per year (each with its record id)
// responses: { [criterionText]: a value of SchoolRules.codes.evaluation }
export const rosterEvaluations = pgTable('roster_evaluations', {
  id:                   uuid('id').primaryKey().references(() => hostTables().registry.id),
  tenantId:             uuid('tenant_id').notNull().references(() => hostTables().tenants.id, { onDelete: 'cascade' }),
  classId:              uuid('class_id').notNull().references(() => rosterAvailableClasses.id),
  studentId:            uuid('student_id').notNull().references(() => persons.id),
  year:                 integer('year').notNull(),
  responses:            jsonb('responses').notNull().default({}), // { criterionText: an evaluation value }
  recommendedCourseId:  uuid('recommended_course_id').references(() => rosterCourseCatalog.id), // next year course
  teacherCommentCode:   integer('teacher_comment_code'),          // a roster_teacher_comment_codes id, nullable — intentionally no FK constraint
  internalNotes:        text('internal_notes'),
  submittedAt:          timestamp('submitted_at', { withTimezone: true }),
  submittedBy:          uuid('submitted_by').references(() => persons.id),
  returnedAt:           timestamp('returned_at', { withTimezone: true }),
  languageApprovedAt:   timestamp('language_approved_at', { withTimezone: true }),
  createdAt:            timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
},
(t) => [unique().on(t.classId, t.studentId, t.year)]
)

// One enrollment record per family per academic year.
// year = the calendar year when the school year begins (YYYY = the YYYY–YY session).
// status: 'pending' (started), 'enrolled' (payment received), 'cancelled', 'opted_out' (family declined the year)
export const familyEnrollments = pgTable('family_enrollments', {
  id:        uuid('id').primaryKey().references(() => hostTables().registry.id),
  tenantId:  uuid('tenant_id').notNull().references(() => hostTables().tenants.id, { onDelete: 'cascade' }),
  familyId:  uuid('family_id').notNull().references(() => rosterFamilies.id),
  year:      integer('year').notNull(),
  status:    text('status').notNull().default('pending'), // 'pending' | 'enrolled' | 'cancelled' | 'opted_out'
  fee:       numeric('fee', { precision: 10, scale: 2 }),  // neither written nor read: what an enrollment owes is tuition-owed.ts
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique().on(t.tenantId, t.familyId, t.year)])

// Students selected for this enrollment (subset of the family's students)
export const familyEnrollmentStudents = pgTable('family_enrollment_students', {
  id:           uuid('id').primaryKey().defaultRandom(),
  tenantId:     uuid('tenant_id').notNull().references(() => hostTables().tenants.id, { onDelete: 'cascade' }),
  enrollmentId: uuid('enrollment_id').notNull().references(() => familyEnrollments.id),
  studentId:    uuid('student_id').notNull().references(() => persons.id),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  droppedOutAt: timestamp('dropped_out_at', { withTimezone: true }),
}, (t) => [unique().on(t.enrollmentId, t.studentId)])

// The character of enrollment money and the characters a booking may choose: lib/payment-characters.ts.
import { PAYMENT_CHARACTER_TUITION } from './lib/payment-characters'
export { PAYMENT_CHARACTER_TUITION, PAYMENT_CHARACTERS, type PaymentCharacter } from './lib/payment-characters'

export const cashEnrollmentPayments = pgTable('cash_enrollment_payments', {
  id:             uuid('id').primaryKey().defaultRandom(),
  tenantId:       uuid('tenant_id').notNull().references(() => hostTables().tenants.id, { onDelete: 'cascade' }),
  enrollmentId:   uuid('enrollment_id').notNull().references(() => familyEnrollments.id),
  transactionId:  uuid('transaction_id').references(() => hostTables().ledgerEntries.id),
  amount:         numeric('amount', { precision: 10, scale: 2 }).notNull(),
  // What the money was FOR. FEE === incoming cash with the character of tuition.
  // Stated by the booking path, never derived: whoever books something says what it is for.
  // Open attribute on purpose (not an enum, no catalog FK): the set of characters may grow.
  character:      text('character').notNull().default(PAYMENT_CHARACTER_TUITION),
  method:         text('method').notNull(), // 'paypal' | 'zelle'
  paypalOrderId:  text('paypal_order_id'),  // PayPal order ID for audit trail; null for manual PayPal
  // The ledger's movement id for this receipt, as the ledger hands it back.
  // Same shape and same purpose as paypalOrderId: the audit trail on the other side. The ledger
  // also records the confirmation against the movement, so both ends hold the link; this column
  // is the roster's half, not a second copy of the fact.
  ledgerMovementId: integer('ledger_movement_id'),
  notes:          text('notes'),
  recordedBy:     uuid('recorded_by').references(() => hostTables().users.id, { onDelete: 'set null' }),
  bankAccountId:  uuid('bank_account_id').references(() => hostTables().ledgerAccounts.id),
  processingFee:  numeric('processing_fee', { precision: 10, scale: 2 }), // PayPal fee; overridable by principal
  // A credit card's surcharge: the gross charged minus the tuition. `amount` stays the tuition; the ledger entry
  // holds the gross. Null when the payment carried none.
  surcharge:      numeric('surcharge', { precision: 10, scale: 2 }),
  paidAt:         date('paid_at'),
  referenceId:    text('reference_id'),
  createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const rosterRoles = pgTable('roster_roles', {
  id:          uuid('id').primaryKey().references(() => hostTables().registry.id),
  tenantId:    uuid('tenant_id').notNull().references(() => hostTables().tenants.id, { onDelete: 'cascade' }),
  slug:        text('slug').notNull(),
  name:        text('name').notNull(),
  description: text('description'),
  email:       text('email'),
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
},
(t) => [unique().on(t.tenantId, t.slug)]
)

export const rosterTrustees = pgTable('roster_trustees', {
  id:        uuid('id').primaryKey().defaultRandom(),
  tenantId:  uuid('tenant_id').notNull().references(() => hostTables().tenants.id, { onDelete: 'cascade' }),
  name:      text('name').notNull(),
  email:     text('email').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const incomingPayments = pgTable('incoming_payments', {
  id:            uuid('id').primaryKey().references(() => hostTables().registry.id),
  tenantId:      uuid('tenant_id').notNull().references(() => hostTables().tenants.id, { onDelete: 'cascade' }),
  source:        text('source').notNull(),
  amount:        numeric('amount', { precision: 10, scale: 2 }).notNull(),
  processingFee: numeric('processing_fee', { precision: 10, scale: 2 }), // what the source charged; null = it did not say
  senderName:    text('sender_name'),
  senderEmail:   text('sender_email'),
  referenceId:   text('reference_id'),
  receivedAt:    date('received_at').notNull(),
  receivedAtUtc: timestamp('received_at_utc', { withTimezone: true }),
  status:        text('status').notNull().default('unmatched'),
  matchedToType: text('matched_to_type'),
  matchedToId:   uuid('matched_to_id'),
  notes:         text('notes'),
  createdAt:     timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const rosterDonations = pgTable('roster_donations', {
  id:             uuid('id').primaryKey().defaultRandom(),
  tenantId:       uuid('tenant_id').notNull().references(() => hostTables().tenants.id, { onDelete: 'cascade' }),
  donorName:      text('donor_name').notNull(),
  donorEmail:     text('donor_email').notNull(),
  amountIntended: numeric('amount_intended', { precision: 10, scale: 2 }),
  message:        text('message'),
  status:         text('status').notNull().default('pending'),
  // The PayPal order created FOR THIS donation. Both
  // ids are caller-supplied on the open capture door, and unpaired,
  // capturing order A while citing donation B would mark B received and mail B's
  // donor a tax receipt for money B never gave. create-order stamps
  // it; capture refuses any other combination.
  paypalOrderId:  text('paypal_order_id'),
  paymentId:      uuid('payment_id').references(() => incomingPayments.id),
  // PayPal's capture of this donation, stored at capture: what a refund is made against.
  captureId:      text('capture_id'),
  receiptSentAt:  timestamp('receipt_sent_at', { withTimezone: true }),
  createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// A task; one with no parent is a list. `position` is its number among its siblings.
export const volunteerTasks = pgTable('volunteer_tasks', {
  id:        uuid('id').primaryKey().references(() => hostTables().registry.id),
  tenantId:  uuid('tenant_id').notNull().references(() => hostTables().tenants.id, { onDelete: 'cascade' }),
  parentId:  uuid('parent_id').references((): AnyPgColumn => volunteerTasks.id),
  position:  integer('position').notNull(),
  title:     text('title').notNull(),
  url:       text('url'),          // optional; http or https only
  notes:     text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// One task on one day: who it is assigned to, and who did it (a stand-in is a different person there).
export const volunteerLines = pgTable('volunteer_lines', {
  id:               uuid('id').primaryKey().defaultRandom(),
  tenantId:         uuid('tenant_id').notNull().references(() => hostTables().tenants.id, { onDelete: 'cascade' }),
  taskId:           uuid('task_id').notNull().references(() => volunteerTasks.id),
  date:             date('date').notNull(),
  assignedPersonId: uuid('assigned_person_id').references(() => persons.id),
  donePersonId:     uuid('done_person_id').references(() => persons.id),
  notes:            text('notes'),
  createdAt:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const events = pgTable('events', {
  id:        uuid('id').primaryKey().references(() => hostTables().registry.id),
  tenantId:  uuid('tenant_id').notNull().references(() => hostTables().tenants.id, { onDelete: 'cascade' }),
  title:     text('title').notNull(),
  date:      date('date').notNull(),
  startTime: text('start_time'),   // 'HH:MM'
  endTime:   text('end_time'),
  place:     text('place'),        // a room, or a Meet address
  notes:     text('notes'),
  createdBy: uuid('created_by').references(() => hostTables().users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // A rehearsal: the list rehearsed and the day it is performed.
  listId:            uuid('list_id').references(() => volunteerTasks.id),
  performanceDate:   date('performance_date'),
  googleEventId:     text('google_event_id'),
  invitedAt:         timestamp('invited_at', { withTimezone: true }),
  remindedAt:        timestamp('reminded_at', { withTimezone: true }),
  assignmentsSentAt: timestamp('assignments_sent_at', { withTimezone: true }),
  // The last day a family pays for this event, inclusive, in the tenant's zone; null = the event
  // takes no money.
  payUntil:          date('pay_until'),
})

// A family's payment for an event. The order id is stamped at creation
// and capture refuses any other; `amount` is what the family chose, `surcharge` a credit card's fee, the ledger
// entry the money that arrived.
export const eventPayments = pgTable('event_payments', {
  id:            uuid('id').primaryKey().defaultRandom(),
  tenantId:      uuid('tenant_id').notNull().references(() => hostTables().tenants.id, { onDelete: 'cascade' }),
  eventId:       uuid('event_id').notNull().references(() => events.id),
  familyId:      uuid('family_id').notNull(),
  userId:        uuid('user_id').references(() => hostTables().users.id, { onDelete: 'set null' }),
  amount:        numeric('amount', { precision: 10, scale: 2 }).notNull(),
  surcharge:     numeric('surcharge', { precision: 10, scale: 2 }),
  processingFee: numeric('processing_fee', { precision: 10, scale: 2 }),
  paypalOrderId: text('paypal_order_id'),
  captureId:     text('capture_id'),
  transactionId: uuid('transaction_id').references(() => hostTables().ledgerEntries.id),
  status:        text('status').notNull().default('pending'), // 'pending' | 'paid'
  createdAt:     timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  paidAt:        timestamp('paid_at', { withTimezone: true }),
  // How the money came: 'paypal' (the card, or a PayPal payment a person matched) | 'zelle'; the source's
  // reference; and the movement the ledger booked for a Zelle one.
  method:          text('method').notNull().default('paypal'),
  referenceId:     text('reference_id'),
  ledgerMovementId: integer('ledger_movement_id'),
})

// A REFUND OF A CAPTURED PAYPAL PAYMENT, as PayPal answered it. The
// payment row is never changed: the money came in, and the refund is a second fact. `refund_id` is unique, so a
// replayed press (the same PayPal-Request-Id answers the same refund) is written once.
export const paypalRefunds = pgTable('paypal_refunds', {
  id:            uuid('id').primaryKey().defaultRandom(),
  tenantId:      uuid('tenant_id').notNull().references(() => hostTables().tenants.id, { onDelete: 'cascade' }),
  paymentKind:   text('payment_kind').notNull(), // 'enrollment' | 'event' | 'donation'
  paymentId:     uuid('payment_id').notNull(),   // the row refunded, in the table its kind names
  captureId:     text('capture_id').notNull(),
  refundId:      text('refund_id').notNull(),
  amount:        numeric('amount', { precision: 10, scale: 2 }).notNull(),
  status:        text('status').notNull(),       // PayPal's: COMPLETED | PENDING | FAILED | CANCELLED
  refundedFee:   numeric('refunded_fee', { precision: 10, scale: 2 }),
  transactionId: uuid('transaction_id').references(() => hostTables().ledgerEntries.id),
  refundedBy:    uuid('refunded_by').references(() => hostTables().users.id, { onDelete: 'set null' }),
  createdAt:     timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // 'refund', or 'reversal' — a chargeback PayPal settled against the seller.
  refundKind:    text('refund_kind').notNull().default('refund'),
}, (t) => [uniqueIndex('paypal_refunds_refund_id').on(t.refundId), index('paypal_refunds_capture').on(t.tenantId, t.captureId)])

// EVERY VERIFIED PAYPAL NOTICE, kept once after it is handled.
// `event_id` is PayPal's and unique, so a resent notice finds its row and books nothing. `outcome` is what was done.
export const paypalNotices = pgTable('paypal_notices', {
  id:         uuid('id').primaryKey().defaultRandom(),
  tenantId:   uuid('tenant_id').notNull().references(() => hostTables().tenants.id, { onDelete: 'cascade' }),
  eventId:    text('event_id').notNull(),
  eventType:  text('event_type').notNull(),
  objectId:   text('object_id'),
  outcome:    text('outcome').notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('paypal_notices_event_id').on(t.eventId), index('paypal_notices_tenant').on(t.tenantId, t.receivedAt)])

// A DISPUTE PAYPAL NAMED, as PayPal's API last answered it. No money: money moves only when PayPal
// reverses the capture, which arrives as its own notice.
export const paypalDisputes = pgTable('paypal_disputes', {
  id:            uuid('id').primaryKey().defaultRandom(),
  tenantId:      uuid('tenant_id').notNull().references(() => hostTables().tenants.id, { onDelete: 'cascade' }),
  disputeId:     text('dispute_id').notNull(),
  transactionId: text('transaction_id'),
  reason:        text('reason'),
  status:        text('status'),
  amount:        numeric('amount', { precision: 10, scale: 2 }),
  outcome:       text('outcome'),
  lastReadAt:    timestamp('last_read_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt:     timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('paypal_disputes_dispute_id').on(t.disputeId)])

// The classes picked; their children are the audience.
export const eventClasses = pgTable('event_classes', {
  id:       uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => hostTables().tenants.id, { onDelete: 'cascade' }),
  eventId:  uuid('event_id').notNull().references(() => events.id),
  classId:  uuid('class_id').notNull().references(() => rosterAvailableClasses.id),
}, (t) => [unique('event_classes_unique').on(t.eventId, t.classId)])

// The audience, each came or not.
export const eventPeople = pgTable('event_people', {
  id:       uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => hostTables().tenants.id, { onDelete: 'cascade' }),
  eventId:  uuid('event_id').notNull().references(() => events.id),
  personId: uuid('person_id').notNull().references(() => persons.id),
  came:     boolean('came').notNull().default(false),
  // A rehearsal's invitation: the key in the child's withdraw link, and when the family withdrew.
  withdrawKey: text('withdraw_key').unique('event_people_withdraw_key_unique'),
  withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
}, (t) => [unique('event_people_unique').on(t.eventId, t.personId)])
