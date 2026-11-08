// THE NO-ADDRESS GATE: this repository names no deployment. Every address in every file — a URL's host, an e-mail
// address's domain, a bare host name, an IPv4 address — fails unless it is one of:
//   - a name reserved for documentation and tests (RFC 2606, RFC 6761): the .test, .example, .invalid and .localhost
//     top-level domains, and example.com, example.org and example.net with their subdomains;
//   - a host on scripts/address-allow.json, in a file its entry admits, each entry carrying its reason.
// A school's or a host's addresses reach the server through its ports at run time and are never written here.
// Run: `npm run check-addresses`. Exit 0 when every address passes; each failure as `file:line: address`.
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ALLOW_PATH = 'scripts/address-allow.json'

export type Allow = { host: string; files: string[]; why: string }

/** The reserved names any file may carry. */
export function reserved(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '')
  if (/\.(test|example|invalid|localhost)$/.test(h) || ['test', 'example', 'invalid', 'localhost'].includes(h)) return true
  // Loopback and the unspecified address name this machine, not a deployment (RFC 1122, loopback).
  if (/^127\.\d+\.\d+\.\d+$/.test(h) || h === '0.0.0.0') return true
  return /(^|\.)example\.(com|org|net)$/.test(h)
}

// Top-level domains a bare host name is recognised by. A URL's host and an e-mail domain are caught whatever their
// top-level domain; a bare name needs one of these, so `ports.ts` or `row.length` is never read as a host. Short
// top-level domains that are also common property names (`.me`, `.in`, `.co`, `.id`) are left out: `c.query.me`
// is code. A host under one of those still fails when written as a URL or in an e-mail address.
const TLDS = 'com|org|net|edu|gov|mil|int|io|ai|app|dev|info|biz|us|uk|ca|au|de|fr|tv|cloud|site|online|tech'
const URL_HOST = /\b[a-z][a-z0-9+.-]*:\/\/(?:[^\s/@'"`]*@)?([A-Za-z0-9.-]+)/g
const EMAIL = /\b[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)\b/g
const BARE = new RegExp(`\\b((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)+(?:${TLDS}))\\b`, 'gi')
const IPV4 = /\b((?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3})\b/g

/** Every address on one line. */
export function addressesOf(line: string): string[] {
  const out = new Set<string>()
  for (const re of [URL_HOST, EMAIL, BARE, IPV4]) for (const m of line.matchAll(re)) out.add(m[1].toLowerCase().replace(/\.$/, ''))
  return [...out]
}

/** The files the gate reads: the repository's tracked files when it is a git checkout, else every file, with the
 *  build output and installed packages left out. */
export function files(root = ROOT): string[] {
  try {
    return execFileSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean)
  } catch {
    const walk = (d: string): string[] => readdirSync(d).flatMap(n => {
      if (['node_modules', 'dist', '.git'].includes(n)) return []
      const p = join(d, n)
      return statSync(p).isDirectory() ? walk(p) : [relative(root, p)]
    })
    return walk(root)
  }
}

/** A file pattern: an exact path, or a path ending in `/**` for everything under a directory. */
const admits = (pattern: string, file: string): boolean =>
  pattern === '*' || pattern === file || (pattern.endsWith('/**') && file.startsWith(pattern.slice(0, -2)))

export function allowList(root = ROOT): Allow[] {
  const list = JSON.parse(readFileSync(join(root, ALLOW_PATH), 'utf8')) as { allow: Allow[] }
  for (const a of list.allow) if (!a.host || !a.why?.trim() || !a.files?.length) throw new Error(`${ALLOW_PATH}: every entry needs host, files and why (${JSON.stringify(a)})`)
  return list.allow
}

export function check(root = ROOT): string[] {
  const allow = allowList(root)
  const used = new Set<Allow>()
  const out: string[] = []
  for (const f of files(root)) {
    if (f === ALLOW_PATH) continue // the allow list names each host it admits, by necessity
    let text: string
    try { text = readFileSync(join(root, f), 'utf8') } catch { continue }
    if (text.includes('\0')) { out.push(`${f}: a binary file — this repository holds text only`); continue }
    text.split('\n').forEach((line, i) => {
      // The lockfile is npm's: its packages' own metadata (funding, homepages) is theirs; where a package is fetched
      // from (`resolved`) is ours, and that is what it is read for.
      if (f === 'package-lock.json' && !line.includes('"resolved":')) return
      for (const host of addressesOf(line)) {
        if (reserved(host)) continue
        const hit = allow.find(a => a.host === host && a.files.some(p => admits(p, f)))
        if (hit) { used.add(hit); continue }
        out.push(`${f}:${i + 1}: ${host}`)
      }
    })
  }
  // An entry nothing uses is a standing permission for the next address: it fails too.
  for (const a of allow) if (!used.has(a)) out.push(`${ALLOW_PATH}: ${a.host} admits nothing any more — remove it`)
  return out
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const faults = check()
  for (const f of faults) console.error(f)
  console.log(faults.length ? `check-addresses: ${faults.length} fault(s)` : 'check-addresses: every address is reserved or admitted with its reason')
  process.exit(faults.length ? 1 : 0)
}
