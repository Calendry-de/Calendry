import { mapDbErrors } from '../../utils/dbErrors';
import { delegate, getResource } from '../../utils/resources';
import { crudPermission } from '../../utils/permissions';
import { requireAnyPermission } from '../../utils/requirePermission';
import { withRequestTenant } from '../../utils/tenantDb';

defineRouteMeta({
    openAPI: {
        tags: ['Resources'],
        summary: 'Delete one row by id',
        description: 'Generic delete route (permission <resource>.delete). System rows (isSystem) are refused. Entity-specific guards apply, e.g. a Person holding a login cannot be deleted before the login is deleted or reattached.',
        parameters: [
            { name: 'resource', in: 'path', required: true, schema: { type: 'string', enum: ['persons', 'roles', 'groups', 'rooms', 'equipment', 'offerings', 'offering-templates', 'offering-plans', 'time-grids', 'terms', 'constraints', 'session-kinds', 'calendar-periods', 'access-roles'] } },
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
            200: { description: 'Deleted.' },
            404: { description: 'Not found in this tenant.' },
            409: { description: 'Refused by an entity-specific guard; the message names the way forward.' },
        },
    },
});

/**
 * Delete one row by id, scoped to the caller's tenant.
 *
 * Deleting a Group that still has children is refused by the database
 * (parent_group_id is ON DELETE RESTRICT), which surfaces as 409. group_closure
 * rows are removed by FK cascade; this route never maintains the closure.
 */
export default defineEventHandler(async (event) => {
    const resource = getRouterParam(event, 'resource');
    const config = getResource(resource);
    const id = getRouterParam(event, 'id');

    return withRequestTenant(event, async (tx, identity) => {
        await requireAnyPermission(event, tx, crudPermission(resource as string, 'delete'));

        /**
         * Rows provisioning created and the tenant must not delete.
         *
         * Read BEFORE the delete, because after it there is nothing left to ask.
         * This was client-only until Step 14: `ManageEntityForm` hid the button
         * and the route honoured the request anyway, which for `access_role`
         * meant `tenant-admin` was one curl from gone.
         *
         * 409 rather than 403: the caller may well hold the delete permission.
         * What refuses this is the row, not the person.
         */
        if (config.systemFlag) {
            const row = await delegate(tx, config.model).findFirst({
                where: { id, tenantId: identity.tenantId },
                select: { id: true, [config.systemFlag]: true },
            }) as Record<string, unknown> | null;

            if (row?.[config.systemFlag]) {
                throw createError({
                    statusCode: 409,
                    message: 'This row was created by provisioning and cannot be deleted.',
                });
            }
        }

        const result = await mapDbErrors(async () => {
            /*
             * Entity-specific refusal, in this transaction, before the row goes.
             * The counterpart to `beforeCreate`/`beforeUpdate`, and distinct from
             * `afterWrite` below: a rule about what this row still REFERENCES
             * cannot be checked afterwards, because the cascades have already
             * run by then.
             */
            await config.beforeDelete?.({ tx, tenantId: identity.tenantId, id: id as string });

            const deleted = await delegate(tx, config.model).deleteMany({
                where: { id, tenantId: identity.tenantId },
            });

            // Invariants about what the tenant is LEFT with: see `afterWrite`.
            // Only when something was removed: a cross-tenant id deletes nothing
            // and must report 404.
            if (deleted.count > 0) {
                await config.afterWrite?.({ tx, tenantId: identity.tenantId, id: id as string, action: 'delete' });
            }

            return deleted;
        });

        if (result.count === 0) {
            throw createError({ statusCode: 404, message: 'Not found.' });
        }

        setResponseStatus(event, 204);

        return null;
    });
});
