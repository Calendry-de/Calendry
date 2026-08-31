import { z } from 'zod';
import { appendEvent, requireBaselineGeneration } from '../../../utils/sessionEvents';
import { requirePermission } from '../../../utils/requirePermission';
import { withRequestTenant } from '../../../utils/tenantDb';

const bodySchema = z.object({ reason: z.string().nullish() }).optional();

/**
 * Pin a Session so the next solve cannot move it (TAXONOMY.md §3: the solver
 * fills empty slots and never overwrites a lock).
 *
 * Locking does not re-evaluate constraints: it changes no placement, so it
 * cannot create or clear a collision.
 */
export default defineEventHandler(async (event) => {
    const id = getRouterParam(event, 'id');
    const body = (await readValidatedBody(event, bodySchema.parse)) ?? {};

    return withRequestTenant(event, async (tx, identity) => {
            await requirePermission(event, tx, 'session.lock');

        const session = await tx.session.findFirst({ where: { id, tenantId: identity.tenantId } });

        if (!session) {
            throw createError({ statusCode: 404, statusMessage: 'Not found.' });
        }

        if (session.isLocked) {
            return { session, event: null, alreadyLocked: true };
        }

        /**
         * A lock protects a PLACEMENT from the next solve (TAXONOMY.md §3) — a
         * banked Session (issue #22) has none to protect, and the next solve
         * was never going to touch it anyway (it is not sent as occupancy).
         */
        if (session.termWeek === null) {
            throw createError({
                statusCode: 409,
                statusMessage: 'A Session in the spare bank has no placement to lock.',
            });
        }

        const generationId = await requireBaselineGeneration(tx, identity.tenantId, session.generationId);
        const updated = await tx.session.update({ where: { id: session.id }, data: { isLocked: true } });

        const logged = await appendEvent(tx, identity, {
            type: 'LOCK',
            generationId,
            sessionId: session.id,
            payload: { isLocked: { from: false, to: true } },
            reason: body.reason,
        });

        return { session: updated, event: logged, alreadyLocked: false };
    });
});
