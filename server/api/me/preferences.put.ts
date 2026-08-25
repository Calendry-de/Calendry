import { preferencesSchema, tenantGridLimits } from '../../utils/availability';
import { preferencesAreEmpty } from '../../../shared/availability';
import { mapDbErrors } from '../../utils/dbErrors';
import { requirePermission } from '../../utils/requirePermission';
import { withRequestTenant } from '../../utils/tenantDb';

/**
 * Set your OWN soft preferences. No approval, and none is needed.
 *
 * A preference is soft and tenant-weighted: it cannot make a term infeasible
 * the way a veto can, so there is nothing for a reviewer to protect. In THIS
 * slice it additionally has no effect on the solver at all — the wire has no
 * field for it yet — so an approval workflow would be gating something inert.
 *
 * STORED, NOT YET HONOURED. See the `PersonPreference` model comment: unlike
 * the `lecturer_veto` gap this resembles, the absence of a wire mapping here is
 * deliberate, temporary, and stated on the page where the data is entered.
 */
export default defineEventHandler(async (event) => {
    const body = await readValidatedBody(event, preferencesSchema.parse);

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
                await tx.personPreference.deleteMany({ where: { personId, tenantId: identity.tenantId } });

                return null;
            }

            const data = {
                preferredDays: [...new Set(body.preferredDays)].sort((a, b) => a - b),
                preferredBlocks: [...new Set(body.preferredBlocks)].sort((a, b) => a - b),
            };

            return tx.personPreference.upsert({
                where: { personId },
                create: { personId, tenantId: identity.tenantId, ...data },
                update: data,
                select: { preferredDays: true, preferredBlocks: true },
            });
        });
    });
});
