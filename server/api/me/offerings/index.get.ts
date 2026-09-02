import { requirePermission } from '../../../utils/requirePermission';
import { withRequestTenant } from '../../../utils/tenantDb';

/**
 * The modules the caller LEADS, across every term: a convenience for the
 * scheduling-pattern picker, never a boundary.
 *
 * Filtered on `OfferingLecturer`, unlike `/api/offerings` (which needs
 * `offering.read` and returns every Offering in the tenant): a lecturer with
 * only `offering.set_scheduling_pattern` may hold neither `offering.read`
 * nor any directory permission, and this route is the one place their "my
 * own" list can come from without asking for one.
 *
 * The write endpoint (`PUT .../scheduling-pattern`) re-checks lecturer
 * status itself via `assertLecturesOffering`, so a stale or hand-crafted id
 * here changes nothing about what can actually be set.
 */
export default defineEventHandler(async (event) => withRequestTenant(event, async (tx, identity) => {
    await requirePermission(event, tx, 'offering.set_scheduling_pattern');

    if (!identity.actorPersonId) {
        return { rows: [] };
    }

    const rows = await tx.offering.findMany({
        where: {
            tenantId: identity.tenantId,
            lecturers: { some: { personId: identity.actorPersonId } },
        },
        select: {
            id: true,
            title: true,
            code: true,
            schedulingPattern: true,
            term: { select: { id: true, name: true } },
        },
        orderBy: { title: 'asc' },
    });

    return { rows };
}));
