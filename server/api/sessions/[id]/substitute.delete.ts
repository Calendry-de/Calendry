import { z } from 'zod';
import { appendEvent, requireBaselineGeneration } from '../../../utils/sessionEvents';
import { requirePermission } from '../../../utils/requirePermission';
import { withRequestTenant } from '../../../utils/tenantDb';

const bodySchema = z.object({ reason: z.string().nullish() }).optional();

/**
 * Undo a substitution — the "wrong person picked" correction, and the only way
 * back to "nobody is covering this" short of waiting for the Session itself to
 * change. Deliberately NOT the "cancelled vs uncovered" question the ticket
 * scopes to Cancel-to-spare-bank: this never touches whether the Session
 * itself runs, only removes the covering overlay.
 */
export default defineEventHandler(async (event) => {
    const id = getRouterParam(event, 'id');
    const body = (await readValidatedBody(event, bodySchema.parse)) ?? {};

    return withRequestTenant(event, async (tx, identity) => {
        await requirePermission(event, tx, 'session.substitute');

        const session = await tx.session.findFirst({
            where: { id, tenantId: identity.tenantId },
            include: { substitution: true },
        });

        if (!session) {
            throw createError({ statusCode: 404, statusMessage: 'Not found.' });
        }

        if (!session.substitution) {
            return { session, event: null, wasCovered: false };
        }

        const before = session.substitution.coveringPersonId;

        await tx.sessionSubstitution.delete({ where: { sessionId: session.id } });

        const generationId = await requireBaselineGeneration(tx, identity.tenantId, session.generationId);

        const logged = await appendEvent(tx, identity, {
            type: 'SUBSTITUTE',
            generationId,
            sessionId: session.id,
            payload: { from: before, to: null },
            reason: body.reason,
        });

        return { session, event: logged, wasCovered: true };
    });
});
