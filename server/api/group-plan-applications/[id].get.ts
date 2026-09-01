import { requirePermission } from '../../utils/requirePermission';
import { withRequestTenant } from '../../utils/tenantDb';
import { deriveGroupPlanApplications } from '../../utils/offeringPlans';

/**
 * Every curriculum plan this Group already has offerings from, with the
 * "advance" target for each — the ONE query that answers both "what does
 * this Group already have" (so applying again isn't a mystery) and "what's
 * next" (so moving it forward needs no picker). A separate top-level
 * resource rather than `groups/[id]/...`, the same reason
 * `offering-plan-items` sits beside `offering-plans` instead of under it —
 * see that file's own comment on the routing shadow this avoids.
 *
 * The actual derivation lives in `deriveGroupPlanApplications()`
 * (`server/utils/offeringPlans.ts`), shared with the tenant-wide list
 * (`GET /api/group-plan-applications`) and the bulk advance action
 * (`POST .../advance-all`) so the three cannot disagree about what "this
 * Group's current phase" means.
 */
export default defineEventHandler(async (event) => {
    const groupId = getRouterParam(event, 'id');

    return withRequestTenant(event, async (tx, identity) => {
        await requirePermission(event, tx, 'offering_plan.apply');

        const group = await tx.group.findFirst({
            where: { id: groupId, tenantId: identity.tenantId },
            select: { id: true },
        });

        if (!group) {
            throw createError({ statusCode: 404, statusMessage: 'Not found.' });
        }

        const applications = await deriveGroupPlanApplications(tx, identity.tenantId, [groupId as string]);

        return applications.get(groupId as string) ?? [];
    });
});
