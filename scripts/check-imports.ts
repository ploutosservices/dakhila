// THE IMPORT GATE: this repository builds and tests from its own files and its declared packages alone.
// Every specifier in every source, test and script file — an import or export, a dynamic import, a test's mock, a
// require — is one of:
//   - a relative path that resolves inside the repository;
//   - a Node built-in (`node:` or a bare built-in name);
//   - a package this repository's package.json declares (dependencies or devDependencies).
// Anything else fails: a path outside the repository, an alias (`@/…`), or an undeclared package.
// Run: `npm run check-imports`. Exit 0 when every specifier passes; each failure as `file: specifier — reason`.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SKIP = new Set(['node_modules', 'dist', 'contract'])
const SPEC = /(?:(?:import|export)\s[^'"]*?from\s+|import\(\s*|vi\.mock\(\s*|require\(\s*)['"]([^'"]+)['"]/g

/** Every code file under the repository, its build output and installed packages excepted. */
export function codeFiles(root = ROOT): string[] {
  const walk = (d: string): string[] => readdirSync(d).flatMap(n => {
    if (SKIP.has(n) || n.startsWith('.')) return []
    const p = join(d, n)
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx|mts|cts|mjs|cjs|js)$/.test(n) ? [p] : []
  })
  return walk(root)
}

/** The packages the repository declares. */
export function declared(root = ROOT): Set<string> {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as Record<string, Record<string, string> | undefined>
  return new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})])
}

const packageName = (s: string): string => (s.startsWith('@') ? s.split('/').slice(0, 2) : s.split('/').slice(0, 1)).join('/')
const BUILTIN = new Set(builtinModules)

/** One specifier's fault, or null when it passes. */
export function fault(file: string, spec: string, root: string, packages: Set<string>): string | null {
  if (spec.startsWith('.') || spec.startsWith('/')) {
    const target = resolve(dirname(file), spec)
    if (!(target + '/').startsWith(root + '/')) return 'a path outside the repository'
    const found = [target, `${target}.ts`, `${target}.tsx`, join(target, 'index.ts')].some(p => existsSync(p))
    return found ? null : 'a path that resolves to no file'
  }
  if (spec.startsWith('@/') || spec.startsWith('~/')) return 'an alias, which names a tree this repository does not define'
  if (spec.startsWith('node:') || BUILTIN.has(spec) || BUILTIN.has(packageName(spec))) return null
  return packages.has(packageName(spec)) ? null : `a package package.json does not declare (${packageName(spec)})`
}

export function check(root = ROOT): string[] {
  const packages = declared(root)
  const out: string[] = []
  for (const f of codeFiles(root)) {
    for (const m of readFileSync(f, 'utf8').matchAll(SPEC)) {
      const why = fault(f, m[1], root, packages)
      if (why) out.push(`${relative(root, f)}: ${m[1]} — ${why}`)
    }
  }
  return out
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const faults = check()
  for (const f of faults) console.error(f)
  console.log(faults.length ? `check-imports: ${faults.length} specifier(s) fail` : 'check-imports: every specifier resolves inside the repository or to a declared package')
  process.exit(faults.length ? 1 : 0)
}
