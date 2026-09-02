import { z } from 'zod';
import { SCREEN_MODES } from '../../../shared/screenKey';
import { mapDbErrors } from '../../utils/dbErrors';
import { requireAnyPermission } from '../../utils/requirePermission';
import { withRequestTenant } from '../../utils/tenantDb';

/**
 * Rename, re-scope, or revoke a screen.
 *
 * NO KEY ROTATION HERE, deliberately. Rotating invalidates the URL typed into a
 * device on a wall, and the person clicking the button is rarely the person who
 * can walk to it, so it belongs behind its own explicit action, not behind a
 * PATCH that also renames things. Revoking (`isActive: false`) is the
 * recoverable half and lives here.
 */
const BODY = z.object({
    name: z.string().trim().min(1).max(200).optional(),
    /*
     * `nullish` for the same reason as the create route: the shared form sends
     * `null` for a field nobody touched, and `optional()` rejects it.
     *
     * The three states are then distinct and all meaningful: absent or null is
     * "leave the scope alone", an ARRAY is "make it exactly this", and an EMPTY
     * array is "clear it", which means every room. That is why the guard below
     * is `Array.isArray` rather than a truthiness check: `[]` is a real value
     * here and a falsy one.
     */
    /** Which board it draws (issue #31). Absent or null leaves it alone. */
    mode: z.enum(SCREEN_MODES).nullish(),
    roomIds: z.array(z.string().min(1)).nullish(),
    /** The second scope axis, with the identical three-state reading. */
    groupIds: z.array(z.string().min(1)).nullish(),
    isActive: z.boolean().nullish(),
});

export default defineEventHandler(async (event) => {
    const id = getRouterParam(event, 'id');
    const body = await readValidatedBody(event, BODY.parse);

    if (!id) {
        throw createError({ statusCode: 400, message: 'Missing screen id.' });
    }

    return withRequestTenant(event, async (tx, identity) => {
        await requireAnyPermission(event, tx, ['screen.manage']);

        // RLS makes a cross-tenant id invisible, so this is 404 rather than 403,
        // the same answer `accounts` gives, and for the same reason: a 403
        // would confirm the row exists somewhere.
        const existing = await tx.screen.findFirst({ where: { id } });

        if (!existing) {
            throw createError({ statusCode: 404, message: 'Screen not found.' });
        }

        return mapDbErrors(async () => {
            const screen = await tx.screen.update({
                where: { id },
                data: {
                    ...(body.name == null ? {} : { name: body.name }),
                    ...(body.mode == null ? {} : { mode: body.mode }),
                    ...(body.isActive == null ? {} : { isActive: body.isActive }),
                },
            });

            // A PUT-set, like every other relation here: absent means unchanged,
            // present means exactly this set, and an empty array is a real value
            // meaning "every room" rather than a no-op.
            if (Array.isArray(body.roomIds)) {
                await tx.screenRoom.deleteMany({ where: { screenId: id } });

                if (body.roomIds.length) {
                    await tx.screenRoom.createMany({
                        data: body.roomIds.map((roomId) => ({
                            screenId: id,
                            roomId,
                            tenantId: identity.tenantId,
                        })),
                    });
                }
            }

            // The group axis is a PUT-set on exactly the same three-state
            // terms: absent/null unchanged, an array is the whole new set, and
            // an empty array clears it, which means every group.
            if (Array.isArray(body.groupIds)) {
                await tx.screenGroup.deleteMany({ where: { screenId: id } });

                if (body.groupIds.length) {
                    await tx.screenGroup.createMany({
                        data: body.groupIds.map((groupId) => ({
                            screenId: id,
                            groupId,
                            tenantId: identity.tenantId,
                        })),
                    });
                }
            }

            return { id: screen.id, name: screen.name, mode: screen.mode, isActive: screen.isActive };
        });
    });
});
