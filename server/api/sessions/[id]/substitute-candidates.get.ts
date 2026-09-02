import { z } from 'zod';
import { freeSubstituteCandidates } from '../../../utils/substituteCandidates';
import { requirePermission } from '../../../utils/requirePermission';
import { withRequestTenant } from '../../../utils/tenantDb';
import { isPlacedSession } from '../../../../shared/sessionPlacement';

const querySchema = z.object({
    q: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(50).optional(),
});

/**
 * Who may cover THIS Session right now (issue #30): "the picker for 'who can
 * cover this' should filter to people who are free at that slot, not let a
 * clash be created and warned about after."
 *
 * A dedicated read route rather than folding into `/api/persons`: "free at
 * this Session's slot" is meaningless without a Session to check against, and
 * the generic resource route has no way to accept one.
 */
export default defineEventHandler(async (event) => {
    const id = getRouterParam(event, 'id');
    const query = await getValidatedQuery(event, querySchema.parse);

    return withRequestTenant(event, async (tx, identity) => {
        await requirePermission(event, tx, 'session.substitute');

        const session = await tx.session.findFirst({
            where: { id, tenantId: identity.tenantId },
            select: {
                id: true, termId: true, termWeek: true, dayOfWeek: true, blockIndex: true, durationBlocks: true,
            },
        });

        if (!session) {
            throw createError({ statusCode: 404, message: 'Not found.' });
        }

        // A banked Session (issue #22) has no slot to be free or busy AT: the
        // same precondition `move.post.ts`/`swap.post.ts`/`lock.post.ts` refuse.
        if (!isPlacedSession(session)) {
            throw createError({
                statusCode: 409,
                message: 'This session is in the spare bank and has no slot to check availability against.',
            });
        }

        return freeSubstituteCandidates(tx, {
            tenantId: identity.tenantId,
            federationId: identity.federationId,
            session,
            query: query.q,
            limit: query.limit,
        });
    });
});
