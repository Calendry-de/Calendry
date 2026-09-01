import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { requireStaffIdentity } from '../../../utils/tenantDb';
import { getOwnerPrisma } from '../../../utils/ownerPrisma';
import { UnknownFederationError, provisionTenantCore } from '../../../utils/provisionTenant';

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
        description: 'Wraps the exact core transaction `bun run provision:tenant` uses (server/utils/provisionTenant.ts, issue #76) so this UI and the CLI cannot describe two different "what a new tenant looks like"s. Requires a staff session; runs through the OWNER database connection, the only one the RLS write policy on `tenant` permits to insert a row that does not exist yet.',
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
 * Calls the SAME `provisionTenantCore` the CLI calls, inside a transaction on
 * the OWNER connection (`getOwnerPrisma()`) — never `withRequestTenant()`,
 * which cannot apply here: there is no tenant yet to open an RLS context for,
 * and the caller (`requireStaffIdentity`) has none either.
 */
export default defineEventHandler(async (event) => {
    requireStaffIdentity(event);

    const body = await readValidatedBody(event, bodySchema.parse);

    try {
        const result = await getOwnerPrisma().$transaction((tx) => provisionTenantCore(tx, body));

        return result;
    } catch (error) {
        if (error instanceof UnknownFederationError) {
            throw createError({ statusCode: 400, statusMessage: error.message });
        }

        // A tenant with this slug already exists — creates, never updates.
        // Matches the CLI's own message-substring check for the identical
        // Prisma error, but keyed on the error code here since a fresh HTTP
        // caller has no console to read prose from.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            throw createError({
                statusCode: 409,
                statusMessage: `A tenant with slug '${body.slug}' already exists.`,
            });
        }

        throw error;
    }
});
