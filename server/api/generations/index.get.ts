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
 * placements: a different data set from the applied timetable, and one a
 * lecturer has no business reading. So it gets its own key.
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
                /*
                 * IN THE QUERY, so `take` applies to the filtered set. This used
                 * to filter AFTER the fetch, on `run.termId`, which meant
                 * `?termId=X&limit=100` took the newest 100 proposals across
                 * every term and then kept whichever happened to belong to X, so
                 * a term with older proposals showed none of them and the list
                 * reported that as "no proposals yet".
                 */
                ...(query.termId ? { termId: query.termId } : {}),
            },
            select: GENERATION_SELECT,
            /*
             * BY DATE, not by version. Versions restart at 1 per term, so
             * ordering an unfiltered list by version interleaves terms by an
             * index that means nothing across them: Semester 1's v3 would
             * outrank Semester 2's v1 for no reason. `createdAt` is what "newest
             * proposal first" always meant; it simply used to coincide with
             * version while the series was tenant-wide.
             */
            orderBy: { createdAt: 'desc' },
            take: query.limit ?? 25,
        });

        // Sequential: `tx` is one shared connection; concurrent queries on it
        // trip pg's deprecated overlapping-query warning.
        const withRuns: Array<typeof generations[number] & { run: Awaited<ReturnType<typeof runSummaryFor>> }> = [];

        for (const generation of generations) {
            withRuns.push({ ...generation, run: await runSummaryFor(tx, identity.tenantId, generation.id) });
        }

        /*
         * The term filter is in the query above now that a Generation carries
         * its own `term_id`. One behaviour changed with it and is worth naming:
         * a tenant-wide MANUAL_BASELINE (`term_id IS NULL`) is excluded from a
         * term-filtered list, which is the same answer the old run-based filter
         * gave: a baseline has no run, so it never matched either.
         */
        return withRuns;
    });
});
