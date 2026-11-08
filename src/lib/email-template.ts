// THE HOST'S ONE TEMPLATE, AS THE ROSTER USES IT: a body wrapped for a page the roster sends or shows whole, through the
// mail port (ports.ts `mail.page`). The roster builds no HTML document of its own.
import { ports, type PageOptions } from '../ports'

export type { FamilyRef } from '../ports'

export function platformEmail(body: string, opts?: PageOptions) {
  return ports().mail.page(body, opts)
}
