import {
    normaliseWindow, resolveVetoDate, tenantGridLimits, tenantTerms, windowSchema,
} from '../../../utils/availability';
import { mapDbErrors } from '../../../utils/dbErrors';
import { requirePermission } from '../../../utils/requirePermission';
import { withRequestTenant } from '../../../utils/tenantDb';

/**
 * Declare unavailability for YOURSELF. Lands PENDING.
 *
 * TWO ENTRY SHAPES, ONE ROUTE: a recurring day/week pattern (unchanged, writes
 * no Term: "every Friday, every term"), or a single `date`: "I cannot teach
 * this day" (issue #2's schedule button), which resolves to exactly one
 * Term's week and writes it, because a specific date is NOT "every term" the
 * way a recurring pattern is.
 *
 * The subject is the session's own Person and cannot be named in the request,
 * so this route has no way to write a window against anybody else; see the GET
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

        /*
         * TWO SHAPES, ONE ROUTE. `date` names a single calendar date (issue
         * #2's "I cannot teach this day") and MUST NOT be combined with the
         * axis fields: naming both is ambiguous about which one the caller
         * meant, and guessing which is how a lecturer ends up blocking a
         * different day than the one they clicked.
         */
        if (body.date && (body.days.length || body.weeks.length)) {
            throw createError({
                statusCode: 400,
                statusMessage: 'Name a single date, or a recurring day/week pattern, not both.',
                data: { field: 'date' },
            });
        }

        let window: { days: number[]; blocks: number[]; weeks: number[] };
        let termId: string | null = null;

        if (body.date) {
            const terms = await tenantTerms(tx, identity.tenantId);
            const resolved = resolveVetoDate(terms, new Date(body.date));

            termId = resolved.term.id;
            window = { days: [resolved.dayOfWeek], blocks: [], weeks: resolved.weeks };
        } else {
            const limits = await tenantGridLimits(tx, identity.tenantId);

            window = normaliseWindow(body, limits);
        }

        const created = await mapDbErrors(() => tx.personUnavailability.create({
            data: {
                tenantId: identity.tenantId,
                personId,
                termId,
                ...window,
                reason: body.reason ?? null,
                // Explicit rather than relying on the column default: the two
                // write paths differ ONLY in this field and the decision
                // columns, so both state it and neither is read as "whatever
                // the schema happens to do".
                status: 'PENDING',
                createdByPersonId: personId,
            },
            select: { id: true, status: true, termId: true, weeks: true },
        }));

        setResponseStatus(event, 201);

        return created;
    });
});
