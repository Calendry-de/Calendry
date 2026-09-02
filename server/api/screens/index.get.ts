import { z } from 'zod';
import { requireAnyPermission } from '../../utils/requirePermission';
import { withRequestTenant } from '../../utils/tenantDb';

/**
 * The lobby displays configured for this institution.
 *
 * Own handler rather than the generic CRUD scaffold, for the same reason
 * `accounts` has one: a Screen carries a SECRET, and the generic routes return
 * the row they wrote. Here the row must never carry its key, not even its hash,
 * so what a client sees is assembled deliberately rather than by projection.
 *
 * Response shape follows the generic list route exactly (bare array without
 * `limit`, `{ rows, total }` with it), because `useEntityList` is shared.
 */
const LIST_QUERY = z.object({
    limit: z.coerce.number().int().min(1).max(200).optional(),
    offset: z.coerce.number().int().min(0).optional(),
    q: z.string().trim().min(1).max(200).optional(),
});

export default defineEventHandler(async (event) => {
    const query = await getValidatedQuery(event, LIST_QUERY.parse);

    return withRequestTenant(event, async (tx) => {
        await requireAnyPermission(event, tx, ['screen.read', 'screen.manage']);

        const where = query.q
            ? { name: { contains: query.q, mode: 'insensitive' as const } }
            : {};

        const rows = await tx.screen.findMany({
            where,
            orderBy: { name: 'asc' },
            take: query.limit,
            skip: query.offset,
            include: {
                rooms: { include: { room: { select: { id: true, name: true } } } },
                groups: { include: { group: { select: { id: true, name: true } } } },
            },
        });

        const mapped = rows.map((screen) => ({
            id: screen.id,
            name: screen.name,
            mode: screen.mode,
            isActive: screen.isActive,
            lastSeenAt: screen.lastSeenAt,
            createdAt: screen.createdAt,
            // The scope, named rather than as ids, because "shows nothing" and
            // "shows everything" are the same empty list and only the words tell
            // them apart. BOTH axes travel on every row regardless of mode: the
            // management form has to render the one that applies, and switching
            // a screen's mode must not silently discard the other's set.
            roomIds: screen.rooms.map((link) => link.roomId),
            roomNames: screen.rooms.map((link) => link.room.name).sort(),
            groupIds: screen.groups.map((link) => link.groupId),
            groupNames: screen.groups.map((link) => link.group.name).sort(),
            // `tokenHash` is deliberately absent. It is not a secret a client
            // needs, and returning it would put a credential-shaped string into
            // a payload somebody will eventually log.
        }));

        if (query.limit === undefined) {
            return mapped;
        }

        return { rows: mapped, total: await tx.screen.count({ where }) };
    });
});
