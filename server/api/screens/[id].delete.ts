import { requireAnyPermission } from '../../utils/requirePermission';
import { withRequestTenant } from '../../utils/tenantDb';

/**
 * Delete a screen, permanently invalidating its key.
 *
 * `screen_room` cascades. Deleting is the irreversible half of revocation;
 * `isActive: false` is the recoverable one, and the difference matters because
 * only one of them lets a display be brought back without somebody walking to
 * it with a new URL.
 */
export default defineEventHandler(async (event) => {
    const id = getRouterParam(event, 'id');

    if (!id) {
        throw createError({ statusCode: 400, message: 'Missing screen id.' });
    }

    return withRequestTenant(event, async (tx) => {
        await requireAnyPermission(event, tx, ['screen.manage']);

        const existing = await tx.screen.findFirst({ where: { id } });

        if (!existing) {
            throw createError({ statusCode: 404, message: 'Screen not found.' });
        }

        await tx.screen.delete({ where: { id } });
        setResponseStatus(event, 204);

        return null;
    });
});
