import { mapDbErrors } from '../../../utils/dbErrors';
import { getRelation, relationDelegate } from '../../../utils/relations';
import { crudPermission } from '../../../utils/permissions';
import { requireAnyPermission } from '../../../utils/requirePermission';
import { withRequestTenant } from '../../../utils/tenantDb';

defineRouteMeta({
    openAPI: {
        tags: ['Resources'],
        summary: 'Read a relation membership set',
        description: 'The current membership set of one relation, e.g. the Groups an Offering is for. Requires the PARENT resource read permission. Valid pairs: time-grids/breaks, groups/terms, groups/sources, groups/availability, offerings/groups, offerings/lecturers, offerings/equipment, rooms/equipment, persons/roles, persons/access-roles, persons/groups, constraints/scopes.',
        parameters: [
            { name: 'resource', in: 'path', required: true, schema: { type: 'string', enum: ['persons', 'roles', 'groups', 'rooms', 'equipment', 'offerings', 'time-grids', 'terms', 'constraints', 'session-kinds', 'calendar-periods', 'access-roles'] } },
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'relation', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
            200: { description: 'Bare array of link rows.', content: { 'application/json': { schema: { type: 'array', items: { type: 'object' } } } } },
            404: { description: 'Unknown resource/relation pair.' },
        },
    },
});

/** The current membership set of one relation, e.g. an Offering's Groups. */
export default defineEventHandler(async (event) => {
    const resource = getRouterParam(event, 'resource');
    const id = getRouterParam(event, 'id');
    const relation = getRouterParam(event, 'relation');
    const config = getRelation(resource, relation);

    return withRequestTenant(event, async (tx, identity) => {
        // Reading a relation is reading the parent. Nothing here needs authority
        // the parent's own list page does not already require.
        await requireAnyPermission(event, tx, crudPermission(config.parent, 'read'));

        return mapDbErrors(() => relationDelegate(tx, config.model).findMany({
            where: {
                [config.parentKey]: id,
                // Redundant with RLS, kept for the same defence-in-depth reason
                // as the list route. Skipped where the column is nullable,
                // because a federation-owned parent's rows carry a NULL tenant
                // and filtering on it would hide them.
                ...(config.tenantColumnNullable ? {} : { tenantId: identity.tenantId }),
            },
            select: config.select,
        }));
    });
});
