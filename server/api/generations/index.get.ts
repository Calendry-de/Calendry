import { z } from 'zod';
import { GENERATION_SELECT, runSummaryFor } from '../../utils/generationRead';
import { requirePermission } from '../../utils/requirePermission';
import { withRequestTenant } from '../../utils/tenantDb';

/**
 * The proposals a tenant could act on.
 *
 * `generation.read`, and it used to be `session.read` on the reasoning that a
 * proposal shows the same placements the schedule already shows. That reasoning
 * was wrong in a way only the navigation made visible: everybody who could look
 * at a schedule was offered "Proposals" in the header and could read every
 * solver run this tenant had ever produced. A Generation is a set of PROPOSED
 * placements — a different data set from the applied timetable, and one a
 * lecturer has no business reading — so it gets its own key.
 *
 * `generation.read` is NOT implied by `generation.apply`, deliberately: the
 * catalogue has no implication mechanism, so a role holding only the apply key
 * would be able to promote a proposal it cannot look at. Grant both.
 */
const querySchema = z.object({
    termId: z.string().optional(),
    status: z.enum(['PENDING', 'RUNNING', 'READY', 'APPLIED', 'FAILED', 'SUPERSEDED', 'INFEASIBLE']).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
});

export default defineEventHandler(async (event) => {
    const query = await getValidatedQuery(event, querySchema.parse);

    return withRequestTenant(event, async (tx, identity) => {
        await requirePermission(event, tx, 'generation.read');

        const generations = await tx.generation.findMany({
            where: {
                tenantId: identity.tenantId,
                ...(query.status ? { status: query.status } : {}),
            },
            select: GENERATION_SELECT,
            // Newest proposal first: the list's job is "what could I apply?",
            // and that is almost always the most recent one.
            orderBy: { version: 'desc' },
            take: query.limit ?? 25,
        });

        const withRuns = await Promise.all(generations.map(async (generation) => ({
            ...generation,
            run: await runSummaryFor(tx, identity.tenantId, generation.id),
        })));

        /**
         * Term filtering happens HERE rather than in the query because a
         * Generation carries no term — only its run does, and a manual
         * Generation has no run at all. Filtering by term therefore means "runs
         * for this term", and a manual baseline is correctly excluded from that
         * question rather than silently included.
         */
        return query.termId
            ? withRuns.filter((g) => g.run?.termId === query.termId)
            : withRuns;
    });
});
