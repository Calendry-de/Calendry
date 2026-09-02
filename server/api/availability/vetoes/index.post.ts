import { z } from 'zod';
import { normaliseWindow, tenantGridLimits, windowSchema } from '../../../utils/availability';
import { mapDbErrors } from '../../../utils/dbErrors';
import { requirePermission } from '../../../utils/requirePermission';
import { withRequestTenant } from '../../../utils/tenantDb';

const BODY = windowSchema.extend({ personId: z.string().min(1) });

/**
 * An administrator declares unavailability for somebody: APPROVED on arrival.
 *
 * Not queued for review, because queueing it would mean approving your own
 * authorized action. `availability.manage_any` IS the authority the approval
 * step checks for; asking a holder of it to then approve their own entry is
 * ceremony, not control.
 *
 * The decision columns are filled with the acting administrator rather than left
 * null, so "APPROVED by nobody" never exists: the CHECK on the table pins the
 * timestamp half of that, and this fills the pointer.
 */
export default defineEventHandler(async (event) => {
    const body = await readValidatedBody(event, BODY.parse);

    return withRequestTenant(event, async (tx, identity) => {
        await requirePermission(event, tx, 'availability.manage_any');

        // The subject must exist IN THIS TENANT before anything is written.
        // Without it, a foreign id inserts a row the RLS WITH CHECK then
        // rejects, a 500 dressed up as a server fault where the honest answer
        // is 404.
        const person = await tx.person.findFirst({
            where: { id: body.personId, tenantId: identity.tenantId },
            select: { id: true },
        });

        if (!person) {
            throw createError({ statusCode: 404, statusMessage: 'Not found.' });
        }

        const limits = await tenantGridLimits(tx, identity.tenantId);
        const window = normaliseWindow(body, limits);

        const created = await mapDbErrors(() => tx.personUnavailability.create({
            data: {
                tenantId: identity.tenantId,
                personId: body.personId,
                ...window,
                reason: body.reason ?? null,
                status: 'APPROVED',
                createdByPersonId: identity.actorPersonId,
                decidedByPersonId: identity.actorPersonId,
                decidedAt: new Date(),
            },
            select: { id: true, status: true },
        }));

        setResponseStatus(event, 201);

        return created;
    });
});
