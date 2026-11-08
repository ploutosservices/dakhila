// THE ROSTER'S PHONE: the school's number and a text sent from it, through the host's phone port (ports.ts `phone`).
// The host records each text as the actor's act and, off production, sends it to its own test recipient.
import { ports, type Actor, type DecidedText } from '../ports'

export type { DecidedText } from '../ports'

export async function schoolNumber(): Promise<string> {
  return ports().phone.schoolNumber()
}

export async function deliverText(tenantId: string, text: DecidedText, body: string, actor: Actor): Promise<{ sid: string; sentTo: string }> {
  return ports().phone.sendText(tenantId, text, body, actor)
}
