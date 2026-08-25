import { normaliseWindow, tenantGridLimits, windowSchema } from '../../../utils/availability';
import { mapDbErrors } from '../../../utils/dbErrors';
import { requirePermission } from '../../../utils/requirePermission';
import { withRequestTenant } from '../../../utils/tenantDb';

/**
 * Declare unavailability for YOURSELF. Lands PENDING.
 *
 * The subject is the session's own Person and cannot be named in the request,
 * so this route has no way to write a window against anybody else — see the GET
 * alongside it.
 *
 * PENDING, not APPROVED, because a veto is a HARD constraint. Someone who could
 * self-approve one could make a term infeasible on their own, and the failure
 * would surface as unplaced Sessions with nothing pointing back at the cause.
 * Approval is not distrust of the person; it is a review step on the only input
 * an unprivileged user can supply that the solver treats as inviolable.
 */
export default defineEventHandler(async (event) => {
    const body = await readValidatedBody(event, windowSchema.parse);

    return withRequestTenant(event, async (tx, identity) => {
        await requirePermission(event, tx, 'availability.manage_own');

        const personId = identity.actorPersonId;

        if (!personId) {
            throw createError({ statusCode: 403, statusMessage: 'No acting Person on this session.' });
        }

        const limits = await tenantGridLimits(tx, identity.tenantId);
        const window = normaliseWindow(body, limits);

        const created = await mapDbErrors(() => tx.personUnavailability.create({
            data: {
                tenantId: identity.tenantId,
                personId,
                ...window,
                reason: body.reason ?? null,
                // Explicit rather than relying on the column default: the two
                // write paths differ ONLY in this field and the decision
                // columns, so both state it and neither is read as "whatever
                // the schema happens to do".
                status: 'PENDING',
                createdByPersonId: personId,
            },
            select: { id: true, status: true },
        }));

        setResponseStatus(event, 201);

        return created;
    });
});
