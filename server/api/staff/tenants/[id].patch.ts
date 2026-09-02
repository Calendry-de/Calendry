import { z } from 'zod';
import { requireStaffIdentity } from '../../../utils/tenantDb';
import { getPrisma } from '../../../utils/prisma';
import { UnknownTenantIdError } from '../../../utils/staffCreateTenant';
import { UnknownFederationIdError, setTenantFederationViaFunction } from '../../../utils/staffFederation';

const bodySchema = z.object({
    // `null` detaches; the key must be PRESENT to change anything: omitting
    // it is refused rather than silently treated as "detach", the same
    // "guards must fail loudly" reasoning CLAUDE.md names for an ambiguous
    // absent-vs-null body.
    federationId: z.string().min(1).nullable(),
});

defineRouteMeta({
    openAPI: {
        tags: ['Staff'],
        summary: 'Calendry staff: attach or detach a Tenant\'s Federation',
        description: 'The "attach/detach member Tenants" half of issue #64\'s Federation UI, mirroring `provision:federation --attach-tenant`/`--detach-tenant`. Calls calendry_internal.staff_set_tenant_federation() (SECURITY DEFINER, same technique as tenant creation) through the ordinary runtime connection. federationId: null detaches.',
        parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'The Tenant id (not slug).' },
        ],
        requestBody: {
            required: true,
            content: {
                'application/json': {
                    schema: { type: 'object', required: ['federationId'], properties: { federationId: { type: 'string', nullable: true } } },
                },
            },
        },
        responses: {
            200: { description: 'Updated.' },
            403: { description: 'No staff session.' },
            404: { description: 'No such Tenant, or federationId names no Federation.' },
        },
    },
});

export default defineEventHandler(async (event) => {
    requireStaffIdentity(event);

    const tenantId = getRouterParam(event, 'id') as string;
    const body = await readValidatedBody(event, bodySchema.parse);

    try {
        const result = await setTenantFederationViaFunction(getPrisma(), { tenantId, federationId: body.federationId });

        return result;
    } catch (error) {
        if (error instanceof UnknownTenantIdError) {
            throw createError({ statusCode: 404, message: 'Tenant not found.', data: { field: 'id' } });
        }

        if (error instanceof UnknownFederationIdError) {
            throw createError({ statusCode: 404, message: 'Federation not found.', data: { field: 'federationId' } });
        }

        throw error;
    }
});
