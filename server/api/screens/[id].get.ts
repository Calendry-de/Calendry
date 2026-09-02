import { requireAnyPermission } from '../../utils/requirePermission';
import { withRequestTenant } from '../../utils/tenantDb';

/** One screen, without its secret. See `index.get.ts` for why that is explicit. */
export default defineEventHandler(async (event) => {
    const id = getRouterParam(event, 'id');

    if (!id) {
        throw createError({ statusCode: 400, message: 'Missing screen id.' });
    }

    return withRequestTenant(event, async (tx) => {
        await requireAnyPermission(event, tx, ['screen.read', 'screen.manage']);

        const screen = await tx.screen.findFirst({
            where: { id },
            include: { rooms: { include: { room: { select: { id: true, name: true } } } } },
        });

        if (!screen) {
            throw createError({ statusCode: 404, message: 'Screen not found.' });
        }

        return {
            id: screen.id,
            name: screen.name,
            isActive: screen.isActive,
            lastSeenAt: screen.lastSeenAt,
            createdAt: screen.createdAt,
            roomIds: screen.rooms.map((link) => link.roomId),
            roomNames: screen.rooms.map((link) => link.room.name).sort(),
        };
    });
});
