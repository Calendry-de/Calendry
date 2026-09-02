/**
 * NOT UNDER `server/api/groups/`, and that is load-bearing rather than
 * cosmetic. Nitro matches a concrete directory ahead of a parameterised one, so
 * creating `server/api/groups/[id]/anything.ts` SHADOWS
 * `server/api/[resource]/[id]/[relation].ts` for the whole `/api/groups/*`
 * prefix, and every Group relation the generic route serves
 * (`groups/terms`, `groups/availability`, `groups/sources`) starts answering
 * 404 from the PAGE router, which reads as a missing page rather than a broken
 * API. Measured: putting these two files there broke group availability, a
 * feature neither of them touches.
 */
import { requireAnyPermission } from '../../../utils/requirePermission';
import { crudPermission } from '../../../utils/permissions';
import { withRequestTenant } from '../../../utils/tenantDb';
import { sourceDrift } from '../../../utils/groupSources';

/**
 * How far a combined Group's membership has drifted from its sources.
 *
 * COUNTS, NOT IDS. The page needs to say "2 would be added, 1 removed", and
 * shipping the person ids would make this a way to read a roll the caller may
 * not otherwise be able to see: `group.read` is not `person.read`.
 */
export default defineEventHandler(async (event) => {
    const id = getRouterParam(event, 'id');

    return withRequestTenant(event, async (tx, identity) => {
        await requireAnyPermission(event, tx, crudPermission('groups', 'read'));

        const drift = await sourceDrift(tx, identity.tenantId, id as string);

        return {
            sourceCount: drift.sourceCount,
            generatedAt: drift.generatedAt,
            memberCount: drift.current.length,
            expectedCount: drift.expected.length,
            added: drift.added.length,
            removed: drift.removed.length,
        };
    });
});
