import { requirePermission } from '../../utils/requirePermission';
import { withRequestTenant } from '../../utils/tenantDb';
import { deriveGroupPlanApplications } from '../../utils/offeringPlans';

defineRouteMeta({
    openAPI: {
        tags: ['Curriculum plans'],
        summary: 'Every Group\'s current curriculum-plan phase, tenant-wide',
        description: 'The bulk form of GET /api/group-plan-applications/:id — issue #100\'s "how do we know which phase a group is in" answer, still fully derived (never stored) from Offering.createdFromTemplateId. A Group absent from `rows` simply has no Offering seeded from any plan template yet, the same as the per-Group route answering an empty array.',
        responses: {
            200: { description: 'One row per Group that has at least one derived application.' },
            403: { description: 'Caller lacks offering_plan.apply.' },
        },
    },
});

/**
 * Tenant-wide version of `GET /api/group-plan-applications/:id` — every
 * Group's current plan(s) and advance target(s) in one call, for the
 * "curriculum progression" settings page rather than one Group's own detail
 * panel. Groups with nothing derived are simply absent, not listed with an
 * empty array — there is nothing to show a settings page for a Group that
 * has never had a plan applied at all.
 */
export default defineEventHandler(async (event) => withRequestTenant(event, async (tx, identity) => {
    await requirePermission(event, tx, 'offering_plan.apply');

    const applications = await deriveGroupPlanApplications(tx, identity.tenantId);

    if (applications.size === 0) {
        return { rows: [] };
    }

    const groups = await tx.group.findMany({
        where: { id: { in: [...applications.keys()] }, tenantId: identity.tenantId },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
    });

    const rows = groups.map((group) => ({
        groupId: group.id,
        groupName: group.name,
        applications: applications.get(group.id) ?? [],
    }));

    return { rows };
}));
