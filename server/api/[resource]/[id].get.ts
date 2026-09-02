import { mapDbErrors } from '../../utils/dbErrors';
import { delegate, getResource } from '../../utils/resources';
import { crudPermission } from '../../utils/permissions';
import { requireAnyPermission } from '../../utils/requirePermission';
import { withRequestTenant } from '../../utils/tenantDb';

defineRouteMeta({
    openAPI: {
        tags: ['Resources'],
        summary: 'Fetch one row by id',
        description: 'Generic read route (permission <resource>.read). A guessed id from another tenant reads as 404, never as a permission error that would confirm the row exists. Federation-ownable resources also resolve rows shared into the federation.',
        parameters: [
            { name: 'resource', in: 'path', required: true, schema: { type: 'string', enum: ['persons', 'roles', 'groups', 'rooms', 'equipment', 'offerings', 'offering-templates', 'offering-plans', 'time-grids', 'terms', 'constraints', 'session-kinds', 'calendar-periods', 'access-roles'] } },
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
            200: { description: 'The row.' },
            404: { description: 'Not found in this tenant (or federation, where applicable).' },
        },
    },
});

/** Fetch one row by id, scoped to the caller's tenant. */
export default defineEventHandler(async (event) => {
    const resource = getRouterParam(event, 'resource');
    const config = getResource(resource);
    const id = getRouterParam(event, 'id');

    return withRequestTenant(event, async (tx, identity) => {
        await requireAnyPermission(event, tx, crudPermission(resource as string, 'read'));

        // findFirst with an explicit tenant predicate rather than findUnique by
        // id: a guessed id from another tenant must read as "not found", not as
        // a permission error that confirms the row exists.
        const where: Record<string, unknown> = { id };

        if (config.federationOwnable) {
            where.OR = [
                { tenantId: identity.tenantId },
                ...(identity.federationId ? [{ federationId: identity.federationId }] : []),
            ];
        } else {
            where.tenantId = identity.tenantId;
        }

        const row = await mapDbErrors(() => delegate(tx, config.model).findFirst({ where, include: config.include }));

        if (!row) {
            throw createError({ statusCode: 404, message: 'Not found.' });
        }

        return row;
    });
});
