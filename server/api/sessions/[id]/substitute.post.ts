import { z } from 'zod';
import { mapDbErrors } from '../../../utils/dbErrors';
import { appendEvent, requireBaselineGeneration } from '../../../utils/sessionEvents';
import { requirePermission } from '../../../utils/requirePermission';
import { withRequestTenant } from '../../../utils/tenantDb';
import { assertFreeForSubstitution } from '../../../utils/substituteCandidates';
import { isPlacedSession } from '../../../../shared/sessionPlacement';

const bodySchema = z.object({
    personId: z.string().min(1),
    reason: z.string().nullish(),
});

/**
 * Cover this Session's occurrence, Vertretung (issue #30): "the timetable
 * keeps the slot, the room and the group; what changes is who teaches it."
 *
 * AN OVERLAY, NOT AN EDIT. `session_person` is never touched, so the original
 * lecturer's assignment survives and next week's (different) Session row
 * reverts automatically; see `SessionSubstitution`'s own comment for why one
 * Session IS one occurrence and needs no date range here. Contrast
 * `lecturers.post.ts`, which OVERWRITES `session_person` permanently and
 * therefore requires the Session to be LOCKED first, or the next solve would
 * silently discard the change: nothing this route writes is visible to the
 * solver or to the next `apply`, so no lock is required.
 *
 * SAME SLOT, SAME ROOM ONLY: deliberately out of scope for issue #30. A
 * room-changed substitution would need `session.move`'s own guards
 * (grid-bounds, room availability) on top of this one; nothing here moves
 * anything.
 *
 * Calling this again on an already-covered Session REPLACES the substitute
 * (`upsert`) rather than refusing: "wrong person picked, fix it" is the
 * common real-world case, and a second SUBSTITUTE event records the
 * correction rather than silently overwriting history.
 */
export default defineEventHandler(async (event) => {
    const id = getRouterParam(event, 'id');
    const body = await readValidatedBody(event, bodySchema.parse);

    return withRequestTenant(event, async (tx, identity) => {
        await requirePermission(event, tx, 'session.substitute');

        const session = await tx.session.findFirst({
            where: { id, tenantId: identity.tenantId },
            include: { substitution: true },
        });

        if (!session) {
            throw createError({ statusCode: 404, statusMessage: 'Not found.' });
        }

        // A banked Session (issue #22) has no slot to cover, same
        // precondition `move.post.ts`/`swap.post.ts`/`lock.post.ts` refuse.
        if (!isPlacedSession(session)) {
            throw createError({
                statusCode: 409,
                statusMessage: 'This session is in the spare bank and has no slot to cover.',
            });
        }

        // Resolved rather than trusted, same as `lecturers.post.ts`: the FK
        // alone would accept another tenant's Person, and separately from the
        // role/availability checks below so a bad id reports 404, not 422.
        const person = await tx.person.findFirst({
            where: { id: body.personId, tenantId: identity.tenantId },
            select: { id: true },
        });

        if (!person) {
            throw createError({ statusCode: 404, statusMessage: 'Person not found.' });
        }

        await assertFreeForSubstitution(tx, {
            tenantId: identity.tenantId,
            federationId: identity.federationId,
            session,
            personId: body.personId,
        });

        const before = session.substitution?.coveringPersonId ?? null;

        const substitution = await mapDbErrors(() => tx.sessionSubstitution.upsert({
            where: { sessionId: session.id },
            create: { tenantId: identity.tenantId, sessionId: session.id, coveringPersonId: body.personId, reason: body.reason },
            update: { coveringPersonId: body.personId, reason: body.reason ?? null },
        }));

        const generationId = await requireBaselineGeneration(tx, identity.tenantId, session.generationId);

        const logged = await appendEvent(tx, identity, {
            type: 'SUBSTITUTE',
            generationId,
            sessionId: session.id,
            payload: { from: before, to: body.personId },
            reason: body.reason,
        });

        return { session, substitution, event: logged };
    });
});
