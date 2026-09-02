import { requireStaffIdentity } from '../../../utils/tenantDb';
import { getOwnerPrisma } from '../../../utils/ownerPrisma';

defineRouteMeta({
    openAPI: {
        tags: ['Staff'],
        summary: 'Calendry staff: list every Federation',
        description: 'Cross-tenant Federation list for Calendry staff (issue #64): the "no door to create one" gap TAXONOMY.md and this endpoint\'s sibling POST close together. Requires a staff session, never routed through withRequestTenant/RLS: `federation`\'s own RLS policy is read-only to a caller already IN that federation, which a staff request never is, so this reads through the OWNER connection instead, the same reasoning as GET /api/staff/tenants.',
        responses: {
            200: {
                description: 'Every Federation, newest first, with its member Tenant slugs.',
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            properties: {
                                rows: {
                                    type: 'array',
                                    items: {
                                        type: 'object',
                                        properties: {
                                            id: { type: 'string' },
                                            slug: { type: 'string' },
                                            name: { type: 'string' },
                                            createdAt: { type: 'string', format: 'date-time' },
                                            tenants: {
                                                type: 'array',
                                                items: { type: 'object', properties: { id: { type: 'string' }, slug: { type: 'string' }, name: { type: 'string' } } },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
            403: { description: 'No staff session.' },
        },
    },
});

export default defineEventHandler(async (event) => {
    requireStaffIdentity(event);

    const federations = await getOwnerPrisma().federation.findMany({
        orderBy: { createdAt: 'desc' },
        select: {
            id: true,
            slug: true,
            name: true,
            createdAt: true,
            tenants: { select: { id: true, slug: true, name: true }, orderBy: { slug: 'asc' } },
        },
    });

    return { rows: federations };
});
