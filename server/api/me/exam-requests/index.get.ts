import { requirePermission } from '../../../utils/requirePermission';
import { withRequestTenant } from '../../../utils/tenantDb';

/**
 * The requests this person made.
 *
 * Filtered on `actorPersonId` rather than on a parameter, matching the POST
 * beside it: there is no id to pass, so there is no id to get wrong.
 */
export default defineEventHandler(async (event) => withRequestTenant(event, async (tx, identity) => {
    await requirePermission(event, tx, 'exam.request_own');

    const rows = await tx.examRequest.findMany({
        where: { tenantId: identity.tenantId, requestedByPersonId: identity.actorPersonId },
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        include: {
            offering: { select: { id: true, title: true, code: true } },
            kind: { select: { id: true, name: true } },
            room: { select: { id: true, name: true, code: true } },
        },
    });

    return { rows };
}));
