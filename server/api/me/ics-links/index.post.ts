import { z } from 'zod';
import { generateSessionToken } from '../../../utils/auth';
import { mapDbErrors } from '../../../utils/dbErrors';
import { withRequestTenant } from '../../../utils/tenantDb';

defineRouteMeta({
    openAPI: {
        tags: ['Calendar links'],
        summary: 'Create a calendar-subscription link',
        description: 'Self-service: any signed-in Person can mint a link that streams exactly their own Sessions (the same "mine" ownSessionClause already defines for session.read_own) — never more, and no permission of its own is needed because it can only ever narrow to the creator. ALL streams every Term the Person has a Session in, bounded to the next weeksAhead weeks; TERM streams one Term in full. The secret is returned in the url field and stays retrievable afterwards from GET /api/me/ics-links — unlike an API token, this is a link meant to be re-copied, not a one-time bearer credential.',
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
                        },
                    },
                },
            },
        },
        responses: {
            201: { description: 'Created. The url field is the full streamable feed address.' },
            400: { description: 'TERM scope with no termId, or ALL scope with no weeksAhead.' },
            403: { description: 'Caller is not a signed-in session.' },
            404: { description: 'termId does not name a Term in the caller’s own tenant.' },
        },
    },
});

const BODY = z.discriminatedUnion('scope', [
    z.object({
        name: z.string().trim().min(1).max(200),
        scope: z.literal('ALL'),
        weeksAhead: z.number().int().min(1).max(52),
    }),
    z.object({
        name: z.string().trim().min(1).max(200),
        scope: z.literal('TERM'),
        termId: z.string().min(1),
    }),
]);

/**
 * Mint a calendar link — a capability URL an external calendar app streams.
 *
 * SELF-SERVICE, NO PERMISSION KEY OF ITS OWN, the same shape `/api/me/api-tokens`
 * takes: the route only ever narrows to the caller's own Sessions, which is
 * authority the Person always has over themselves. SESSION ONLY, so a leaked
 * link cannot mint further links — the same reasoning that keeps a token from
 * minting tokens.
 */
export default defineEventHandler(async (event) => {
    const body = await readValidatedBody(event, BODY.parse);

    return withRequestTenant(event, async (tx, identity) => {
        if (identity.kind !== 'account') {
            throw createError({
                statusCode: 403,
                statusMessage: 'Calendar links are managed with a signed-in session, not with a token or device key.',
            });
        }

        if (body.scope === 'TERM') {
            const term = await tx.term.findFirst({ where: { id: body.termId, tenantId: identity.tenantId } });

            if (!term) {
                throw createError({ statusCode: 404, statusMessage: 'Term not found.', data: { field: 'termId' } });
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
            lastUsedAt: created.lastUsedAt,
            createdAt: created.createdAt,
        };
    });
});
