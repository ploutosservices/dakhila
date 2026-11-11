// THE ROSTER API'S CONTRACT, GENERATED FROM ITS ROUTE TABLE.
//   the contract script             write contract/openapi.json
//   the contract script --check     exit 1 when the committed file differs from the code (CI runs it)
// Each operation names the permission it asks (OpenAPI per-operation security plus x-permission), so the task list
// and who may do each are read from one file made from the code that enforces them.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ROUTES } from '../src/routes'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'contract', 'openapi.json')

const error = {
  type: 'object', required: ['error', 'code'],
  properties: { error: { type: 'string' }, code: { type: 'string' } },
}

export function contract(): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {}
  for (const r of ROUTES) {
    const params = [...r.path.matchAll(/\{(\w+)\}/g)].map(m => ({
      name: m[1], in: 'path', required: true,
      schema: m[1] === 'id' ? { type: 'string', format: 'uuid' } : { type: 'string' },
      ...(m[1] === 'slug' ? { description: "the tenant's slug (tenants.slug); every call is authorised against it" } : {}),
    }))
    // A query parameter is optional: absent, the operation answers as its summary says for none.
    for (const [name, schema] of Object.entries(r.query ?? {})) params.push({ name, in: 'query', required: false, schema } as typeof params[number])
    const json = (schema: unknown) => ({ 'application/json': { schema } })
    // A run-only operation (the seeds) admits no person: no permission and nobody else allowed.
    const runOnly = !!r.runs?.length && r.permission === null && !r.alsoAllowed
    const asRun = { hostCertificate: [], hostRun: [] }
    const who = r.publicDoor
      ? { security: [{ hostCertificate: [] }], 'x-public-door': true }
      : runOnly
        ? { security: [asRun], 'x-runs': r.runs }
        : { security: [{ rosterToken: [] }, ...(r.runs?.length ? [asRun] : [])], 'x-permission': r.permission, ...(r.alsoAllowed ? { 'x-also-allowed': r.alsoAllowed } : {}), ...(r.addressOnly ? { 'x-address-only': true } : {}), ...(r.runs?.length ? { 'x-runs': r.runs } : {}) }
    const refusedBy = r.publicDoor
      ? "a certificate that is not this deployment's host application's, or a person's token: no person calls a public door"
      : runOnly ? 'a run this operation does not name, or any person: only its runs call it'
      : (r.permission ? `the caller holds neither ${r.permission} nor what x-also-allowed says` : 'the caller is not what x-also-allowed says')
        + (r.runs?.length ? '; or a run this operation does not name' : '')
    paths[r.path] = {
      ...(paths[r.path] ?? {}),
      [r.method.toLowerCase()]: {
        operationId: r.operationId,
        summary: r.summary,
        ...who,
        parameters: params,
        ...(r.rawBody ? { requestBody: { required: true, description: "PayPal's notice, its bytes as PayPal sent them, with PayPal's PAYPAL-* transmission headers", content: json({ type: 'object' }) } } : {}),
        ...(r.request ? { requestBody: { required: true, content: json(r.request) } } : {}),
        responses: {
          200: { description: 'the answer', content: json(r.response) },
          ...(r.request ? { 400: { description: 'the body is not the request schema', content: json(error) } } : {}),
          401: { description: r.publicDoor ? 'no token and no certificate this API takes' : 'no token, or one this API does not take', content: json(error) },
          403: { description: refusedBy, content: json(error) },
          404: { description: 'no such tenant or record', content: json(error) },
          422: { description: "refused by the operation's own rule, in its words (`code` refused, or a named code)", content: json(error) },
        },
      },
    }
  }
  paths['/api/health'] = {
    get: {
      operationId: 'health', summary: "Open: the process answers, and whether the door's discovery was read.", security: [],
      responses: { 200: { description: 'up', content: { 'application/json': { schema: {
        type: 'object', required: ['status', 'door'], properties: { status: { type: 'string' }, door: { type: 'string' } },
      } } } } },
    },
  }
  return {
    openapi: '3.0.3',
    info: {
      title: 'Roster API', version: '1',
      description: 'Generated from src/routes.ts. Do not edit by hand.',
    },
    paths,
    components: {
      securitySchemes: {
        rosterToken: {
          type: 'http', scheme: 'bearer', bearerFormat: 'JWT',
          description: "A person's door access token exchanged at the door for audience roster by the host's client (Standard Token Exchange).",
        },
        hostCertificate: {
          type: 'mutualTLS',
          description: "The host application's certificate, issued for this API's own deployment, with no token: the operations marked x-public-door, and with a run header the operations whose x-runs name that run; no other.",
        },
        hostRun: {
          type: 'apiKey', in: 'header', name: 'X-Run',
          description: "The run's name (src/runs.ts), beside hostCertificate and with no token: a label for least privilege and the log, never a credential. Taken only on the operations whose x-runs name it. The header's name is the host's choice (Identity.runHeader); X-Run is an example.",
        },
      },
    },
  }
}

function main(): void {
  const text = JSON.stringify(contract(), null, 2) + '\n'
  if (process.argv.includes('--check')) {
    let held = ''
    try { held = readFileSync(OUT, 'utf8') } catch { /* absent: differs */ }
    if (held !== text) {
      console.error('contract: contract/openapi.json differs from the route table — run the contract script and commit')
      process.exit(1)
    }
    console.log('contract: the committed contract is the route table')
    return
  }
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, text)
  console.log(`contract: wrote ${OUT}`)
}

main()
