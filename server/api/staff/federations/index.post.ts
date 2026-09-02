import { z } from 'zod';
import { requireStaffIdentity } from '../../../utils/tenantDb';
import { getPrisma } from '../../../utils/prisma';
import { createFederationViaFunction } from '../../../utils/staffFederation';

const bodySchema = z.object({
    slug: z.string().min(1),
    name: z.string().min(1),
});

defineRouteMeta({
    openAPI: {
        tags: ['Staff'],
        summary: 'Calendry staff: create a Federation',
        description: 'The UI half of issue #64: the CLI (`bun run provision:federation`) already argued against a TENANT-facing route for this (consent-free cross-tenant visibility, CLAUDE.md exception 1); that argument does not apply to a STAFF-facing one, gated the same way tenant creation already is. Calls calendry_internal.staff_create_federation() (a SECURITY DEFINER function, same technique issue #105 used for tenant creation) through the ordinary runtime connection, no standing owner connection needed for this write. Idempotent by slug: an existing Federation is returned unchanged, never renamed.',
        requestBody: {
            required: true,
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        required: ['slug', 'name'],
                        properties: {
                            slug: { type: 'string' },
                            name: { type: 'string' },
                        },
                    },
                },
            },
        },
        responses: {
            200: { description: 'Federation created or, if the slug already existed, returned unchanged (alreadyExisted: true).' },
            403: { description: 'No staff session.' },
        },
    },
});

export default defineEventHandler(async (event) => {
    requireStaffIdentity(event);

    const body = await readValidatedBody(event, bodySchema.parse);

    const result = await createFederationViaFunction(getPrisma(), body);

    return result;
});
