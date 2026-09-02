import { requirePermission } from '../../../utils/requirePermission';
import { withRequestTenant } from '../../../utils/tenantDb';

/**
 * Remove any window in the tenant.
 *
 * Rows are immutable, so an administrator correcting a window deletes it and
 * enters a new one: the same rule the self-service side follows, for the same
 * reason: an edit path would need its own re-enters-pending state machine.
 *
 * A REJECTED row is deliberately kept until somebody deletes it, so the
 * submitter can see what happened to their request. Rejecting is not a
 * synonym for deleting.
 */
export default defineEventHandler(async (event) => {
    const id = getRouterParam(event, 'id');

    return withRequestTenant(event, async (tx, identity) => {
        await requirePermission(event, tx, 'availability.manage_any');

        const removed = await tx.personUnavailability.deleteMany({
            where: { id, tenantId: identity.tenantId },
        });

        if (removed.count === 0) {
            throw createError({ statusCode: 404, message: 'Not found.' });
        }

        setResponseStatus(event, 204);

        return null;
    });
});
