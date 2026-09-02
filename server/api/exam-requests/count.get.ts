import { z } from 'zod';
import { requirePermission } from '../../utils/requirePermission';
import { withRequestTenant } from '../../utils/tenantDb';

/**
 * HOW MANY exam requests match, without the review queue's whole payload.
 *
 * `GET /api/exam-requests` answers a REVIEW PAGE, not a number: every row
 * carries its Offering, kind, room, term and both people, and each row's week
 * is re-classified per Term through `classifyTermWeeks` so a request outlives
 * the calendar it was made against. That is right for the page and wrong for a
 * dashboard tile, which would pull the institution's entire pending queue plus
 * a week classification per Term on every sign-in to learn one integer.
 *
 * A SEPARATE ROUTE rather than a `?count=1` mode, same reasoning as
 * `generations/count.get.ts` and `availability/vetoes/count.get.ts`: CLAUDE.md
 * names shape-switching on a query parameter as a repeat source of bugs
 * typecheck cannot see (`request<T>()` is an unchecked assertion about what the
 * server sends), and a route whose only possible answer is `{ total }` cannot
 * be read as the other shape by mistake.
 *
 * `exam.review` AND NOT `exam.request_own`, copied from the list route rather
 * than narrowed or widened: this counts EVERYBODY's requests, so the key that
 * lets a lecturer ask for their own exam must not let them learn the size of
 * the institution's queue. A caller's own list is `/api/me/exam-requests`,
 * which is a different route because it answers a different question. A count
 * that could be read without the rows it counts would be an information leak
 * dressed as a number.
 */
const querySchema = z.object({
    status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
});

defineRouteMeta({
    openAPI: {
        tags: ['Resources'],
        summary: 'Count the exam requests matching a filter',
        description: 'Answers "how many" with a single COUNT query rather than returning the review queue and its per-row reference data: the cheap form of GET /api/exam-requests for a caller that only needs the number, such as the dashboard\'s review-queue tile. Same tenant scope and the same exam.review gate as the list route, and the same status filter, so the number always describes exactly the list the caller could have fetched. status=PENDING is the count awaiting a decision.',
        parameters: [
            { name: 'status', in: 'query', required: false, schema: { type: 'string', enum: ['PENDING', 'APPROVED', 'REJECTED'] }, description: 'Count only exam requests in this status. Omitted: every status.' },
        ],
        responses: {
            200: {
                description: 'The number of matching exam requests in this tenant.',
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            required: ['total'],
                            properties: {
                                total: { type: 'integer', minimum: 0, description: 'Matching row count. Never capped: this is the whole filtered set.' },
                            },
                        },
                    },
                },
            },
            403: { description: 'Caller lacks exam.review.' },
        },
    },
});

export default defineEventHandler(async (event) => {
    const query = await getValidatedQuery(event, querySchema.parse);

    return withRequestTenant(event, async (tx, identity) => {
        await requirePermission(event, tx, 'exam.review');

        const total = await tx.examRequest.count({
            where: {
                tenantId: identity.tenantId,
                ...(query.status ? { status: query.status } : {}),
            },
        });

        return { total };
    });
});
