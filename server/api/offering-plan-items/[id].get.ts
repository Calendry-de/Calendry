import { requirePermission } from '../../utils/requirePermission';
import { withRequestTenant } from '../../utils/tenantDb';

/** The read side of `items.put.ts` — see that file for why this is bespoke. */
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
