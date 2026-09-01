import { holdsPermission, requireAnyPermission } from '../../../utils/requirePermission';
import { withRequestTenant } from '../../../utils/tenantDb';

defineRouteMeta({
    openAPI: {
        tags: ['Calendar links'],
        summary: 'Reference data for the "calendar links" self-service form',
        description: 'Every Term (to fill scope=TERM\'s picker) plus, only for a caller holding ics_link.generate, every Group (to fill the group-target picker) — everything /my/calendar-links needs, scoped to ics_link.generate_own/ics_link.generate alone. Same reasoning as GET /api/me/exam-requests/context (issue #108): the page must not need term.read or group.read just to mint a link over its own or an explicitly-permitted subject.',
        responses: {
            200: { description: 'The reference data described above, plus canTargetGroups.' },
            403: { description: 'Caller holds neither ics_link key.' },
        },
    },
});

/**
 * Reference data `/my/calendar-links` needs, scoped to `ics_link.generate_own`
 * or `ics_link.generate` alone — never `term.read`/`group.read`.
 *
 * `canTargetGroups` names the capability explicitly rather than letting the
 * client infer it from `groups` being non-empty: a tenant with zero Groups
 * would otherwise make a `ics_link.generate` holder look like they cannot
 * target one, which is a different fact from "not permitted to".
 */
export default defineEventHandler(async (event) => withRequestTenant(event, async (tx, identity) => {
    await requireAnyPermission(event, tx, ['ics_link.generate', 'ics_link.generate_own']);

    const canTargetGroups = await holdsPermission(event, tx, 'ics_link.generate');

    const [terms, groups] = await Promise.all([
        tx.term.findMany({
            where: { tenantId: identity.tenantId },
            select: { id: true, name: true },
            orderBy: { startDate: 'asc' },
        }),
        canTargetGroups
            ? tx.group.findMany({
                where: { tenantId: identity.tenantId },
                select: { id: true, name: true },
                orderBy: { name: 'asc' },
            })
            : Promise.resolve([]),
    ]);

    return { terms, groups, canTargetGroups };
}));
