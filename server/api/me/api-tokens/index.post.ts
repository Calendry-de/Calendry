import { z } from 'zod';
import { generateSessionToken, hashToken } from '../../../utils/auth';
import { isPermissionKey } from '../../../../shared/permissions';
import { mapDbErrors } from '../../../utils/dbErrors';
import { loadPermissions, requirePermission } from '../../../utils/requirePermission';
import { withRequestTenant } from '../../../utils/tenantDb';

defineRouteMeta({
    openAPI: {
        tags: ['API tokens'],
        summary: 'Create an API token',
        description: 'Mints a token that acts as the caller, restricted to a selected subset of the permissions they hold RIGHT NOW. Needs `api_token.manage_own`: an institution decides who may automate. The effective set stays an intersection with their live permissions on every later request, so losing an AccessRole also narrows every token derived from it. The secret is returned ONCE and only its SHA-256 is stored. Use it as an Authorization: Bearer header. A token cannot call this route: tokens are managed with a session only.',
        requestBody: {
            required: true,
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        required: ['name', 'permissions'],
                        properties: {
                            name: { type: 'string', description: 'What a human calls it when revoking the right one.' },
                            permissions: { type: 'array', items: { type: 'string' }, minItems: 1, description: 'Permission keys from the fixed catalogue; every one must be held by the caller.' },
                            expiresAt: { type: 'string', format: 'date-time', nullable: true, description: 'Optional expiry; null or absent means the token does not expire.' },
                        },
                    },
                },
            },
        },
        responses: {
            201: {
                description: 'Created. The token field is shown once and never recoverable.',
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            properties: {
                                id: { type: 'string' },
                                name: { type: 'string' },
                                permissions: { type: 'array', items: { type: 'string' } },
                                expiresAt: { type: 'string', format: 'date-time', nullable: true },
                                createdAt: { type: 'string', format: 'date-time' },
                                token: { type: 'string', description: 'The bearer secret. Shown once, never stored.' },
                            },
                        },
                    },
                },
            },
            400: { description: 'Unknown permission key, or an expiry in the past.' },
            403: { description: 'Caller is not a signed-in session, does not hold `api_token.manage_own`, or requested a permission they do not hold.' },
        },
    },
});

const BODY = z.object({
    name: z.string().trim().min(1).max(200),
    permissions: z.array(z.string().min(1)).min(1).max(200),
    /*
     * `.nullish()`, matching the codebase convention for form-fed fields:
     * null and absent both mean "does not expire".
     */
    expiresAt: z.coerce.date().nullish(),
});

/**
 * Mint an API token: a bearer credential for scripts (imports, integrations).
 *
 * THREE ENFORCEMENTS, in this order, and the order is the design:
 *
 * 1. SESSION ONLY: a token must not mint tokens. Otherwise a leaked
 *    short-lived token launders itself into a permanent one, and revoking the
 *    original revokes nothing. `kind === 'account'` is that check, and it runs
 *    FIRST, before any permission is loaded. That is what keeps it true
 *    regardless of what a ceiling happens to contain: `heldPermissions()`
 *    intersects a token's ceiling with its Person's live permissions, so if
 *    the gate below were reached by a token whose ceiling included
 *    `api_token.manage_own`, it would pass.
 *
 * 2. MAY MANAGE TOKENS AT ALL: `api_token.manage_own`. This route used to have
 *    NO permission of its own, on the reasoning that delegating a subset of
 *    your own authority needs no authority beyond that subset. True, and it
 *    stopped being the whole question: an institution wants to decide who gets
 *    to automate, which is a policy about the CREDENTIAL rather than about the
 *    permissions inside it. Note the key gates MANAGING a token, never USING
 *    one: it is checked here, at `GET` and at `DELETE`, and nowhere else, so a
 *    Person who loses it keeps every token they already minted, working
 *    exactly as before, until the permissions BEHIND those tokens are revoked.
 *
 * 3. SUBSET AT CREATION: every requested key is checked against the caller's
 *    live permissions, and 403 names the ones they lack. Without this, a
 *    viewer could mint themselves an admin token.
 *
 * The stored permission list is a CEILING, not a grant: `heldPermissions()`
 * intersects it with the Person's live permissions on every request, so this
 * route freezing a snapshot cannot preserve authority the Person later loses.
 */
export default defineEventHandler(async (event) => {
    const body = await readValidatedBody(event, BODY.parse);

    return withRequestTenant(event, async (tx, identity) => {
        if (identity.kind !== 'account') {
            throw createError({
                statusCode: 403,
                message: 'API tokens are managed with a signed-in session, not with a token or device key.',
            });
        }

        await requirePermission(event, tx, 'api_token.manage_own');

        const requested = [...new Set(body.permissions)];
        const unknown = requested.filter((key) => !isPermissionKey(key));

        if (unknown.length) {
            throw createError({
                statusCode: 400,
                message: `Unknown permission key(s): ${unknown.join(', ')}.`,
                data: { field: 'permissions', unknown },
            });
        }

        // The caller's LIVE permissions, loaded directly rather than through
        // `heldPermissions()`: this is a subset check against a list, not a
        // gate on one key. A second read of the same rows as the gate above,
        // deliberately: `heldPermissions()` caches on the event but exposes
        // nothing, and minting is a once-in-a-while action, so paying one
        // extra query inside the open transaction is cheaper than a route
        // reaching into `event.context` for somebody else's cache.
        const held = await loadPermissions(tx, identity.actorPersonId as string);
        const missing = requested.filter((key) => !held.has(key));

        if (missing.length) {
            throw createError({
                statusCode: 403,
                message: 'A token cannot hold more than its creator: '
                    + `you do not hold ${missing.join(', ')}.`,
                data: { field: 'permissions', missing },
            });
        }

        if (body.expiresAt && body.expiresAt.getTime() <= Date.now()) {
            throw createError({
                statusCode: 400,
                message: 'The expiry is in the past.',
                data: { field: 'expiresAt' },
            });
        }

        // Same 32-byte secret as sessions and screen keys; only the SHA-256 is
        // stored, so the response below is the one moment the token exists.
        const token = generateSessionToken();

        const created = await mapDbErrors(() => tx.apiToken.create({
            data: {
                tenantId: identity.tenantId,
                personId: identity.actorPersonId as string,
                name: body.name,
                tokenHash: hashToken(token),
                permissions: requested,
                expiresAt: body.expiresAt ?? null,
            },
        }));

        setResponseStatus(event, 201);

        return {
            id: created.id,
            name: created.name,
            permissions: created.permissions,
            expiresAt: created.expiresAt,
            createdAt: created.createdAt,
            /** SHOWN ONCE. Never stored, never recoverable. */
            token,
        };
    });
});
