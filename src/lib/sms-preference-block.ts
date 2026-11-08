// THE TEXTING PREFERENCE IN AN EMAIL. Each number has one of three states — send, do not send, ask — and the email
// discloses it with a way to change it: yes, the school's text reminder is sent; no, the person has opted out;
// ask, please update your preference. It is its own small block so any email can carry it. The link needs a sign-in:
// nobody changes a preference without signing in, because the email goes to several people and may be forwarded
// around.
//
// So: every number of the people the email goes to, each with its state's line, and one link to the
// family's own place in the host (named by the school word `preference-place`), where each person changes their own,
// signed in as themselves. The email changes nothing itself.
import { and, inArray, isNull, eq } from 'drizzle-orm'
import { db } from './db'
import { persons } from '../tables'
import { rosterOn } from './modules'
import { textingStates, type TextingState } from './sms-consent'
import { dashboardUrl } from './family-ref'
import { esc } from './html-escape'
import type { Tenant } from './tenant'
import { schoolWord } from './school-words'

/** Each state's line; the reminder a yes gets is the school's words (the school word `texting-reminder`). */
export function stateLines(reminder: string): Record<TextingState, string> {
  return {
    send: `we will send ${reminder}`,
    'do-not-send': 'you have opted not to get SMS',
    ask: 'please update your preference',
  }
}

export type Block = { text: string; html: string }

/** The block's words for its lines and its link — pure. `place` names where the link goes (the school's words). */
export function blockOf(lines: { phone: string; state: TextingState }[], url: string, reminder: string, place: string): Block | null {
  if (lines.length === 0) return null
  const STATE_LINE = stateLines(reminder)
  const text = ['Text messages:', ...lines.map(l => `  ${l.phone}: ${STATE_LINE[l.state]}`),
    `To change yours, sign in to ${place}: ${url}`].join('\n')
  const html = `<p>Text messages:</p>
<ul>${lines.map(l => `<li>${esc(l.phone)}: ${esc(STATE_LINE[l.state])}</li>`).join('')}</ul>
<p>To change yours, sign in to <a href="${esc(url)}">${esc(place)}</a>.</p>`
  return { text, html }
}

/** The block for an email to these people — null for a tenant without the roster module, or when none has a number. */
export async function smsPreferenceBlock(tenant: Tenant, personIds: string[]): Promise<Block | null> {
  if (!(await rosterOn(tenant.id))) return null
  if (personIds.length === 0) return null
  const people = await db.select({ id: persons.id, phone: persons.phone }).from(persons)
    .where(and(eq(persons.tenantId, tenant.id), inArray(persons.id, personIds), isNull(persons.deletedAt)))
  const states = await textingStates(tenant.id, people)
  // One line per person, in the email's order; the number as the roster writes it.
  const lines = personIds.flatMap(id => {
    const p = people.find(x => x.id === id)
    const s = states.get(id)
    return p?.phone && s ? [{ phone: p.phone, state: s.state }] : []
  })
  if (lines.length === 0) return null
  return blockOf(lines, await dashboardUrl(tenant), await schoolWord(tenant.id, 'texting-reminder'),
    await schoolWord(tenant.id, 'preference-place'))
}
