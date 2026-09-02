import { z } from 'zod';
import { appendEvent, requireBaselineGeneration } from '../../../utils/sessionEvents';
import { requirePermission } from '../../../utils/requirePermission';
import { withRequestTenant } from '../../../utils/tenantDb';

const bodySchema = z.object({ reason: z.string().nullish() }).optional();

defineRouteMeta({
    openAPI: {
        tags: ['Sessions'],
        summary: 'Unlock a session',
        description: 'Releases a lock, returning the Session to the solver candidate set (permission session.lock). Idempotent: unlocking an already unlocked Session returns alreadyUnlocked: true and emits no event.',
        parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
            required: false,
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        properties: { reason: { type: 'string', nullable: true } },
                    },
                },
            },
        },
        responses: {
            200: {
                description: 'Unlocked (or already was).',
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            properties: {
                                session: { type: 'object' },
                                event: { type: 'object', nullable: true, description: 'Null when the Session was already unlocked.' },
                                alreadyUnlocked: { type: 'boolean' },
                            },
                        },
                    },
                },
            },
            404: { description: 'No such Session in this tenant.' },
        },
    },
});

/** Release a lock, returning the Session to the solver's candidate set. */
export default defineEventHandler(async (event) => {
    const id = getRouterParam(event, 'id');
    const body = (await readValidatedBody(event, bodySchema.parse)) ?? {};

    return withRequestTenant(event, async (tx, identity) => {
            await requirePermission(event, tx, 'session.lock');

        const session = await tx.session.findFirst({ where: { id, tenantId: identity.tenantId } });

        if (!session) {
            throw createError({ statusCode: 404, message: 'Not found.' });
        }

        if (!session.isLocked) {
            return { session, event: null, alreadyUnlocked: true };
        }

        const generationId = await requireBaselineGeneration(tx, identity.tenantId, session.generationId);
        const updated = await tx.session.update({ where: { id: session.id }, data: { isLocked: false } });

        const logged = await appendEvent(tx, identity, {
            type: 'UNLOCK',
            generationId,
            sessionId: session.id,
            payload: { isLocked: { from: true, to: false } },
            reason: body.reason,
        });

        return { session: updated, event: logged, alreadyUnlocked: false };
    });
});
