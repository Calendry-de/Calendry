import { mapDbErrors } from '../../../utils/dbErrors';
import { withRequestTenant } from '../../../utils/tenantDb';

defineRouteMeta({
    openAPI: {
        tags: ['Calendar links'],
        summary: 'Delete a calendar-subscription link',
        description: 'Deletes one of the signed-in Person’s links. The token stops resolving immediately: deletion is a row lookup, not a cache. Session only.',
        parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
            200: {
                description: 'Deleted.',
                content: {
                    'application/json': {
                        schema: { type: 'object', properties: { deleted: { type: 'string' } } },
                    },
                },
            },
            403: { description: 'Caller is a token or device key, not a signed-in session.' },
            404: { description: 'No such link among the callers own.' },
        },
    },
});

/**
 * Delete one of the caller's own links. Same shape as `DELETE
 * /api/me/api-tokens/[id]`: the person predicate is in the WHERE, so
 * somebody else's link id deletes zero rows and reads as 404.
 */
export default defineEventHandler(async (event) => {
    const id = getRouterParam(event, 'id');

    return withRequestTenant(event, async (tx, identity) => {
        if (identity.kind !== 'account') {
            throw createError({
                statusCode: 403,
                statusMessage: 'Calendar links are managed with a signed-in session, not with a token or device key.',
            });
        }

        const deleted = await mapDbErrors(() => tx.icsLink.deleteMany({
            where: { id, personId: identity.actorPersonId as string },
        }));

        if (deleted.count === 0) {
            throw createError({ statusCode: 404, statusMessage: 'Not found.' });
        }

        return { deleted: id };
    });
});
