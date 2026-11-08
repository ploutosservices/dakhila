// THE RECORD-LINK RESOLVER'S ONE ROSTER READ: the host's public link to an enrollment sends the reader to the family's
// enrollment, before anyone signs in. The host asks this as itself, with its certificate and no person, as every public
// door does. It answers only the family's id, which the link the reader lands on carries in its own address.
import type { Route } from './routes'
import { notFound, ok, S } from './op'
import { enrollmentFamilyId } from './lib/enrollment-family'

export const RECORD_LINK_ROUTES: Route[] = [
  {
    method: 'GET', path: '/v1/tenants/{slug}/public/enrollments/{id}/family', operationId: 'record.enrollmentFamily',
    summary: "The family an enrollment belongs to, for the host's public record link: its id only. 404 when there is no such enrollment.",
    permission: null, publicDoor: true, allowed: async () => false,
    response: S.obj({ familyId: S.uuid }),
    handle: async c => {
      const familyId = await enrollmentFamilyId(c.params.id)
      return familyId ? ok({ familyId }) : notFound('no such enrollment')
    },
  },
]
