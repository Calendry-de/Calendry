import { staffPreferencesSchema, tenantGridLimits } from '../../../utils/availability';
import { preferencesAreEmpty } from '../../../../shared/availability';
import { mapDbErrors } from '../../../utils/dbErrors';
import { requirePermission } from '../../../utils/requirePermission';
import { withRequestTenant } from '../../../utils/tenantDb';

/**
 * Set anyone's preferences directly.
 *
 * `manage_any` only — `read_any` reaches the overview and stops there, which is
 * the whole reason the two keys are separate.
 *
 * No approval on this path either, and none on the self-service one: a
 * preference is soft and tenant-weighted, so it cannot make a term infeasible
 * the way a veto can. In this slice it additionally has no solver effect at all.
 *
 * STORED, NOT YET HONOURED — see the `PersonPreference` model comment.
 */
export default defineEventHandler(async (event) => {
    const personId = getRouterParam(event, 'personId');
    const body = await readValidatedBody(event, staffPreferencesSchema.parse);

    return withRequestTenant(event, async (tx, identity) => {
        await requirePermission(event, tx, 'availability.manage_any');

        const person = await tx.person.findFirst({
            where: { id: personId, tenantId: identity.tenantId },
            select: { id: true },
        });

        if (!person) {
            throw createError({ statusCode: 404, statusMessage: 'Not found.' });
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
             * Both axes empty IS "no preference", and that state has exactly one
             * representation: no row.
             *
             * DELIBERATE CONSEQUENCE: the weight override goes with it. A
             * multiplier modifies a preference, so it cannot outlive one — a row
             * holding only a weight would be a factor applied to nothing. The
             * axes are therefore what decides existence, and `weightMultiplier`
             * is only ever read on a row that already has something to weight.
             */
            if (preferencesAreEmpty(body)) {
                await tx.personPreference.deleteMany({ where: { personId: person.id, tenantId: identity.tenantId } });

                return null;
            }

            const data = {
                preferredDays: [...new Set(body.preferredDays)].sort((a, b) => a - b),
                preferredBlocks: [...new Set(body.preferredBlocks)].sort((a, b) => a - b),
                weightMultiplier: body.weightMultiplier,
            };

            return tx.personPreference.upsert({
                where: { personId: person.id },
                create: { personId: person.id, tenantId: identity.tenantId, ...data },
                update: data,
                select: { preferredDays: true, preferredBlocks: true, weightMultiplier: true },
            });
        });
    });
});
