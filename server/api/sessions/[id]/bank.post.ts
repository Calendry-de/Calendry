import { z } from 'zod';
import { appendEvent, placementOf, requireBaselineGeneration } from '../../../utils/sessionEvents';
import { requirePermission } from '../../../utils/requirePermission';
import { withRequestTenant } from '../../../utils/tenantDb';
import { isPlacedSession } from '../../../../shared/sessionPlacement';

const bodySchema = z.object({ reason: z.string().nullish() }).optional();

/**
 * Cancel a Session to the spare bank (issue #22).
 *
 * WHY ONLY OFFERING-LINKED SESSIONS. An Event has no demand behind it:
 * cancelling one and "keeping the teaching owed" is a contradiction, since
 * there is no teaching owed. `[id].delete.ts` is final removal for exactly
 * that case; this route is its counterpart for a Session an Offering still
 * requires.
 *
 * WHY THIS DOES NOT TOUCH `constraint_violation` VIA `refreshViolations()`.
 * That function's collision detection keys on `termWeek`/`dayOfWeek`; a
 * banked Session has neither, so it cannot violate a placement-based hard
 * constraint. Its existing session-scoped rows are simply cleared rather than
 * recomputed, which is the same end state `refreshViolations` would reach
 * for a Session with nothing to collide against, without asking that
 * (already carefully-balanced) function to reason about a placement that
 * does not exist.
 *
 * ONE ROW SURVIVES THE CLEAR: `no_unplaced_session` (shared/constraintTypes.ts)
 * is the exact opposite shape (a fact about the ABSENCE of a placement), so
 * it is written directly here rather than through `refreshViolations()`, which
 * never sees a banked Session at all. `move.post.ts` clears it again the
 * moment this Session is re-placed, the same way it clears any other
 * structural violation.
 *
 * WHY LOCKED IS REFUSED RATHER THAN SILENTLY UNLOCKED. `Move…` and `Swap…`
 * both require an unlock first (TAXONOMY.md §3: a lock is the tenant's own
 * decision to protect a placement); cancelling one out from under that
 * decision without asking would be the one path that bypasses it.
 */
export default defineEventHandler(async (event) => {
    const id = getRouterParam(event, 'id');
    const body = (await readValidatedBody(event, bodySchema.parse)) ?? {};

    return withRequestTenant(event, async (tx, identity) => {
        await requirePermission(event, tx, 'session.bank');

        const session = await tx.session.findFirst({
            where: { id, tenantId: identity.tenantId },
        });

        if (!session) {
            throw createError({ statusCode: 404, statusMessage: 'Not found.' });
        }

        if (session.offeringId === null) {
            throw createError({
                statusCode: 409,
                statusMessage: 'This Session has no Offering, so there is no demand to preserve. '
                    + 'Delete it instead.',
                data: { offeringId: session.offeringId },
            });
        }

        if (!isPlacedSession(session)) {
            throw createError({ statusCode: 409, statusMessage: 'This Session is already in the spare bank.' });
        }

        if (session.isLocked) {
            throw createError({
                statusCode: 409,
                statusMessage: 'Unlock this session before moving it to the spare bank.',
            });
        }

        const generationId = await requireBaselineGeneration(tx, identity.tenantId, session.generationId);
        const before = placementOf(session);
        const rooms = await tx.sessionRoom.findMany({
            where: { sessionId: session.id },
            select: { roomId: true },
        });

        const updated = await tx.session.update({
            where: { id: session.id },
            data: { termWeek: null, dayOfWeek: null, blockIndex: null },
        });

        const logged = await appendEvent(tx, identity, {
            type: 'BANK',
            generationId,
            sessionId: session.id,
            payload: {
                from: { ...before, roomIds: rooms.map((r) => r.roomId) },
                reason: body.reason ?? 'banked_by_user',
            },
            reason: body.reason,
        });

        // No placement, nothing to collide against; see the file comment.
        await tx.constraintViolation.deleteMany({
            where: { tenantId: identity.tenantId, sessionId: session.id },
        });

        // The one exception: report the bank itself, if the tenant has asked to
        // be warned about it. `isEnabled: false` (or no row at all, on a tenant
        // provisioned before this type existed) means silently skipped, same as
        // every other structural rule a tenant has switched off.
        const unplacedConstraint = await tx.constraint.findFirst({
            where: { tenantId: identity.tenantId, type: 'no_unplaced_session', isEnabled: true },
            select: { id: true, severity: true, weight: true },
        });

        if (unplacedConstraint) {
            await tx.constraintViolation.create({
                data: {
                    tenantId: identity.tenantId,
                    constraintId: unplacedConstraint.id,
                    sessionId: session.id,
                    offeringId: null,
                    severity: unplacedConstraint.severity,
                    penalty: unplacedConstraint.severity === 'SOFT' ? unplacedConstraint.weight : null,
                    detail: { reason: 'session_unplaced' },
                    detectedByEventId: logged.id,
                    generationId,
                },
            });
        }

        return { session: updated, event: logged };
    });
});
