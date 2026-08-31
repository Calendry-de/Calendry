import { z } from 'zod';
import { LECTURER_ROLE_KEY } from '../../../../shared/roles';
import { mapDbErrors } from '../../../utils/dbErrors';
import { appendEvent, requireBaselineGeneration } from '../../../utils/sessionEvents';
import { requirePermission } from '../../../utils/requirePermission';
import { withRequestTenant } from '../../../utils/tenantDb';
import { refreshViolations } from '../../../utils/violations';

const bodySchema = z.object({
    personIds: z.array(z.string().min(1)),
    reason: z.string().nullish(),
});

defineRouteMeta({
    openAPI: {
        tags: ['Sessions'],
        summary: 'Override who leads a session',
        description: 'Replaces the lecturer set of a Session (permission session.assign_lecturer). An Offering-linked Session must be LOCKED first, because an unlocked one gets its lecturer from the next solve and the override would be silently discarded; Events need no lock. A person already attached as a plain attendee is promoted in place; a lecturer dropped from the list has their row deleted.',
        parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
            required: true,
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        required: ['personIds'],
                        properties: {
                            personIds: { type: 'array', items: { type: 'string' }, description: 'The complete new lecturer set. An empty array removes all lecturers.' },
                            reason: { type: 'string', nullable: true },
                        },
                    },
                },
            },
        },
        responses: {
            200: {
                description: 'Lecturer set replaced.',
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            properties: {
                                session: { type: 'object', description: 'The updated Session row.' },
                                event: { type: 'object', description: 'The appended audit event (event-sourced history).' },
                                violations: { type: 'array', items: { type: 'object' }, description: 'Constraint violations now recorded against the Session. Warn-and-allow: they never block the edit.' },
                            },
                        },
                    },
                },
            },
            404: { description: 'Session or a named Person not found in this tenant.' },
            409: { description: 'The Session belongs to an Offering and is not locked. Lock it first.' },
            422: { description: 'This tenant has no lecturer role configured.' },
        },
    },
});

/**
 * Override who leads a Session — #7 item 4, "manual per-session override".
 *
 * WHY THIS IS NOT `details.post.ts`
 *
 * That route refuses ANY edit to an Offering-linked Session's people, groups,
 * kind or title, because all four are copied from the Offering and the solver
 * on every apply — an edit there would be silently overwritten, which is worse
 * than being refused. This route exists because the card's own question —
 * "how does an override survive a re-solve" — has one answer that needs no new
 * solver capability: a LOCKED Session is already skipped entirely by
 * `planMaterialization` (`if (current?.isLocked) continue`), on a rebuild as
 * much as a repair. So the override is safe exactly when the Session already
 * cannot be touched by a solve, and this route's whole job is enforcing that
 * precondition rather than inventing a softer one.
 *
 * WHY AN EVENT NEEDS NO LOCK
 *
 * An Event has no Offering, so it is structurally invisible to
 * `planMaterialization`'s placement loop (which iterates the solver's OWN
 * output, keyed by Offering) regardless of `isLocked` — the same reason
 * `POST /api/sessions` exempts one from every solve without relying on the
 * lock. Requiring a lock here too would be a guard that can never fail for the
 * one case it would apply to, which this codebase treats as worse than none.
 *
 * ONLY LECTURER MEMBERSHIP IS REPLACED — never a row that is not, this moment,
 * part of it. `session_person`'s key is `(session_id, person_id)`, ONE row per
 * person per Session with `role_id` distinguishing lecturer from plain
 * attendee, so "lecturer" and "attendee" are not two slots — a person already
 * attached as an ordinary attendee and named here is PROMOTED (their row's
 * `role_id` is set), not given a second row, which the primary key would
 * refuse outright. Demoted the same way in reverse: a current lecturer dropped
 * from the list has their row DELETED, matching the "remove means the join row
 * is gone" convention every other picker in this codebase already follows — if
 * they should remain attached as a plain attendee, that is a separate,
 * deliberate choice made through the People picker, not one this route infers.
 */
export default defineEventHandler(async (event) => {
    const id = getRouterParam(event, 'id');
    const body = await readValidatedBody(event, bodySchema.parse);

    return withRequestTenant(event, async (tx, identity) => {
        await requirePermission(event, tx, 'session.assign_lecturer');

        const session = await tx.session.findFirst({
            where: { id, tenantId: identity.tenantId },
            include: { people: true },
        });

        if (!session) {
            throw createError({ statusCode: 404, statusMessage: 'Not found.' });
        }

        if (session.offeringId !== null && !session.isLocked) {
            throw createError({
                statusCode: 409,
                statusMessage: 'This session belongs to an Offering and is not locked, so its '
                    + 'lecturer comes from the next solve — an override here would be silently '
                    + 'discarded by the next apply. Lock the session first.',
                data: { field: 'isLocked', offeringId: session.offeringId, isLocked: session.isLocked },
            });
        }

        const lecturerRole = await tx.role.findFirst({
            where: { tenantId: identity.tenantId, key: LECTURER_ROLE_KEY },
            select: { id: true },
        });

        if (!lecturerRole) {
            throw createError({
                statusCode: 422,
                statusMessage: "This tenant has no 'lecturer' role configured, so a lecturer "
                    + 'cannot be recorded against a Session.',
            });
        }

        // Resolved rather than trusted: the FK alone would accept another
        // tenant's Person.
        if (body.personIds.length) {
            const found = await tx.person.count({
                where: { id: { in: body.personIds }, tenantId: identity.tenantId },
            });

            if (found !== new Set(body.personIds).size) {
                throw createError({ statusCode: 404, statusMessage: 'Person not found.' });
            }
        }

        const before = session.people
            .filter((p) => p.roleId === lecturerRole.id)
            .map((p) => p.personId)
            .sort();
        const after = [...new Set(body.personIds)].sort();
        const beforeSet = new Set(before);
        const afterSet = new Set(after);

        await mapDbErrors(async () => {
            // DEMOTED: a lecturer not named in the new list. Deleted, not
            // reset to a plain attendee — see the block comment above.
            for (const personId of before.filter((id) => !afterSet.has(id))) {
                await tx.sessionPerson.deleteMany({
                    where: { sessionId: session.id, personId, roleId: lecturerRole.id },
                });
            }

            // ADDED OR CONFIRMED: an `upsert`, because a name already present
            // as a plain attendee (`roleId: null`) has to be PROMOTED — the
            // primary key `(sessionId, personId)` refuses a second row for the
            // same pair, so `create` alone would 409 on exactly that case.
            for (const personId of after.filter((id) => !beforeSet.has(id))) {
                await tx.sessionPerson.upsert({
                    where: { sessionId_personId: { sessionId: session.id, personId } },
                    create: { sessionId: session.id, personId, roleId: lecturerRole.id, tenantId: identity.tenantId },
                    update: { roleId: lecturerRole.id },
                });
            }
        });

        const generationId = await requireBaselineGeneration(tx, identity.tenantId, session.generationId);

        const logged = await appendEvent(tx, identity, {
            type: 'SET_LECTURERS',
            generationId,
            sessionId: session.id,
            payload: { before, after },
            reason: body.reason,
        });

        // Lecturers change who is in the room; a collision can appear or clear.
        await refreshViolations(tx, {
            tenantId: identity.tenantId,
            federationId: identity.federationId,
            sessionIds: [session.id],
            detectedByEventId: logged.id,
            generationId,
        });

        const violations = await tx.constraintViolation.findMany({
            where: { tenantId: identity.tenantId, sessionId: session.id },
        });

        return { session, event: logged, violations };
    });
});
