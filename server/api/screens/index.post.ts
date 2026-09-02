import { z } from 'zod';
import { generateSessionToken, hashToken } from '../../utils/auth';
import { SCREEN_KEY_MIN_LENGTH, SCREEN_MODES } from '../../../shared/screenKey';
import { mapDbErrors } from '../../utils/dbErrors';
import { requireAnyPermission } from '../../utils/requirePermission';
import { withRequestTenant } from '../../utils/tenantDb';

/**
 * Create a screen and issue its key.
 *
 * ONLY THE SHA-256 IS STORED, the same treatment `auth_session` gives its token:
 * a leaked database backup must not hand over working credentials. So the key
 * exists in exactly one moment and the UI has to say so.
 *
 * THE BROWSER MAY SUPPLY IT, and the management form does, for precisely the
 * reason an account's initial password is generated client-side: the create page
 * navigates to the saved row on success, so a key generated here would be gone
 * before anybody could read it. When a caller sends none (a script, a future
 * CLI) one is generated here and returned, where there is no navigation to lose
 * it to.
 */
const BODY = z.object({
    name: z.string().trim().min(1).max(200),
    /*
     * Length is floored, not formatted: the value only ever has to be
     * unguessable and URL-safe, and pinning a shape here would make the server
     * reject a perfectly good key from a future generator.
     */
    key: z.string().min(SCREEN_KEY_MIN_LENGTH).max(512).nullish(),
    /*
     * EMPTY MEANS EVERY ROOM, matching the table's fail-open reading. A screen
     * created without a scope shows the building; a fail-closed reading would
     * produce a blank display indistinguishable from a broken one.
     *
     * `nullish`, NOT `optional`, and the difference is the whole bug this once
     * had. `useEntityForm` serialises every declared field on every save and
     * returns `value ?? null` for anything untouched, so a form where nobody
     * ticked a room sends `roomIds: null`, which `optional()` rejects. The most
     * ordinary way to create a screen answered "Validation Error". Null and
     * absent both mean "no scope stated", which is what the empty case is.
     */
    /*
     * Which board this screen draws (issue #31). `nullish` and defaulted here
     * rather than `.default()` in the schema, for the same reason `roomIds` is
     * nullish: the shared form sends `null` for anything untouched, and the
     * column's own default is the mode that existed before there were two.
     */
    mode: z.enum(SCREEN_MODES).nullish(),
    roomIds: z.array(z.string().min(1)).nullish(),
    /*
     * The SECOND scope axis, read only by `SUBSTITUTION_PLAN`. Same fail-open
     * reading and the same `nullish` treatment as `roomIds`: EMPTY MEANS EVERY
     * GROUP, and a form where nobody ticked a group sends `null`.
     */
    groupIds: z.array(z.string().min(1)).nullish(),
    isActive: z.boolean().nullish(),
});

export default defineEventHandler(async (event) => {
    const body = await readValidatedBody(event, BODY.parse);

    return withRequestTenant(event, async (tx, identity) => {
        await requireAnyPermission(event, tx, ['screen.manage']);

        const key = body.key ?? generateSessionToken();

        return mapDbErrors(async () => {
            const screen = await tx.screen.create({
                data: {
                    tenantId: identity.tenantId,
                    name: body.name,
                    tokenHash: hashToken(key),
                    mode: body.mode ?? 'ROOM_BOARD',
                    isActive: body.isActive ?? true,
                },
            });

            if (body.roomIds?.length) {
                /*
                 * Written through the tenant transaction, so RLS decides whether
                 * these rooms are ours. A room id from another institution fails
                 * the WITH CHECK rather than silently scoping a display to
                 * something it must never show.
                 */
                await tx.screenRoom.createMany({
                    data: body.roomIds.map((roomId) => ({
                        screenId: screen.id,
                        roomId,
                        tenantId: identity.tenantId,
                    })),
                });
            }

            // Same treatment, same reasoning: RLS decides whether these Groups
            // are ours.
            if (body.groupIds?.length) {
                await tx.screenGroup.createMany({
                    data: body.groupIds.map((groupId) => ({
                        screenId: screen.id,
                        groupId,
                        tenantId: identity.tenantId,
                    })),
                });
            }

            setResponseStatus(event, 201);

            return {
                id: screen.id,
                name: screen.name,
                mode: screen.mode,
                isActive: screen.isActive,
                roomIds: body.roomIds ?? [],
                groupIds: body.groupIds ?? [],
                /** SHOWN ONCE. Never stored, never recoverable. */
                key,
            };
        });
    });
});
