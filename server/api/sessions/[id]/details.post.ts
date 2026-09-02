import { z } from 'zod';
import { mapDbErrors } from '../../../utils/dbErrors';
import { appendEvent, requireBaselineGeneration } from '../../../utils/sessionEvents';
import { requirePermission } from '../../../utils/requirePermission';
import { withRequestTenant } from '../../../utils/tenantDb';
import { refreshViolations } from '../../../utils/violations';

const bodySchema = z.object({
    title: z.string().min(1).optional(),
    kindId: z.string().min(1).optional(),
    groupIds: z.array(z.string().min(1)).optional(),
    personIds: z.array(z.string().min(1)).optional(),
    reason: z.string().nullish(),
});

defineRouteMeta({
    openAPI: {
        tags: ['Sessions'],
        summary: 'Edit what an event is',
        description: 'Edits the title, kind, groups and people of an EVENT (permission session.update). Offering-linked Sessions are refused with 409: those fields come from the Offering and the solver, so an edit would be silently overwritten by the next apply. Placement is not touched here; that stays on /move. groupIds and personIds replace their whole set when present. Emits an UPDATE_DETAILS audit event carrying before and after for the fields actually changed.',
        parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
            required: true,
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        properties: {
                            title: { type: 'string', description: 'Cannot be cleared; an Event has no Offering to take a name from.' },
                            kindId: { type: 'string' },
                            groupIds: { type: 'array', items: { type: 'string' } },
                            personIds: { type: 'array', items: { type: 'string' } },
                            reason: { type: 'string', nullable: true },
                        },
                    },
                },
            },
        },
        responses: {
            200: {
                description: 'Updated.',
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
            400: { description: 'Attempted to clear the title.' },
            404: { description: 'Session or session kind not found in this tenant.' },
            409: { description: 'The Session belongs to an Offering; only Events can be edited this way.' },
        },
    },
});

/**
 * Edit what an EVENT is: its title, kind, groups and people.
 *
 * WHY A NAMED VERB AND NOT `PATCH /api/sessions/:id`
 *
 * CLAUDE.md's routing convention, which predates this route: editing operations
 * are explicit verbs on the Session resource, "not generic PATCHes, so the event
 * log can record intent, not just a diff". `move` already owns WHERE a Session
 * sits; this owns WHAT it is. A PATCH would collapse both into one row that
 * says only that something changed.
 *
 * WHY ROOM IS NOT HERE
 *
 * Room is already editable: `setRooms()` sends `roomIds` to `/move`, under
 * `session.move`, recorded as a MOVE. Accepting it here too would mean two
 * routes writing `session_room` under two permissions emitting two event types,
 * and a reader of the log would have to know both to reconstruct the room's
 * history.
 *
 * WHY EVENTS ONLY
 *
 * Same reason `DELETE` is Events-only. An Offering-linked Session's `kind_id`
 * is copied from its Offering and its groups and people come from solver
 * output, so a manual edit here would be silently overwritten by the next
 * apply: an edit that appears to work and then undoes itself, which is worse
 * than being refused. 409 rather than 404 so "this is solver-derived" stays
 * distinguishable from "no such Session".
 *
 * PLACEMENT IS NOT TOUCHED, so `fitsGrid()` has nothing to check: week, day,
 * block and duration all stay on `move`, which already guards them. A grid
 * check here would be a guard that can never fail: the kind this codebase
 * treats as worse than none.
 */
export default defineEventHandler(async (event) => {
    const id = getRouterParam(event, 'id');
    const body = await readValidatedBody(event, bodySchema.parse);

    return withRequestTenant(event, async (tx, identity) => {
        await requirePermission(event, tx, 'session.update');

        const session = await tx.session.findFirst({
            where: { id, tenantId: identity.tenantId },
            include: { groups: true, people: true },
        });

        if (!session) {
            throw createError({ statusCode: 404, message: 'Not found.' });
        }

        if (session.offeringId !== null) {
            throw createError({
                statusCode: 409,
                message: 'This Session belongs to an Offering, so its kind, groups and people '
                    + 'come from that Offering and from the solver. Editing them here would be '
                    + 'overwritten by the next apply. Only an Event can be edited this way.',
                data: { offeringId: session.offeringId },
            });
        }

        /**
         * The create route requires a title for an Event, because there is no
         * Offering to borrow a name from. An edit must not be a way around
         * that: `min(1)` refuses an empty string, and this refuses clearing it.
         */
        if (body.title !== undefined && !body.title.trim()) {
            throw createError({
                statusCode: 400,
                message: 'An event needs a name. There is no Offering to take one from.',
                data: { field: 'title' },
            });
        }

        if (body.kindId) {
            // Resolved rather than trusted: the FK alone would accept another
            // tenant's kind.
            const kind = await tx.sessionKind.findFirst({
                where: { id: body.kindId, tenantId: identity.tenantId },
                select: { id: true },
            });

            if (!kind) {
                throw createError({ statusCode: 404, message: 'Session kind not found.' });
            }
        }

        const before = {
            title: session.title,
            kindId: session.kindId,
            groupIds: session.groups.map((link) => link.groupId).sort(),
            personIds: session.people.map((link) => link.personId).sort(),
        };

        const updated = await mapDbErrors(() => tx.session.update({
            where: { id: session.id },
            data: {
                ...(body.title === undefined ? {} : { title: body.title.trim() }),
                ...(body.kindId === undefined ? {} : { kindId: body.kindId }),
            },
        }));

        // Replaced wholesale, like every other set in this codebase: the
        // submitted list is the authority, and diffing would be three code
        // paths where this is one.
        if (body.groupIds) {
            await tx.sessionGroup.deleteMany({ where: { sessionId: session.id } });

            for (const groupId of body.groupIds) {
                await mapDbErrors(() => tx.sessionGroup.create({
                    data: { sessionId: session.id, groupId, tenantId: identity.tenantId },
                }));
            }
        }

        if (body.personIds) {
            await tx.sessionPerson.deleteMany({ where: { sessionId: session.id } });

            for (const personId of body.personIds) {
                await mapDbErrors(() => tx.sessionPerson.create({
                    data: { sessionId: session.id, personId, roleId: null, tenantId: identity.tenantId },
                }));
            }
        }

        const after = {
            title: updated.title,
            kindId: updated.kindId,
            groupIds: (body.groupIds ?? before.groupIds).slice().sort(),
            personIds: (body.personIds ?? before.personIds).slice().sort(),
        };

        const generationId = await requireBaselineGeneration(tx, identity.tenantId, session.generationId);

        /**
         * BEFORE AND AFTER, for the fields the request actually touched.
         *
         * Both halves, because a Generation snapshot describes what exists now
         * and cannot answer "what was this called last week": the same reason
         * a DELETE event carries the placement it removed.
         */
        const changed = (Object.keys(after) as (keyof typeof after)[])
            .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));

        const logged = await appendEvent(tx, identity, {
            type: 'UPDATE_DETAILS',
            generationId,
            sessionId: session.id,
            payload: {
                changed,
                before: Object.fromEntries(changed.map((key) => [key, before[key]])),
                after: Object.fromEntries(changed.map((key) => [key, after[key]])),
            },
            reason: body.reason,
        });

        // Groups and people change WHO is in the room, so collisions can appear
        // or clear. Recomputed in the same transaction, as every editing route
        // does, so persisted violations are never stale relative to the edit.
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

        return { session: updated, event: logged, violations };
    });
});
