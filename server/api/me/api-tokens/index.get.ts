import { withRequestTenant } from '../../../utils/tenantDb';

defineRouteMeta({
    openAPI: {
        tags: ['API tokens'],
        summary: 'List my API tokens',
        description: 'The tokens the signed-in Person has minted: name, ceiling permissions, expiry, and when each was last used. Never the secret or its hash: those do not exist after creation. Session only; a token cannot enumerate its siblings.',
        responses: {
            200: {
                description: 'Bare array of the callers tokens, newest first.',
                content: {
                    'application/json': {
                        schema: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    id: { type: 'string' },
                                    name: { type: 'string' },
                                    permissions: { type: 'array', items: { type: 'string' } },
                                    isActive: { type: 'boolean' },
                                    expiresAt: { type: 'string', format: 'date-time', nullable: true },
                                    lastUsedAt: { type: 'string', format: 'date-time', nullable: true, description: 'Throttled to minute precision.' },
                                    createdAt: { type: 'string', format: 'date-time' },
                                },
                            },
                        },
                    },
                },
            },
            403: { description: 'Caller is a token or device key, not a signed-in session.' },
        },
    },
});

/**
 * The caller's own tokens. Self-scoped like `/api/me/settings`: the WHERE is
 * the caller's own Person, so no permission key gates it: there is nothing
 * here anybody else owns.
 *
 * `tokenHash` is deliberately not selected, the same rule the screens routes
 * follow: the secret exists in exactly one response, ever.
 */
export default defineEventHandler(async (event) => withRequestTenant(event, async (tx, identity) => {
    if (identity.kind !== 'account') {
        throw createError({
            statusCode: 403,
            statusMessage: 'API tokens are managed with a signed-in session, not with a token or device key.',
        });
    }

    return tx.apiToken.findMany({
        where: { personId: identity.actorPersonId as string },
        orderBy: { createdAt: 'desc' },
        select: {
            id: true,
            name: true,
            permissions: true,
            isActive: true,
            expiresAt: true,
            lastUsedAt: true,
            createdAt: true,
        },
    });
}));
