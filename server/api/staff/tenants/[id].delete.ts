import { z } from 'zod';
import { requireStaffIdentity } from '../../../utils/tenantDb';
import { getPrisma } from '../../../utils/prisma';
import { getOwnerPrisma } from '../../../utils/ownerPrisma';
import { UnknownTenantIdError } from '../../../utils/staffCreateTenant';
import { eraseTenantViaFunction } from '../../../utils/staffEraseTenant';
import { writeAuditLog } from '../../../utils/auditLog';

const bodySchema = z.object({
    /**
     * The tenant's own slug, typed back by the operator — the confirmation
     * gate for an operation with no undo. Checked against the REAL slug
     * (read via the owner connection, the same plain cross-tenant read
     * `GET /api/staff/tenants` already performs) before anything is deleted,
     * never against a value the client merely echoes back to itself.
     */
    confirmSlug: z.string().min(1),
});

defineRouteMeta({
    openAPI: {
        tags: ['Staff'],
        summary: 'Calendry staff: erase a tenant and everything it owns',
        description: 'Issue #84\'s GDPR erasure tool — IMMEDIATE, IRREVERSIBLE hard delete of a departing institution\'s entire dataset via calendry_internal.staff_erase_tenant() (SECURITY DEFINER, same technique as tenant creation). Staff-only: tenant lifecycle has never had a tenant-side permission (see shared/permissions.ts\'s tenant.read/tenant.update comment — "nobody creates or deletes one from inside it"), so this stays alongside tenant creation rather than becoming tenant self-service. Requires the caller to name the tenant\'s own slug in the body as confirmation; a mismatch deletes nothing.',
        parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'The Tenant id (not slug).' },
        ],
        requestBody: {
            required: true,
            content: {
                'application/json': {
                    schema: { type: 'object', required: ['confirmSlug'], properties: { confirmSlug: { type: 'string' } } },
                },
            },
        },
        responses: {
            200: { description: 'Erased. Reports how many People and now-ownerless Accounts were removed.' },
            403: { description: 'No staff session.' },
            404: { description: 'No such Tenant.' },
            409: { description: 'confirmSlug did not match the tenant\'s actual slug.' },
        },
    },
});

export default defineEventHandler(async (event) => {
    const identity = requireStaffIdentity(event);

    const tenantId = getRouterParam(event, 'id') as string;
    const body = await readValidatedBody(event, bodySchema.parse);

    const tenant = await getOwnerPrisma().tenant.findUnique({ where: { id: tenantId }, select: { id: true, slug: true } });

    if (!tenant) {
        throw createError({ statusCode: 404, statusMessage: 'Tenant not found.', data: { field: 'id' } });
    }

    if (body.confirmSlug !== tenant.slug) {
        throw createError({
            statusCode: 409,
            statusMessage: `Confirmation did not match — type '${tenant.slug}' exactly to erase this institution.`,
            data: { field: 'confirmSlug' },
        });
    }

    try {
        const result = await eraseTenantViaFunction(getPrisma(), tenantId);

        const staffAccount = await getPrisma().staffAccount.findUnique({
            where: { id: identity.staffAccountId },
            select: { email: true },
        });

        // Written AFTER the erase, on the ordinary connection: the function
        // itself already purged this tenant's OWN audit_log rows (see the
        // migration header), so this is a fresh row recording that the
        // erasure happened — the one durable proof of it, since nothing
        // else about this tenant survives to ask.
        await writeAuditLog({
            action: 'tenant.erased',
            outcome: 'SUCCESS',
            actorAccountId: identity.staffAccountId,
            actorLabel: staffAccount?.email ?? identity.staffAccountId,
            tenantId: result.tenant.id,
            target: result.tenant.slug,
            detail: { via: 'api:staff', personCount: result.personCount, accountsErased: result.accountsErased },
        });

        return result;
    } catch (error) {
        if (error instanceof UnknownTenantIdError) {
            throw createError({ statusCode: 404, statusMessage: 'Tenant not found.', data: { field: 'id' } });
        }

        throw error;
    }
});
