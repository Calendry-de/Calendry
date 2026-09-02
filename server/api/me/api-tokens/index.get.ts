import { requirePermission } from '../../../utils/requirePermission';
import { withRequestTenant } from '../../../utils/tenantDb';

defineRouteMeta({
    openAPI: {
        tags: ['API tokens'],
        summary: 'List my API tokens',
        description: 'The tokens the signed-in Person has minted: name, ceiling permissions, expiry, and when each was last used. Never the secret or its hash: those do not exist after creation. Needs `api_token.manage_own`. Session only; a token cannot enumerate its siblings.',
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
            403: { description: 'Caller is a token or device key rather than a signed-in session, or does not hold `api_token.manage_own`.' },
        },
    },
});

/**
 * The caller's own tokens. Self-scoped structurally, the way every `/api/me/*`
 * route is: the WHERE is the caller's own Person, and this route takes no
 * person id to widen it with.
 *
 * `api_token.manage_own` NONETHELESS, since minting one is now gateable: a
 * Person who may not manage their tokens must not be shown the list either,
 * or `/my/api-tokens` would render a table above a Create button that 403s.
 * `_own` names the structural scope, it does not soften the gate.
 *
 * THE SESSION CHECK COMES FIRST, before the permission, and the order is
 * load-bearing: `heldPermissions()` intersects a token's ceiling with its
 * Person's live permissions, so a ceiling containing `api_token.manage_own`
 * would otherwise let a token enumerate its siblings. Refusing on
 * `kind` first keeps "tokens are managed by a session only" a property of
 * the route rather than of what somebody checked in the minting form.
 *
 * `tokenHash` is deliberately not selected, the same rule the screens routes
 * follow: the secret exists in exactly one response, ever.
 */
export default defineEventHandler(async (event) => withRequestTenant(event, async (tx, identity) => {
    if (identity.kind !== 'account') {
        throw createError({
            statusCode: 403,
            message: 'API tokens are managed with a signed-in session, not with a token or device key.',
        });
    }

    await requirePermission(event, tx, 'api_token.manage_own');

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
