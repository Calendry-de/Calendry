import { requirePermission } from '../../../../utils/requirePermission';
import { withRequestTenant } from '../../../../utils/tenantDb';

/**
 * Withdraw one of your OWN windows, at any status.
 *
 * No approval, deliberately, and the asymmetry with creation is the point:
 * every deletion RELAXES the problem. Approval exists to stop unilateral
 * TIGHTENING: it can only ever make a term more feasible to stop declaring
 * yourself unavailable, so making somebody wait for a reviewer to un-block their
 * own Friday would be ceremony with a cost and no benefit.
 *
 * The `personId` filter is what makes this self-scoped: an id belonging to
 * somebody else matches zero rows and reports 404, exactly as a cross-tenant id
 * does on every other route. Rows are immutable, so this plus the POST is the
 * whole write surface: editing is delete-then-resubmit, which avoids an
 * "edit re-enters pending" state machine nobody asked for.
 */
export default defineEventHandler(async (event) => {
    const id = getRouterParam(event, 'id');

    return withRequestTenant(event, async (tx, identity) => {
        await requirePermission(event, tx, 'availability.manage_own');

        const personId = identity.actorPersonId;

        if (!personId) {
            throw createError({ statusCode: 403, message: 'No acting Person on this session.' });
        }

        const removed = await tx.personUnavailability.deleteMany({
            where: { id, personId, tenantId: identity.tenantId },
        });

        if (removed.count === 0) {
            throw createError({ statusCode: 404, message: 'Not found.' });
        }

        setResponseStatus(event, 204);

        return null;
    });
});
