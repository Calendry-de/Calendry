import { z } from 'zod';
import { requirePermission } from '../../utils/requirePermission';
import { withRequestTenant } from '../../utils/tenantDb';

/**
 * HOW MANY proposals match, without fetching one of them.
 *
 * A SEPARATE ROUTE, NOT A `?count=1` MODE ON `index.get.ts`, deliberately.
 * CLAUDE.md names response shapes that switch on a query parameter as a repeat
 * source of bugs (`/api/[resource]` returning a bare array or `{ rows, total }`
 * depending on `limit` cost three bugs in one hour, and typecheck saw none of
 * them, because `request<T>()` is an unchecked assertion). A route whose only
 * possible answer is `{ total }` cannot be read as the other shape by mistake.
 *
 * WHY A COUNT IS WORTH ITS OWN ROUTE AT ALL. `/dashboard` wants to say "3
 * proposals waiting". `GET /api/generations` cannot answer that: it returns a
 * bare array capped at `limit` (max 100) with no total, and runs a
 * `runSummaryFor` subquery per row, so counting through it means pulling the
 * whole page's payload on every sign-in AND undercounting the moment a tenant
 * has more proposals than the cap. `count()` is one indexed aggregate and
 * cannot undercount.
 *
 * SAME PERMISSION AND SAME SCOPE AS THE LIST, which is the property that makes
 * this safe to add: `generation.read`, inside `withRequestTenant`, filtered on
 * the same `status`/`termId` the list route accepts. A count that could be read
 * without the rows it counts would be an information leak dressed as a number.
 */
const querySchema = z.object({
    termId: z.string().optional(),
    status: z.enum(['PENDING', 'RUNNING', 'READY', 'APPLIED', 'FAILED', 'SUPERSEDED', 'INFEASIBLE']).optional(),
});

defineRouteMeta({
    openAPI: {
        tags: ['Schedule'],
        summary: 'Count the Generations matching a filter',
        description: 'Answers "how many" with a single COUNT query rather than fetching rows: the cheap form of GET /api/generations for a caller that only needs the number, such as the dashboard\'s review-queue tile. Same tenant scope and same generation.read gate as the list route, and the same status/termId filters, so the number always describes exactly the list the caller could have fetched. status=READY is the count of proposals waiting for a human decision.',
        parameters: [
            { name: 'status', in: 'query', required: false, schema: { type: 'string', enum: ['PENDING', 'RUNNING', 'READY', 'APPLIED', 'FAILED', 'SUPERSEDED', 'INFEASIBLE'] }, description: 'Count only Generations in this status. Omitted: every status.' },
            { name: 'termId', in: 'query', required: false, schema: { type: 'string' }, description: 'Count only Generations describing this Term. Omitted: every Term, including tenant-wide (term-less) Generations.' },
        ],
        responses: {
            200: {
                description: 'The number of matching Generations in this tenant.',
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            required: ['total'],
                            properties: {
                                total: { type: 'integer', minimum: 0, description: 'Matching row count. Never capped: this is the whole filtered set, not a page of it.' },
                            },
                        },
                    },
                },
            },
            403: { description: 'Caller lacks generation.read.' },
        },
    },
});

export default defineEventHandler(async (event) => {
    const query = await getValidatedQuery(event, querySchema.parse);

    return withRequestTenant(event, async (tx, identity) => {
        await requirePermission(event, tx, 'generation.read');

        const total = await tx.generation.count({
            where: {
                tenantId: identity.tenantId,
                ...(query.status ? { status: query.status } : {}),
                ...(query.termId ? { termId: query.termId } : {}),
            },
        });

        return { total };
    });
});
