import { mapDbErrors } from '../../utils/dbErrors';
import { appendEvent, placementOf, requireBaselineGeneration } from '../../utils/sessionEvents';
import { requirePermission } from '../../utils/requirePermission';
import { withRequestTenant } from '../../utils/tenantDb';

defineRouteMeta({
    openAPI: {
        tags: ['Sessions'],
        summary: 'Delete an event',
        description: 'Deletes an EVENT: a Session with no Offering (permission session.delete). Offering-linked Sessions are refused with 409, because their demand would make the next solve re-create them, so the delete would silently undo itself. The DELETE audit event is written first, carrying the placement that was removed.',
        parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
            200: {
                description: 'Deleted.',
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            properties: {
                                deleted: { type: 'string', description: 'Id of the deleted Session.' },
                                event: { type: 'object', description: 'The appended DELETE audit event.' },
                            },
                        },
                    },
                },
            },
            404: { description: 'No such Session in this tenant.' },
            409: { description: 'The Session belongs to an Offering and cannot be deleted here.' },
        },
    },
});

/**
 * Delete an EVENT: a Session with no Offering.
 *
 * WHY ONLY EVENTS
 *
 * An Offering-linked Session is demand made concrete: its Offering declares how
 * many times it must happen, so deleting one leaves `frequency` unsatisfied and
 * the next solve simply re-creates it. The delete would appear to work and then
 * silently undo itself, which is worse than refusing, and is the failure shape
 * this codebase keeps designing against.
 *
 * Removing a real Session properly means deciding whether it should be
 * re-placed or held as unplaced-but-tracked, which is the deliberately deferred
 * "cancel to spare bank" feature (tracked on the project board). This route does not build half
 * of it.
 *
 * An Event has no demand behind it, so deleting one is final and means exactly
 * what it says.
 *
 * WHY 409 AND NOT 404 FOR A REAL SESSION
 *
 * "This Session belongs to an Offering" and "no such Session" are different
 * facts. Collapsing them would make a genuine bug (a mis-typed id, a
 * cross-tenant read) indistinguishable from the rule working.
 */
export default defineEventHandler(async (event) => {
    const id = getRouterParam(event, 'id');

    return withRequestTenant(event, async (tx, identity) => {
        await requirePermission(event, tx, 'session.delete');

        const session = await tx.session.findFirst({
            where: { id, tenantId: identity.tenantId },
        });

        if (!session) {
            throw createError({ statusCode: 404, message: 'Not found.' });
        }

        if (session.offeringId !== null) {
            throw createError({
                statusCode: 409,
                message: 'This Session belongs to an Offering, so deleting it would leave that '
                    + "Offering's frequency unmet and the next solve would place it again. Only an "
                    + 'Event (a Session with no Offering) can be deleted here.',
                data: { offeringId: session.offeringId },
            });
        }

        /**
         * The baseline the event hangs off. An Event's own `generationId` is
         * NULL by design (a human placed it, no Generation did), and an event
         * with no baseline cannot be replayed, so this resolves the tenant's
         * current one, exactly as the create route does.
         */
        const generationId = await requireBaselineGeneration(tx, identity.tenantId, null);

        const rooms = await tx.sessionRoom.findMany({
            where: { sessionId: session.id },
            select: { roomId: true },
        });

        /**
         * EVENT FIRST, THEN THE ROW: the same order and the same helper
         * `executePlan()` uses for solver-driven deletes.
         *
         * `session_event.session_id` is ON DELETE SET NULL, and the append-only
         * trigger permits exactly that detach and nothing else (migration
         * 20260816180000). So the event is written pointing at a live Session
         * and the delete then nulls the pointer, leaving the payload intact.
         * Writing it afterwards would produce a row pointing at nothing, which
         * is indistinguishable from the detached case and loses which Session
         * it was.
         */
        const logged = await appendEvent(tx, identity, {
            type: 'DELETE',
            generationId,
            sessionId: session.id,
            payload: {
                from: { ...placementOf(session), roomIds: rooms.map((r) => r.roomId) },
                offeringId: null,
                kindId: session.kindId,
                reason: 'deleted_by_user',
                isEvent: true,
            },
        });

        // session_group, session_person, session_room and constraint_violation
        // are all ON DELETE CASCADE, so nothing else needs clearing first.
        await mapDbErrors(() => tx.session.delete({ where: { id: session.id } }));

        return { deleted: session.id, event: logged };
    });
});
