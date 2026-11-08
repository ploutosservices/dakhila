// THE ROSTER EXPORT: the rows of the roster's spreadsheet export, one sheet per call (lib/roster-export.ts), asked
// roster.export. The host writes the workbook from the rows.
import { may } from './access'
import type { Route } from './routes'
import { badRequest, notFound, ok, S } from './op'
import { rosterExport } from './lib/roster-export'

export const EXPORT_ROUTES: Route[] = [
  {
    method: 'GET', path: '/v1/tenants/{slug}/roster/export', operationId: 'roster.export',
    summary: "One sheet of the roster export: `type` persons, students, classes (of `year`), class (`id`, with its families' contacts) or tracker (of `year`, narrowed to `status`, a group's name or a code); the sheet's name, its rows by column, the file's name.",
    permission: 'roster.export',
    allowed: async c => may(c.caller, 'roster.export'),
    query: { type: S.str, year: S.str, id: S.str, status: S.str },
    response: S.obj({ sheet: S.str, rows: S.list(S.row('a spreadsheet row: column name to value')), filename: S.str }),
    handle: async c => {
      const r = await rosterExport(c.tenant.id, {
        type: c.query.type ?? '', year: c.query.year ?? null, id: c.query.id ?? null, status: c.query.status ?? null,
      })
      if ('error' in r) return r.status === 404 ? notFound(r.error) : badRequest(r.error)
      return ok(r)
    },
  },
]
