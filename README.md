# dakhila

A school roster API: families and their members, classes and teachers, enrollment and payments, evaluations,
volunteering, the school calendar and messages to families.

dakhila is the roster's domain and its HTTP server. It holds no school and no deployment: a **host** starts it and
fills its **ports** (`src/ports.ts`) — the database pool, the clock, the mail sender, the secret reader, the identity
reader, the host's records the roster reads and writes, the outside services it calls, and the school's own rules
and words (`SchoolRules`, and the tenants port's texts, words and values). A school's specifics reach the roster
only through those ports.

## Words the code uses

- **The host** — the application that starts dakhila and fills its ports; dakhila never reads an environment
  variable, a file of the deployment or an address of its own.
- **The ports** — the one interface dakhila declares (`src/ports.ts`) and the host fills: every outside thing the
  roster needs comes through one.
- **The door** — the identity provider. A person's token from the door, exchanged for the roster's audience, is how
  a person calls the API (`src/token.ts`).
- **The dowry** — the configuration a tenant brings before the roster runs for it: its addresses, domain and other
  values, read through the tenants port and refused by name when missing.
- **The seam** — the answers a public caller such as a school's own website shows a visitor who signed in at the
  door: the family card, the teacher card and the chatbot context, found by the visitor's address (`src/seam.ts`).
- **The three-universes run** — mapping the roster, Google Classroom and the mailing lists against each other for
  one session, and naming every place they disagree (`src/lib/three-universes.ts`).
- **The school board** — the one Google Classroom course every family and teacher joins, for whole-school notices.
- **Genealogy** — the family tree the roster keeps beside its families: parents, spouses and children across
  generations (`src/genealogy.ts`).
- **The bursar** — the role that matches money received to families and events, books it and refunds it
  (`src/bursar.ts`).
- **The chatbot context** — one family's facts, without names or birth dates, for an assistant answering that
  family's questions (`seam.familyContext`).
- **Production** — the one environment name the code knows, and only where an act cannot be undone: off
  production, Google writes, mail and texts are stood in for or redirected by the host.

## The contract's extensions

`contract/openapi.json` marks each operation with who may call it:

- `x-permission` — the permission the caller's roles must grant.
- `x-also-allowed` — in words, who else is admitted without that permission (for example, a family reading its own
  record); the rule itself is the route's `allowed` function.
- `x-public-door` — called by the host's own certificate with no person (self-registration, a vendor's webhook);
  no permission and no role.
- `x-address-only` — a read that names the caller only by the address the door verified, admitted even when that
  address is no user of the host; no act is recorded under it.

## Use

```
npm ci
npm run typecheck
npm test
npm run build            # dist/index.js, packages left external
npm run contract         # contract/openapi.json from the route table
```

The package's entry (`src/index.ts`) exports the server's start function, the ports' types, the table definitions
and the pure functions; a host may also import a module by its path (`dakhila/src/lib/…`). Its tests run with fake ports (`src/ports-fake.ts`) and need no database and no host.

Table definitions are drizzle definitions made from the host's tables (`src/tables.ts`, `src/host-tables.ts`); the
host generates and runs the migration steps in its own list.

## Gates

- `npm run check-imports` — every import resolves inside this repository or to a declared package.
- `npm run check-addresses` — no address but names reserved for documentation and the vendors on
  `scripts/address-allow.json`, each with its reason.
- `npm run check-contract` — the committed contract is the route table.

## Licence

Apache License 2.0 (see `LICENSE` and `NOTICE`), https://www.apache.org/licenses/LICENSE-2.0.
