import { requireStaffIdentity } from '../../../utils/tenantDb';
import { getOwnerPrisma } from '../../../utils/ownerPrisma';

defineRouteMeta({
    openAPI: {
        tags: ['Staff'],
        summary: 'Calendry staff: list every tenant',
        description: 'Cross-tenant tenant list for Calendry staff (issue #76). Requires a staff session (StaffIdentity): never reachable by a tenant Account or API token, and never routed through withRequestTenant/RLS. A staff principal has no single tenant to scope a query to, so this reads through the OWNER database connection instead.',
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
                                            defaultLocale: { type: 'string', nullable: true, description: 'TenantDisplaySettings.defaultLocale, or null when the tenant has no default (an absent settings row reads the same as a null column).' },
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
 * Lists every tenant across the whole install: the "tenant list / help
 * view" half of issue #76.
 *
 * `requireStaffIdentity` throws before this handler ever touches the
 * database if the caller is not `kind === 'staff'`, so a tenant-scoped
 * Account or API token gets the identical 403 a request with no session at
 * all would; this route simply does not exist for them.
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
            /*
             * So the panel can SHOW the current default locale beside the
             * control that changes it (`PATCH /api/staff/tenants/:id/locale`).
             * A staff editor that could only write a value it cannot read is
             * the "no data and fetch failed render identically" trap one step
             * removed: an operator would not be able to tell "no default set"
             * from "the field just does not display it".
             */
            displaySettings: { select: { defaultLocale: true } },
            federation: { select: { id: true, slug: true, name: true } },
        },
    });

    /*
     * FLATTENED to a nullable `defaultLocale`, never exposed as the settings
     * relation: an ABSENT singleton and a row whose column is NULL both mean
     * "no tenant default, defer to Accept-Language" (the column's own schema
     * comment, and `resolveLocale()`'s contract), so a shape that let a
     * caller distinguish them would be inviting it to act on a difference
     * that does not exist.
     */
    return {
        rows: tenants.map(({ displaySettings, ...tenant }) => ({
            ...tenant,
            defaultLocale: displaySettings?.defaultLocale ?? null,
        })),
    };
});
