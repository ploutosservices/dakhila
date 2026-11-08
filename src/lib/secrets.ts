// THE ROSTER'S SECRETS: a named item of the host's secret store, read through the secret reader (ports.ts `secrets`).
// Each call site names its item, so the host can check which items the roster reads.
import { ports, type SecretItem } from '../ports'

export async function getSecret(name: string): Promise<string> {
  return ports().secrets.read(name)
}

export async function getSecretOrNull(name: string): Promise<string | null> {
  return ports().secrets.readOrNull(name)
}

export async function getItemsByPrefix(prefix: string, tags?: string[]): Promise<SecretItem[]> {
  return ports().secrets.byPrefix(prefix, tags)
}
