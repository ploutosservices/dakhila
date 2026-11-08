// THE ROSTER'S GOOGLE: the googleapis client, authorised through the host's Google clients (ports.ts `google`), which
// carry the host's transport and its bounds.
import type { GoogleAuthOptions, JWTOptions } from 'google-auth-library'
import { ports } from '../ports'

export { google } from 'googleapis'

export function jwtClient(opts: JWTOptions) {
  return ports().google.jwt(opts)
}

export function googleAuth(opts: GoogleAuthOptions) {
  return ports().google.auth(opts)
}
