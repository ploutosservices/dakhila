// THE ROSTER'S MAIL: one message for a tenant, sent by the host's mail sender (ports.ts `mail`) and recorded as the
// actor's act. Answers the sender's message id.
import { ports, type Actor, type MailMessage } from '../ports'

export async function sendEmail(tenantId: string, message: MailMessage, actor: Actor): Promise<string> {
  return ports().mail.send(tenantId, message, actor)
}
