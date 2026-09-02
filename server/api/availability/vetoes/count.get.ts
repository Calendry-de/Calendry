import { z } from 'zod';
import { requireAnyPermission } from '../../../utils/requirePermission';
import { withRequestTenant } from '../../../utils/tenantDb';

/**
 * HOW MANY vetoes match, without the review page's whole payload.
 *
 * `GET /api/availability/vetoes` answers a FORM, not a number: it carries the
 * rows, every active person in the tenant, the grid and the terms, all so the
 * review page's entry form has no second permission surface. That is right for
 * that page and wrong for a dashboard tile, which would trigger four queries
 * and several hundred rows on every sign-in to learn one integer, and would
 * still undercount past that route's `take: 500`.
 *
 * A SEPARATE ROUTE rather than a `?count=1` mode, same reasoning as
 * `generations/count.get.ts`: a route with one possible response shape cannot
 * be mistaken for the other one, and CLAUDE.md names shape-switching on a
 * query parameter as a repeat source of bugs typecheck cannot see.
 *
 * EITHER ADMINISTRATION KEY, exactly as the list route: `manage_any` obviously,
 * and `read_any` because a scheduler who may see who is unavailable without
 * being able to decide is a real role. The gate is copied from the list rather
 * than narrowed, so this route can never state a number about rows its caller
 * could not have read.
 */
const querySchema = z.object({
    status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
    personId: z.string().min(1).optional(),
});

defineRouteMeta({
    openAPI: {
        tags: ['Resources'],
        summary: 'Count the availability vetoes matching a filter',
        description: 'Answers "how many" with a single COUNT query rather than returning the review queue and its reference data: the cheap form of GET /api/availability/vetoes for a caller that only needs the number, such as the dashboard\'s review-queue tile. Same tenant scope and the same either-of gate (availability.manage_any or availability.read_any) as the list route, and the same status/personId filters, so the number always describes exactly the list the caller could have fetched. status=PENDING is the count awaiting a decision.',
        parameters: [
            { name: 'status', in: 'query', required: false, schema: { type: 'string', enum: ['PENDING', 'APPROVED', 'REJECTED'] }, description: 'Count only vetoes in this status. Omitted: every status.' },
            { name: 'personId', in: 'query', required: false, schema: { type: 'string' }, description: 'Count only vetoes about this Person. Omitted: everybody.' },
        ],
        responses: {
            200: {
                description: 'The number of matching vetoes in this tenant.',
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            required: ['total'],
                            properties: {
                                total: { type: 'integer', minimum: 0, description: 'Matching row count. Never capped: this is the whole filtered set, unlike the list route, which stops at 500 rows.' },
                            },
                        },
                    },
                },
            },
            403: { description: 'Caller lacks both availability.manage_any and availability.read_any.' },
        },
    },
});

export default defineEventHandler(async (event) => {
    const query = await getValidatedQuery(event, querySchema.parse);

    return withRequestTenant(event, async (tx, identity) => {
        await requireAnyPermission(event, tx, ['availability.manage_any', 'availability.read_any']);

        const total = await tx.personUnavailability.count({
            where: {
                tenantId: identity.tenantId,
                ...(query.status ? { status: query.status } : {}),
                ...(query.personId ? { personId: query.personId } : {}),
            },
        });

        return { total };
    });
});
