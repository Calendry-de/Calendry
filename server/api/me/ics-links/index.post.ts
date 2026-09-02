import { z } from 'zod';
import { generateSessionToken } from '../../../utils/auth';
import { mapDbErrors } from '../../../utils/dbErrors';
import { holdsPermission, requireAnyPermission } from '../../../utils/requirePermission';
import { withRequestTenant } from '../../../utils/tenantDb';

defineRouteMeta({
    openAPI: {
        tags: ['Calendar links'],
        summary: 'Create a calendar-subscription link',
        description: 'Needs ics_link.generate_own (streams exactly the caller\'s own Sessions, the same "mine" ownSessionClause already defines for session.read_own) or ics_link.generate (also lets groupIds name one or more Groups, streaming THEIR Sessions instead, issue #115). ALL streams every Term the subject has a Session in, bounded to the next weeksAhead weeks; TERM streams one Term in full. The secret is returned in the url field and stays retrievable afterwards from GET /api/me/ics-links: unlike an API token, this is a link meant to be re-copied, not a one-time bearer credential.',
        requestBody: {
            required: true,
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        required: ['name', 'scope'],
                        properties: {
                            name: { type: 'string', description: 'What a human calls it when deleting the right one.' },
                            scope: { type: 'string', enum: ['ALL', 'TERM'] },
                            termId: { type: 'string', description: 'Required, and only read, when scope is TERM.' },
                            weeksAhead: { type: 'integer', minimum: 1, maximum: 52, description: 'Required, and only read, when scope is ALL.' },
                            groupIds: { type: 'array', items: { type: 'string' }, description: 'Stream these Groups\' Sessions instead of the caller\'s own. Needs ics_link.generate; empty/omitted means "my own Sessions".' },
                        },
                    },
                },
            },
        },
        responses: {
            201: { description: 'Created. The url field is the full streamable feed address.' },
            400: { description: 'TERM scope with no termId, or ALL scope with no weeksAhead.' },
            403: { description: 'Caller holds neither ics_link key, is not a signed-in session, or named groupIds without ics_link.generate.' },
            404: { description: 'termId, or one of groupIds, does not name a row in the caller’s own tenant.' },
        },
    },
});

const BODY = z.discriminatedUnion('scope', [
    z.object({
        name: z.string().trim().min(1).max(200),
        scope: z.literal('ALL'),
        weeksAhead: z.number().int().min(1).max(52),
        groupIds: z.array(z.string().min(1)).optional(),
    }),
    z.object({
        name: z.string().trim().min(1).max(200),
        scope: z.literal('TERM'),
        termId: z.string().min(1),
        groupIds: z.array(z.string().min(1)).optional(),
    }),
]);

/**
 * Mint a calendar link: a capability URL an external calendar app streams.
 *
 * TWO PERMISSIONS, ONE ROUTE, same shape `sessionReadScope` gives
 * `session.read`/`session.read_own`: `ics_link.generate_own` may only ever
 * narrow to the caller's own Sessions (authority a Person always has over
 * themselves, needing no permission in principle: the key exists only
 * because a link is a standing credential handed to a third-party app, not a
 * one-off read); `ics_link.generate` may ALSO name explicit `groupIds`,
 * which is institution data, not self-service. SESSION ONLY, so a leaked link
 * cannot mint further links, the same reasoning that keeps a token from
 * minting tokens.
 */
export default defineEventHandler(async (event) => {
    const body = await readValidatedBody(event, BODY.parse);

    return withRequestTenant(event, async (tx, identity) => {
        if (identity.kind !== 'account') {
            throw createError({
                statusCode: 403,
                message: 'Calendar links are managed with a signed-in session, not with a token or device key.',
            });
        }

        await requireAnyPermission(event, tx, ['ics_link.generate', 'ics_link.generate_own']);

        const groupIds = [...new Set(body.groupIds ?? [])];

        if (groupIds.length && !(await holdsPermission(event, tx, 'ics_link.generate'))) {
            throw createError({
                statusCode: 403,
                message: 'ics_link.generate_own may only create a link for your own schedule, not specific Groups.',
            });
        }

        if (body.scope === 'TERM') {
            const term = await tx.term.findFirst({ where: { id: body.termId, tenantId: identity.tenantId } });

            if (!term) {
                throw createError({ statusCode: 404, message: 'Term not found.', data: { field: 'termId' } });
            }
        }

        if (groupIds.length) {
            const found = await tx.group.findMany({
                where: { id: { in: groupIds }, tenantId: identity.tenantId },
                select: { id: true },
            });

            if (found.length !== groupIds.length) {
                throw createError({ statusCode: 404, message: 'One or more groupIds not found.', data: { field: 'groupIds' } });
            }
        }

        const token = generateSessionToken();

        const created = await mapDbErrors(() => tx.icsLink.create({
            data: {
                tenantId: identity.tenantId,
                personId: identity.actorPersonId as string,
                name: body.name,
                token,
                scope: body.scope,
                termId: body.scope === 'TERM' ? body.termId : null,
                weeksAhead: body.scope === 'ALL' ? body.weeksAhead : null,
                groups: groupIds.length
                    ? { createMany: { data: groupIds.map((groupId) => ({ groupId, tenantId: identity.tenantId })) } }
                    : undefined,
            },
        }));

        setResponseStatus(event, 201);

        return {
            id: created.id,
            name: created.name,
            url: `${getRequestURL(event).origin}/api/ics/stream.ics?token=${token}`,
            scope: created.scope,
            termId: created.termId,
            weeksAhead: created.weeksAhead,
            groupIds,
            lastUsedAt: created.lastUsedAt,
            createdAt: created.createdAt,
        };
    });
});
