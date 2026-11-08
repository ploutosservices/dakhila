// WHAT A READER MAY NARROW THE CLASSROOM POSTINGS TO — the filter the roster hands the host's Classroom port, every one
// a condition the store applies. Pure: the host reads it too.

export type NewsletterFilter = {
  courseId?: string
  kind?: string
  author?: string        // creator_user_id
  /** Which authors' postings to show (a checkbox for teacher, one for student). Absent = both. A posting
   *  whose author is neither (not in the class when read) shows only while both are shown. */
  roles?: { teachers: boolean; students: boolean }
  q?: string             // words in the title or text
  from?: string          // YYYY-MM-DD, posted on or after, in the tenant's zone
  to?: string            // YYYY-MM-DD, posted on or before
  /** Postings of any of these Google classrooms — a family's or a person's, as the three-universes run maps them. */
  courseIds?: string[]
  /** ...or written by this person. With courseIds: a person's classrooms OR their own postings. */
  authorPersonId?: string
  limit?: number
  /** Exactly these postings (a detail page naming one row the way the table does). */
  ids?: string[]
}

/** A day as the filter takes it: YYYY-MM-DD. */
export const DAY = /^\d{4}-\d{2}-\d{2}$/
