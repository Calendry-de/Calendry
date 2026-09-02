import { deriveCapacity } from '../../../shared/groupCapacity';
import { requirePermission } from '../../utils/requirePermission';
import { withRequestTenant } from '../../utils/tenantDb';

/**
 * What this Offering's room-capacity requirement WOULD be if left unset.
 *
 * Exists because this bug was invisible: the schema and the form both promised
 * derivation from attached Groups, nothing derived, and the only symptom was a
 * 96-attendee Offering placed in a 24-seat room months later. The number is now
 * visible at the moment someone decides whether to leave the field blank.
 *
 * Read-only, and it does NOT tell the caller which value is in force: that is
 * `requiredCapacity` itself, which always wins when set. This answers only
 * "what would blank mean here".
 *
 * Calls the same `deriveCapacity` the solver input does, so the number shown and
 * the number enforced cannot drift.
 *
 * WHY THE PATH IS `/api/offering-capacity/:id` AND NOT `/api/offerings/:id/...`
 *
 * Because the RESTful path breaks every offerings route. `server/api/[resource]/`
 * is the generic CRUD catch-all, and creating a literal `server/api/offerings/`
 * directory makes Nitro match `offerings` as a static segment and stop
 * considering the dynamic branch, so `GET /api/offerings` began returning
 * "Page not found" while `/api/rooms` and `/api/groups` stayed 200. Measured,
 * not theorised: the whole Offerings management section 404s.
 *
 * Any future per-entity endpoint for a resource served by the generic scaffold
 * has the same constraint.
 */
export default defineEventHandler(async (event) => {
    const id = getRouterParam(event, 'id');

    return withRequestTenant(event, async (tx, identity) => {
        await requirePermission(event, tx, 'offering.read');

        const offering = await tx.offering.findFirst({
            where: { id, tenantId: identity.tenantId },
            select: { id: true, requiredCapacity: true, groups: { select: { groupId: true } } },
        });

        if (!offering) {
            throw createError({ statusCode: 404, statusMessage: 'Not found.' });
        }

        // Sequential: `tx` is one shared connection; concurrent queries on it
        // trip pg's deprecated overlapping-query warning.
        const groups = await tx.group.findMany({
            where: { tenantId: identity.tenantId },
            select: { id: true, parentGroupId: true, expectedSize: true },
        });
        const memberships = await tx.membership.findMany({
            where: { tenantId: identity.tenantId },
            select: { groupId: true, personId: true },
        });

        const derived = deriveCapacity(offering.groups.map((link) => link.groupId), groups, memberships);

        return {
            ...derived,
            attachedGroups: offering.groups.length,
            /** Whether the derived number is the one actually in force. */
            inEffect: offering.requiredCapacity === null,
        };
    });
});
