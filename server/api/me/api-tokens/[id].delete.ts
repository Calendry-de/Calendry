import { mapDbErrors } from '../../../utils/dbErrors';
import { withRequestTenant } from '../../../utils/tenantDb';

defineRouteMeta({
    openAPI: {
        tags: ['API tokens'],
        summary: 'Revoke an API token',
        description: 'Deletes one of the signed-in Person tokens. The bearer secret stops resolving immediately: revocation is a row lookup, not a cache. Session only; a token cannot revoke itself or its siblings.',
        parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
            200: {
                description: 'Revoked.',
                content: {
                    'application/json': {
                        schema: { type: 'object', properties: { deleted: { type: 'string' } } },
                    },
                },
            },
            403: { description: 'Caller is a token or device key, not a signed-in session.' },
            404: { description: 'No such token among the callers own.' },
        },
    },
});

/**
 * Delete one of the caller's own tokens.
 *
 * `deleteMany` with the person predicate in the WHERE, the same shape the
 * generic PATCH uses for its tenant predicate: somebody else's token id
 * deletes zero rows and reads as 404, never as a permission error that
 * confirms the row exists.
 */
export default defineEventHandler(async (event) => {
    const id = getRouterParam(event, 'id');

    return withRequestTenant(event, async (tx, identity) => {
        if (identity.kind !== 'account') {
            throw createError({
                statusCode: 403,
                statusMessage: 'API tokens are managed with a signed-in session, not with a token or device key.',
            });
        }

        const deleted = await mapDbErrors(() => tx.apiToken.deleteMany({
            where: { id, personId: identity.actorPersonId as string },
        }));

        if (deleted.count === 0) {
            throw createError({ statusCode: 404, statusMessage: 'Not found.' });
        }

        return { deleted: id };
    });
});
