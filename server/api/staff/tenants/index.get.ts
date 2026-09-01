import { requireStaffIdentity } from '../../../utils/tenantDb';
import { getOwnerPrisma } from '../../../utils/ownerPrisma';

defineRouteMeta({
    openAPI: {
        tags: ['Staff'],
        summary: 'Calendry staff: list every tenant',
        description: 'Cross-tenant tenant list for Calendry staff (issue #76). Requires a staff session (StaffIdentity) — never reachable by a tenant Account or API token, and never routed through withRequestTenant/RLS: a staff principal has no single tenant to scope a query to, so this reads through the OWNER database connection instead.',
        responses: {
            200: {
                description: 'Every tenant, newest first.',
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
                                            timezone: { type: 'string' },
                                            createdAt: { type: 'string', format: 'date-time' },
                                            federation: {
                                                type: 'object',
                                                nullable: true,
                                                properties: { id: { type: 'string' }, slug: { type: 'string' }, name: { type: 'string' } },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
            403: { description: 'No staff session (a tenant Account/token session is refused just as hard as no session at all).' },
        },
    },
});

/**
 * Lists every tenant across the whole install — the "tenant list / help
 * view" half of issue #76.
 *
 * `requireStaffIdentity` throws before this handler ever touches the
 * database if the caller is not `kind === 'staff'`, so a tenant-scoped
 * Account or API token gets the identical 403 a request with no session at
 * all would — this route simply does not exist for them.
 */
export default defineEventHandler(async (event) => {
    requireStaffIdentity(event);

    const tenants = await getOwnerPrisma().tenant.findMany({
        orderBy: { createdAt: 'desc' },
        select: {
            id: true,
            slug: true,
            name: true,
            timezone: true,
            createdAt: true,
            federation: { select: { id: true, slug: true, name: true } },
        },
    });

    return { rows: tenants };
});
