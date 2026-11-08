// THE MAIL GROUPS: the addresses the named recipient groups resolve to — the governing body where the
// school names one, this session's teachers and enrolled students and their parents, whole or by one of the school's
// languages, asked email.write.
import { may } from './access'
import type { Route } from './routes'
import { badRequest, ok, S } from './op'
import { resolveAllEmails } from './lib/email-groups'
import { groupLanguage } from './lib/email-groups-types'
import { tenantRules } from './lib/rules-context'

export const EMAIL_GROUP_ROUTES: Route[] = [
  {
    method: 'GET', path: '/v1/tenants/{slug}/roster/email-groups', operationId: 'emailGroup.addresses',
    summary: "Every address the named recipient groups resolve to, once each — `groups` is a comma-separated list of group names: enrolled-students, enrolled-parents, teachers, the school's governing body where its rules name one, and enrolled-parents-{language} and teachers-{language} for each of the school's languages.",
    permission: 'email.write',
    query: { groups: S.str },
    allowed: async c => may(c.caller, 'email.write'),
    response: S.list(S.str),
    handle: async c => {
      const groups = (c.query.groups ?? '').split(',').map(g => g.trim()).filter(Boolean)
      const r = await tenantRules(c.tenant.id)
      const rules = { languages: r.courses.languages, governingBody: r.codes.governingBody }
      const unknown = groups.filter(g => groupLanguage(rules, g) === undefined)
      if (unknown.length > 0) return badRequest(`not a recipient group: ${unknown.join(', ')}`)
      return ok(await resolveAllEmails(c.tenant.id, groups))
    },
  },
]
