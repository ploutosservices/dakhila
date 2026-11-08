// THE HOST'S VALUES, AS THE ROSTER'S CODE NAMES THEM (ports.ts `host`): whether this deployment is production — the
// one environment code may know, and only where an act is irreversible — and the environment's name, for a message only.
import { ports, type HostPage, type HostRoute } from '../ports'

export function isProduction(): boolean {
  return ports().host.production()
}

/** A page of the host, as a path, by what it is; `id` names the record it shows. */
export function hostPage(name: HostPage, id?: string): string {
  return ports().host.page(name, id)
}

/** A route of the host's own for the roster (a status callback, a PDF), as a path, by what it is. */
export function hostRoute(name: HostRoute, id?: string): string {
  return ports().host.route(name, id)
}

/** The instant now, as the host's clock tells it: every stamp the roster writes reads it, never the server's clock. */
export function now(): Date {
  return ports().clock.now()
}

/** The name of this deployment's environment, opaque: printed in a message, never compared. */
export function environmentName(): string {
  return ports().host.environment()
}
