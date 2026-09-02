import { withRequestTenant } from '../../../utils/tenantDb';

defineRouteMeta({
    openAPI: {
        tags: ['Calendar links'],
        summary: 'List my calendar-subscription links',
        description: 'The ics_links the signed-in Person has created, including the full streamable URL. Unlike an API token or screen key this is NOT shown once: the whole point is a link a person can come back and re-copy, so the secret is returned every time. Session only; a link cannot enumerate its siblings.',
        responses: {
            200: {
                description: 'Bare array of the callers links, newest first.',
                content: {
                    'application/json': {
                        schema: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    id: { type: 'string' },
                                    name: { type: 'string' },
                                    url: { type: 'string' },
                                    scope: { type: 'string', enum: ['ALL', 'TERM'] },
                                    termId: { type: 'string', nullable: true },
                                    weeksAhead: { type: 'integer', nullable: true },
                                    groupIds: { type: 'array', items: { type: 'string' }, description: 'Empty means the link streams the caller\'s own Sessions (issue #115).' },
                                    lastUsedAt: { type: 'string', format: 'date-time', nullable: true },
                                    createdAt: { type: 'string', format: 'date-time' },
                                },
                            },
                        },
                    },
                },
            },
            403: { description: 'Caller is a token, screen key, or ics_link, not a signed-in session.' },
        },
    },
});

/**
 * The caller's own links. Self-scoped like `/api/me/api-tokens`: the WHERE is
 * the caller's own Person, so no permission key gates it.
 */
export default defineEventHandler(async (event) => withRequestTenant(event, async (tx, identity) => {
    if (identity.kind !== 'account') {
        throw createError({
            statusCode: 403,
            message: 'Calendar links are managed with a signed-in session, not with a token or device key.',
        });
    }

    const links = await tx.icsLink.findMany({
        where: { personId: identity.actorPersonId as string },
        include: { groups: { select: { groupId: true } } },
        orderBy: { createdAt: 'desc' },
    });

    const origin = getRequestURL(event).origin;

    return links.map((link) => ({
        id: link.id,
        name: link.name,
        url: `${origin}/api/ics/stream.ics?token=${link.token}`,
        scope: link.scope,
        termId: link.termId,
        weeksAhead: link.weeksAhead,
        groupIds: link.groups.map((row) => row.groupId),
        lastUsedAt: link.lastUsedAt,
        createdAt: link.createdAt,
    }));
}));
