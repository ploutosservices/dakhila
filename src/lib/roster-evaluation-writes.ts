// THE EVALUATIONS BOARD'S TWO WRITES, apart from its reads (roster-evaluations-board.ts); the roster API's
// evaluation.approveLanguage and evaluation.return call them.
import { db } from './db'
import { now } from './host'
import { rosterEvaluations } from '../tables'
import { and, eq } from 'drizzle-orm'

/** Record that an evaluation's language recommendation was approved now. */
export async function approveEvaluationLanguage(evalId: string): Promise<void> {
  await db.update(rosterEvaluations)
    .set({ languageApprovedAt: now() })
    .where(eq(rosterEvaluations.id, evalId))
}

/** Send an evaluation back to its teacher: unsubmitted, stamped returned now. */
export async function returnEvaluation(tenantId: string, evalId: string): Promise<void> {
  await db.update(rosterEvaluations)
    .set({ submittedAt: null, returnedAt: now() })
    .where(and(eq(rosterEvaluations.id, evalId), eq(rosterEvaluations.tenantId, tenantId)))
}
