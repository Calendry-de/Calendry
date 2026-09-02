import { z } from 'zod';
import { mapDbErrors } from '../../utils/dbErrors';
import { requirePermission } from '../../utils/requirePermission';
import { withRequestTenant } from '../../utils/tenantDb';

const bodySchema = z.array(z.object({ templateId: z.string().min(1) })).max(200);

defineRouteMeta({
    openAPI: {
        tags: ['Curriculum plans'],
        summary: 'Replace a curriculum plan\'s item list',
        description: 'Replaces the plan\'s WHOLE item list, in the order given (max 200). Not the generic relation route, because a plan\'s items are an ORDERED SEQUENCE and that mechanism replaces an unordered set. Idempotent: re-sending the same order changes nothing. Requires offering_plan.update, the same permission that edits the plan itself.',
        parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Curriculum plan id.' },
        ],
        requestBody: {
            required: true,
            content: {
                'application/json': {
                    schema: { type: 'array', maxItems: 200, items: { type: 'object', required: ['templateId'], properties: { templateId: { type: 'string' } } } },
                },
            },
        },
        responses: {
            200: {
                description: 'The plan\'s items after the replace, in position order.',
                content: { 'application/json': { schema: { type: 'array', items: { type: 'object', properties: { templateId: { type: 'string' } } } } } },
            },
            403: { description: 'Caller lacks offering_plan.update.' },
            404: { description: 'Plan not found, or one or more templateIds not found in this tenant.' },
        },
    },
});

/**
 * Replaces a plan's WHOLE item list, in the order given.
 *
 * NOT the generic `[relation].put.ts`: that mechanism replaces a SET (order
 * is not part of what it writes), and a plan's items are a SEQUENCE:
 * `position` is read back at apply time and in the editor, so array order
 * has to survive the round trip. Simplest way to keep a write idempotent AND
 * ordered is to store the order it's given rather than accept per-item
 * moves.
 *
 * `offering_plan.update`, not a plan-specific key: editing a plan's item
 * list IS editing the plan, the same reasoning `[relation].put.ts` defaults
 * to for every other parent/child pair that doesn't carve out its own
 * `writePermission`.
 */
export default defineEventHandler(async (event) => {
    const planId = getRouterParam(event, 'id');
    const body = await readValidatedBody(event, bodySchema.parse);

    return withRequestTenant(event, async (tx, identity) => {
        await requirePermission(event, tx, 'offering_plan.update');

        const plan = await tx.offeringPlan.findFirst({
            where: { id: planId, tenantId: identity.tenantId },
            select: { id: true },
        });

        if (!plan) {
            throw createError({ statusCode: 404, message: 'Not found.' });
        }

        const templateIds = [...new Set(body.map((item) => item.templateId))];

        const templates = await tx.offeringTemplate.findMany({
            where: { id: { in: templateIds }, tenantId: identity.tenantId },
            select: { id: true },
        });

        if (templates.length !== templateIds.length) {
            throw createError({
                statusCode: 404,
                message: 'One or more templates were not found in this tenant.',
            });
        }

        return mapDbErrors(async () => {
            await tx.offeringPlanItem.deleteMany({ where: { planId, tenantId: identity.tenantId } });

            if (templateIds.length) {
                await tx.offeringPlanItem.createMany({
                    data: templateIds.map((templateId, position) => ({
                        tenantId: identity.tenantId,
                        planId: plan.id,
                        templateId,
                        position,
                    })),
                });
            }

            return tx.offeringPlanItem.findMany({
                where: { planId, tenantId: identity.tenantId },
                orderBy: { position: 'asc' },
                select: { templateId: true },
            });
        });
    });
});
