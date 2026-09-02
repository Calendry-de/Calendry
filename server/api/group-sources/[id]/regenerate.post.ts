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
import { mapDbErrors } from '../../../utils/dbErrors';
import { requireAnyPermission } from '../../../utils/requirePermission';
import { crudPermission } from '../../../utils/permissions';
import { withRequestTenant } from '../../../utils/tenantDb';
import { sourceDrift } from '../../../utils/groupSources';

/**
 * Copy the sources' members into a combined Group.
 *
 * AN EXPLICIT VERB, and the whole feature is that it has to be asked for. A
 * derived membership would always be right and would move a timetable's
 * attendee set between two solves with nothing recording that it moved; this
 * makes the moment a decision somebody took.
 *
 * REPLACES RATHER THAN MERGES. "Regenerate" means the group becomes what its
 * sources say, so a student who left a source leaves the group. Merging would
 * make removal impossible through this route and leave the count creeping
 * upward forever, which is the same staleness one level less visible.
 *
 * REFUSED WITH NO SOURCES. An empty source list would otherwise EMPTY the
 * group, which is a destructive answer to a request that reads as harmless,
 * and it is indistinguishable from "the sources are all empty", which is a
 * legitimate state this route should carry out.
 */
export default defineEventHandler(async (event) => {
    const id = getRouterParam(event, 'id');

    return withRequestTenant(event, async (tx, identity) => {
        await requireAnyPermission(event, tx, crudPermission('groups', 'update'));

        const drift = await sourceDrift(tx, identity.tenantId, id as string);

        if (drift.sourceCount === 0) {
            throw createError({
                statusCode: 422,
                statusMessage: 'This group draws from no other groups, so there is nothing to '
                    + 'copy. Regenerating would empty it. Name at least one source group first.',
                data: { field: 'sources' },
            });
        }

        await mapDbErrors(async () => {
            await tx.membership.deleteMany({ where: { tenantId: identity.tenantId, groupId: id as string } });

            if (drift.expected.length) {
                await tx.membership.createMany({
                    data: drift.expected.map((personId) => ({
                        tenantId: identity.tenantId,
                        groupId: id as string,
                        personId,
                    })),
                });
            }

            await tx.group.update({
                where: { id: id as string },
                data: { membersGeneratedAt: new Date() },
            });
        });

        return {
            memberCount: drift.expected.length,
            added: drift.added.length,
            removed: drift.removed.length,
        };
    });
});
