import { z } from 'zod';
import { mapDbErrors } from '../../../utils/dbErrors';
import { appendEvent, placementOf, requireBaselineGeneration } from '../../../utils/sessionEvents';
import { requirePermission } from '../../../utils/requirePermission';
import { withRequestTenant } from '../../../utils/tenantDb';
import { refreshViolations } from '../../../utils/violations';

const bodySchema = z.object({
    withSessionId: z.string().min(1),
    reason: z.string().nullish(),
});

defineRouteMeta({
    openAPI: {
        tags: ['Sessions'],
        summary: 'Swap two sessions',
        description: 'Exchanges the placements of two Sessions atomically (permission session.swap). Emits ONE SWAP audit event referencing both, so a replay can never stop between the halves. Warn-and-allow: resulting constraint violations are returned, never block the edit.',
        parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
            required: true,
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        required: ['withSessionId'],
                        properties: {
                            withSessionId: { type: 'string' },
                            reason: { type: 'string', nullable: true },
                        },
                    },
                },
            },
        },
        responses: {
            200: {
                description: 'Swapped.',
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            properties: {
                                sessions: { type: 'array', items: { type: 'object' }, description: 'Both Sessions after the swap.' },
                                event: { type: 'object', description: 'The single SWAP audit event.' },
                                violations: { type: 'array', items: { type: 'object' } },
                            },
                        },
                    },
                },
            },
            404: { description: 'Either Session is missing in this tenant (cross-tenant ids read as not found).' },
            422: { description: 'Attempted to swap a Session with itself.' },
        },
    },
});

/**
 * Exchange two Sessions' placements.
 *
 * Emits ONE SWAP event referencing both Sessions rather than two MOVEs: a swap
 * is atomic, and splitting it would let a replay stop between the halves in a
 * state where both Sessions occupy the same slot.
 */
export default defineEventHandler(async (event) => {
    const id = getRouterParam(event, 'id');
    const body = await readValidatedBody(event, bodySchema.parse);

    if (id === body.withSessionId) {
        throw createError({ statusCode: 422, statusMessage: 'Cannot swap a Session with itself.' });
    }

    return withRequestTenant(event, async (tx, identity) => {
            await requirePermission(event, tx, 'session.swap');

        // Both fetched under the tenant predicate, so swapping with a Session
        // from another tenant reads as "not found" rather than partially
        // succeeding.
        // Sequential, not `Promise.all`: both share the request's one
        // interactive transaction connection, and issuing two queries on it
        // concurrently is deprecated pg client behaviour (removed in pg@9).
        const a = await tx.session.findFirst({ where: { id, tenantId: identity.tenantId } });
        const b = await tx.session.findFirst({ where: { id: body.withSessionId, tenantId: identity.tenantId } });

        if (!a || !b) {
            throw createError({ statusCode: 404, statusMessage: 'Not found.' });
        }

        /**
         * A swap exchanges two PLACEMENTS (issue #22): a banked Session has
         * none to offer, so "swap with it" has no meaning. `bank`/`move` are
         * the routes that give one back a placement or take it away.
         */
        if (a.termWeek === null || b.termWeek === null) {
            throw createError({
                statusCode: 409,
                statusMessage: 'A Session in the spare bank has no placement to swap; place it first.',
            });
        }

        const generationId = await requireBaselineGeneration(tx, identity.tenantId, a.generationId ?? b.generationId);
        const placementA = placementOf(a);
        const placementB = placementOf(b);

        await mapDbErrors(async () => {
            await tx.session.update({ where: { id: a.id }, data: placementB });
            await tx.session.update({ where: { id: b.id }, data: placementA });
        });

        const logged = await appendEvent(tx, identity, {
            type: 'SWAP',
            generationId,
            sessionId: a.id,
            counterpartSessionId: b.id,
            payload: {
                a: { sessionId: a.id, from: placementA, to: placementB },
                b: { sessionId: b.id, from: placementB, to: placementA },
            },
            reason: body.reason,
        });

        await refreshViolations(tx, {
            tenantId: identity.tenantId,
            federationId: identity.federationId,
            sessionIds: [a.id, b.id],
            detectedByEventId: logged.id,
            generationId,
        });

        // Sequential; see the earlier note: `tx` is one shared connection.
        const sessionA = await tx.session.findFirst({ where: { id: a.id } });
        const sessionB = await tx.session.findFirst({ where: { id: b.id } });
        const violations = await tx.constraintViolation.findMany({
            where: { tenantId: identity.tenantId, sessionId: { in: [a.id, b.id] } },
        });

        return { sessions: [sessionA, sessionB], event: logged, violations };
    });
});
