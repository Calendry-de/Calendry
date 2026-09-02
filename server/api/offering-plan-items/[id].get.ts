import { requirePermission } from '../../utils/requirePermission';
import { withRequestTenant } from '../../utils/tenantDb';

defineRouteMeta({
    openAPI: {
        tags: ['Curriculum plans'],
        summary: 'A curriculum plan\'s item list, in order',
        description: 'The read side of PUT /api/offering-plan-items/:id, bespoke rather than the generic relation route because a plan\'s items are an ORDERED SEQUENCE, not a set.',
        parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Curriculum plan id.' },
        ],
        responses: {
            200: {
                description: 'The plan\'s items, in position order.',
                content: { 'application/json': { schema: { type: 'array', items: { type: 'object', properties: { templateId: { type: 'string' } } } } } },
            },
            403: { description: 'Caller lacks offering_plan.read.' },
            404: { description: 'Plan not found in this tenant.' },
        },
    },
});

/** The read side of `items.put.ts`; see that file for why this is bespoke. */
export default defineEventHandler(async (event) => {
    const planId = getRouterParam(event, 'id');

    return withRequestTenant(event, async (tx, identity) => {
        await requirePermission(event, tx, 'offering_plan.read');

        const plan = await tx.offeringPlan.findFirst({
            where: { id: planId, tenantId: identity.tenantId },
            select: { id: true },
        });

        if (!plan) {
            throw createError({ statusCode: 404, statusMessage: 'Not found.' });
        }

        const items = await tx.offeringPlanItem.findMany({
            where: { planId, tenantId: identity.tenantId },
            orderBy: { position: 'asc' },
            select: { templateId: true },
        });

        return items;
    });
});
