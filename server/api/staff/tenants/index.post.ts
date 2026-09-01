import { z } from 'zod';
import { requireStaffIdentity } from '../../../utils/tenantDb';
import { UnknownFederationError } from '../../../utils/provisionTenant';
import { provisionTenantViaFunction, rawPostgresErrorCode } from '../../../utils/staffCreateTenant';

const bodySchema = z.object({
    slug: z.string().min(1),
    name: z.string().min(1),
    adminEmail: z.string().email(),
    adminName: z.string().min(1),
    federationSlug: z.string().min(1).optional(),
    timezone: z.string().min(1).optional(),
});

defineRouteMeta({
    openAPI: {
        tags: ['Staff'],
        summary: 'Calendry staff: create a tenant',
        description: 'Creates the same tenant shape `bun run provision:tenant` does (server/utils/provisionTenant.ts, issue #76), via a separate SQL-side implementation kept in agreement by hand: `calendry_internal.staff_create_tenant()`, a SECURITY DEFINER function callable through the ordinary runtime role (issue #105). Requires a staff session. Unlike the CLI, this route holds no standing database-owner connection — the function itself is the only place any of this runs with elevated privilege, the same technique `session_identity()`/`screen_identity()` use for the pre-tenant auth plane.',
        requestBody: {
            required: true,
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        required: ['slug', 'name', 'adminEmail', 'adminName'],
                        properties: {
                            slug: { type: 'string' },
                            name: { type: 'string' },
                            adminEmail: { type: 'string', format: 'email' },
                            adminName: { type: 'string' },
                            federationSlug: { type: 'string', description: 'Must already exist — this never creates a Federation.' },
                            timezone: { type: 'string', description: 'Defaults to UTC.' },
                        },
                    },
                },
            },
        },
        responses: {
            200: { description: 'Tenant created. `initialPassword` is null when an existing Account was reused across tenants.' },
            400: { description: 'federationSlug names no existing Federation.' },
            403: { description: 'No staff session.' },
            409: { description: 'A tenant with this slug already exists. Creates, never updates.' },
        },
    },
});

/**
 * Creates a tenant from the staff UI — the "tenant creation from the UI"
 * half of issue #76, wrapping/superseding `provision:tenant` for this one
 * action (support-code redemption, the "staff assumes a tenant role" flow,
 * is explicitly a SEPARATE, dependent card — not built here).
 *
 * Calls `calendry_internal.staff_create_tenant()` (issue #105) through the
 * ORDINARY runtime connection (`provisionTenantViaFunction`,
 * `server/utils/staffCreateTenant.ts`) — never `getOwnerPrisma()`, which this
 * route no longer imports, and never `withRequestTenant()`, which cannot
 * apply here: there is no tenant yet to open an RLS context for, and the
 * caller (`requireStaffIdentity`) has none either. The SECURITY DEFINER
 * function is the one place any of this runs with elevated privilege; see
 * its migration's header for why that is narrower than a standing owner
 * connection.
 */
export default defineEventHandler(async (event) => {
    requireStaffIdentity(event);

    const body = await readValidatedBody(event, bodySchema.parse);

    try {
        const result = await provisionTenantViaFunction(body);

        return result;
    } catch (error) {
        if (error instanceof UnknownFederationError) {
            throw createError({ statusCode: 400, statusMessage: error.message });
        }

        // A tenant with this slug already exists — creates, never updates.
        // `rawPostgresErrorCode()` reads the SQLSTATE the function's INSERT
        // raised (23505, unique_violation) back out of the raw-query error —
        // see that helper's own comment for why `error.code` alone (Prisma's
        // own P2010 "raw query failed") is not specific enough here, unlike
        // the ordinary `Prisma.PrismaClientKnownRequestError` + 'P2002' check
        // this replaced, which only applied to Prisma-generated queries.
        if (rawPostgresErrorCode(error) === '23505') {
            throw createError({
                statusCode: 409,
                statusMessage: `A tenant with slug '${body.slug}' already exists.`,
            });
        }

        throw error;
    }
});
