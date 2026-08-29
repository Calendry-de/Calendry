import { preferencesSchema, replaceRoomFeaturePreferences, tenantGridLimits } from '../../utils/availability';
import { preferencesAreEmpty } from '../../../shared/availability';
import { mapDbErrors } from '../../utils/dbErrors';
import { requirePermission } from '../../utils/requirePermission';
import { withRequestTenant } from '../../utils/tenantDb';

/**
 * Set your OWN soft preferences. No approval, and none is needed.
 *
 * A preference is soft and tenant-weighted: it cannot make a term infeasible
 * the way a veto can, so there is nothing for a reviewer to protect.
 *
 * ALL THREE AXES REACH THE SOLVER — days, blocks and preferred room types all
 * travel as `Person.preferred`. This comment previously said the opposite
 * ("no effect on the solver at all — the wire has no field for it yet"), which
 * was true when written and had been wrong since the field shipped.
 */
export default defineEventHandler(async (event) => {
    const raw = await readBody(event);

    /*
     * A PERSON MAY NOT SET THEIR OWN PREFERENCE WEIGHT.
     *
     * Refused by name, and refused BEFORE parsing, because zod strips unknown
     * keys: left to the schema this would be accepted with a 200 and silently
     * dropped, which is the worst of the three possible behaviours — the caller
     * is told it worked. The administrator path
     * (`PUT /api/availability/preferences/[personId]`) is where the override
     * lives.
     *
     * This check is deliberately NOT shared with that path. It is the one place
     * the two endpoints stop being the same operation with different subjects,
     * and a shared code path with a comment explaining the difference is how
     * that distinction gets refactored away by someone who reads the code and
     * not the comment.
     */
    if (raw && typeof raw === 'object' && 'weightMultiplier' in raw) {
        throw createError({
            statusCode: 400,
            statusMessage: 'A preference weight can only be set by an administrator. '
                + 'Send only preferredDays, preferredBlocks and preferredRoomFeatureIds.',
            data: { field: 'weightMultiplier' },
        });
    }

    const body = preferencesSchema.parse(raw);

    return withRequestTenant(event, async (tx, identity) => {
        await requirePermission(event, tx, 'availability.manage_own');

        const personId = identity.actorPersonId;

        if (!personId) {
            throw createError({ statusCode: 403, statusMessage: 'No acting Person on this session.' });
        }

        const limits = await tenantGridLimits(tx, identity.tenantId);
        const outOfRange = body.preferredBlocks.filter((block) => block >= limits.blocksPerDay);

        if (outOfRange.length) {
            throw createError({
                statusCode: 400,
                statusMessage: `Blocks must be between 0 and ${limits.blocksPerDay - 1} — the largest time grid `
                    + `in this tenant has ${limits.blocksPerDay} blocks per day.`,
                data: { field: 'preferredBlocks' },
            });
        }

        return mapDbErrors(async () => {
            /*
             * An ABSENT row is the "no preference" state, so clearing both axes
             * deletes rather than storing two empty arrays. Otherwise the same
             * state has two representations that render identically and compare
             * differently.
             */
            if (preferencesAreEmpty(body)) {
                // The join rows go with it: the FK cascades from
                // `person_preference`, so clearing every axis leaves nothing
                // behind to make "absent" and "empty" two states again.
                await tx.personPreference.deleteMany({ where: { personId, tenantId: identity.tenantId } });

                return null;
            }

            const data = {
                preferredDays: [...new Set(body.preferredDays)].sort((a, b) => a - b),
                preferredBlocks: [...new Set(body.preferredBlocks)].sort((a, b) => a - b),
            };

            const saved = await tx.personPreference.upsert({
                where: { personId },
                create: { personId, tenantId: identity.tenantId, ...data },
                update: data,
                select: { preferredDays: true, preferredBlocks: true },
            });

            // AFTER the upsert, never before: the join rows reference
            // `person_preference`, so writing them first would fail the FK for
            // anyone stating a room preference as their very first one.
            await replaceRoomFeaturePreferences(tx, {
                tenantId: identity.tenantId,
                personId,
                equipmentIds: body.preferredRoomFeatureIds,
            });

            return { ...saved, preferredRoomFeatureIds: body.preferredRoomFeatureIds };
        });
    });
});
