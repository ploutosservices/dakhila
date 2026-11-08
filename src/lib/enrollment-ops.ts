// Shared enrollment state transitions: every caller that moves an enrollment's state imports them from here.

import { db } from './db'
import {
  familyEnrollments,
  rosterFamilyTracker,
} from '../tables'
import { eq, and, sql } from 'drizzle-orm'
import { todayOf } from './year-context'
import { tenantRules } from './rules-context'
import { owedAndPaidOf } from './tuition-owed-store'
import { autoAssignClasses } from './auto-assign'

// If total paid >= fee, mark the enrollment as enrolled, sync the tracker,
// and trigger auto-class assignment. Safe to call multiple times — skips if
// already enrolled.
export async function maybeMarkEnrollmentPaid(
  tenantId: string,
  enrollmentId: string,
): Promise<void> {
  const [enrollment] = await db
    .select({
      status:   familyEnrollments.status,
      year:     familyEnrollments.year,
      familyId: familyEnrollments.familyId,
    })
    .from(familyEnrollments)
    .where(and(eq(familyEnrollments.tenantId, tenantId), eq(familyEnrollments.id, enrollmentId)))
    .limit(1)

  if (!enrollment) return

  // What it owes and has paid: the one rule (tuition-owed-store.ts).
  const { owed: fee, paid: totalPaid } = await owedAndPaidOf(enrollmentId)

  if (fee <= 0 || totalPaid < fee) return

  // Transition status only if not already enrolled.
  if (enrollment.status !== 'enrolled') {
    await db.update(familyEnrollments)
      .set({ status: 'enrolled' })
      .where(and(eq(familyEnrollments.tenantId, tenantId), eq(familyEnrollments.id, enrollmentId)))
  }

  if (enrollment.familyId && enrollment.year) {
    const today = await todayOf(tenantId)
    const { registered } = (await tenantRules(tenantId)).codes.enrollmentStatus
    await db.insert(rosterFamilyTracker)
      .values({
        tenantId,
        familyId: enrollment.familyId,
        year: enrollment.year,
        enrollmentStatus: registered,
        tuition: totalPaid.toFixed(2),
        registrationDate: today,
      })
      .onConflictDoUpdate({
        target: [rosterFamilyTracker.tenantId, rosterFamilyTracker.familyId, rosterFamilyTracker.year],
        set: {
          enrollmentStatus: registered,
          tuition: totalPaid.toFixed(2),
          // Set registrationDate only if not already set — preserve the original date on re-payment
          registrationDate: sql`COALESCE(roster_family_tracker.registration_date, EXCLUDED.registration_date)`,
        },
      })
  }

  // autoAssignClasses is idempotent — safe to call even when already enrolled,
  // handles the case where students were added after the initial enrollment.
  if (enrollment.year) {
    await autoAssignClasses(tenantId, enrollmentId, enrollment.year)
  }
}
