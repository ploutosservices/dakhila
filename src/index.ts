// THE ROSTER'S PACKAGE ENTRY: what a host imports. A host fills the ports
// (ports.ts) from its own services and calls `start`; the roster reads nothing else from its process.
import { usePorts, type Ports } from './ports'
import { listen } from './server'

export type { Ports, Listen, Identity, Actor, Phone, NoticeHeaders, PaymentNotices } from './ports'

/** Start the roster's server over the host's ports. */
export function start(p: Ports): void {
  usePorts(p)
  listen()
}
