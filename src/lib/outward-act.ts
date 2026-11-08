// THE ROSTER'S OUTWARD ACTS: an act that leaves the system — a calendar entry, a Classroom, an account — is recorded by
// the host around the call that makes it (ports.ts `records`). Record first, act, then complete; the host refuses an
// act a person approves while viewing as someone else (ViewAsRefused), before anything is recorded or sent.
import { ports, type OutwardActSpec } from '../ports'

export { ViewAsRefused, type Actor, type Consent, type OutwardActSpec } from '../ports'

export async function outwardAct<T>(spec: OutwardActSpec, run: () => Promise<{ value: T; vendorRef?: string | null }>): Promise<T> {
  return ports().records.outwardAct(spec, run)
}
