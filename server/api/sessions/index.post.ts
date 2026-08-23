import { z } from 'zod';
import { mapDbErrors } from '../../utils/dbErrors';
import { appendEvent, placementOf, requireBaselineGeneration } from '../../utils/sessionEvents';
import { requirePermission } from '../../utils/requirePermission';
import { withRequestTenant } from '../../utils/tenantDb';
import { refreshViolations } from '../../utils/violations';
import { fitsGrid } from '../../utils/gridBounds';
import { weekCountOf } from '../../../shared/academicCalendar';

const bodySchema = z.object({
    termId: z.string().min(1),
    kindId: z.string().min(1),
    termWeek: z.number().int().min(1),
    dayOfWeek: z.number().int().min(1).max(7),
    blockIndex: z.number().int().min(0),
    durationBlocks: z.number().int().min(1).default(1),

    /**
     * Absent or null makes this an EVENT (TAXONOMY.md §2): a placement with no
     * recurring demand behind it. Not merely "optional" — the null case is the
     * feature, and it is what keeps the Session out of every solve's scope.
     */
    offeringId: z.string().min(1).nullish(),

    roomIds: z.array(z.string().min(1)).default([]),
    groupIds: z.array(z.string().min(1)).default([]),
    /** Lecturers and other directly-assigned people both land in session_person. */
    lecturerIds: z.array(z.string().min(1)).default([]),
    personIds: z.array(z.string().min(1)).default([]),

    /**
     * Defaults to LOCKED. See the block comment below — this is defence in
     * depth, not the primary protection.
     */
    isLocked: z.boolean().default(true),

    reason: z.string().nullish(),
});

/**
 * Create a Session directly, without a solver run.
 *
 * This is the FIRST create path in the app — until now every Session came from
 * `materializeGeneration()`. Two things follow from that, and both are the
 * reason this route is not a generic CRUD entry in `RESOURCES`.
 *
 * WHY AN EVENT IS SAFE FROM A LATER SOLVE
 *
 * `planMaterialization()` deletes everything in scope the solver did not return:
 *
 *     !keptIds.has(s.id) && !s.isLocked && inScope.has(s.offeringId)
 *
 * `inScope` is a Set of offering ids, so for an Event — `offeringId` NULL —
 * `inScope.has(null)` is false and the Session is STRUCTURALLY unreachable by
 * that partition. It cannot be swept up by a solve that never knew about it.
 *
 * `isLocked` defaults to true on top of that, but note which guarantee is doing
 * the work: the lock is one UPDATE away from being cleared, whereas the missing
 * Offering is a property of what the row IS. A caller who unlocks an Event still
 * keeps the structural exemption.
 *
 * The lock matters more for the OTHER case this route allows: a Session created
 * WITH an `offeringId`. That one is in scope by default (a run with no explicit
 * `offeringIds` takes every Offering in the term), so without the lock the next
 * apply would move it or delete it. Creating one unlocked is permitted and is a
 * deliberate choice by the caller — "let the solver own this from now on".
 *
 * WHY THE GRID GUARD IS THE SAME ONE `move` USES
 *
 * A created placement outside the grid's index space is exactly the defect
 * `fitsGrid()` exists to prevent, and the zod schema cannot catch it: blockIndex
 * has no upper bound it could know, and dayOfWeek is 1..7 regardless of which
 * days the tenant actually teaches. Refused rather than warned — this is not a
 * constraint violation on a placement, it is a placement resolving to no slot.
 *
 * WARN AND ALLOW still applies to everything else (TAXONOMY.md §3): a creation
 * that double-books a room is carried out, and the violation is returned.
 */
export default defineEventHandler(async (event) => {
    const body = await readValidatedBody(event, bodySchema.parse);

    return withRequestTenant(event, async (tx, identity) => {
        await requirePermission(event, tx, 'session.create');

        const term = await tx.term.findFirst({
            where: { id: body.termId, tenantId: identity.tenantId },
            select: { id: true, timeGridId: true, startDate: true, endDate: true },
        });

        if (!term) {
            throw createError({ statusCode: 404, statusMessage: 'Term not found.' });
        }

        // Resolved rather than trusted: a kind from another tenant would be a
        // cross-tenant reference the FK alone would happily accept.
        const kind = await tx.sessionKind.findFirst({
            where: { id: body.kindId, tenantId: identity.tenantId },
            select: { id: true },
        });

        if (!kind) {
            throw createError({ statusCode: 404, statusMessage: 'Session kind not found.' });
        }

        /**
         * An Offering, when given, must belong to the SAME term. Without this
         * the FK would accept a cross-term Offering and the Session would sit
         * in a term whose solve never considers it — an orphan that looks
         * placed. `planMaterialization()` already counts this shape as
         * `placementsUnmapped` coming the other way.
         */
        if (body.offeringId) {
            const offering = await tx.offering.findFirst({
                where: { id: body.offeringId, tenantId: identity.tenantId, termId: term.id },
                select: { id: true },
            });

            if (!offering) {
                throw createError({
                    statusCode: 404,
                    statusMessage: 'Offering not found in this term.',
                });
            }
        }

        /**
         * `Term` stores dates, not a week count — the count is DERIVED, and
         * `weekCountOf` is the same function the solver calendar and the
         * calendar-period editor use. Computing it locally here (end - start
         * over 7) would be a fourth definition of "which week is this", and
         * TimeGrid already demonstrated what happens when that number has more
         * than one implementation.
         */
        const weeks = weekCountOf(term.startDate, term.endDate);

        if (body.termWeek > weeks) {
            throw createError({
                statusCode: 409,
                statusMessage: `Week ${body.termWeek} is outside the term, which has ${weeks} weeks.`,
                data: { termWeek: body.termWeek, weeks },
            });
        }

        const target = {
            dayOfWeek: body.dayOfWeek,
            blockIndex: body.blockIndex,
            durationBlocks: body.durationBlocks,
        };

        // Named rather than filtered, for the reason move.post.ts gives: a null
        // timeGridId passed to a Prisma `id` filter degrades to "no guard at
        // all" instead of failing.
        const grid = term.timeGridId
            ? await tx.timeGrid.findFirst({
                where: { id: term.timeGridId, tenantId: identity.tenantId },
                select: { name: true, blocksPerDay: true, activeDays: true },
            })
            : null;

        if (grid && !fitsGrid(target, grid)) {
            throw createError({
                statusCode: 409,
                statusMessage: `Day ${target.dayOfWeek} block ${target.blockIndex}`
                    + `${target.durationBlocks > 1 ? ` (${target.durationBlocks} blocks)` : ''}`
                    + ` is not a slot in '${grid.name}', which has ${grid.blocksPerDay} blocks`
                    + ` on days ${grid.activeDays.join(', ')}.`,
                data: { ...target, blocksPerDay: grid.blocksPerDay, activeDays: grid.activeDays },
            });
        }

        const generationId = await requireBaselineGeneration(tx, identity.tenantId, null);

        const created = await mapDbErrors(() =>
            tx.session.create({
                data: {
                    tenantId: identity.tenantId,
                    termId: term.id,
                    kindId: kind.id,
                    offeringId: body.offeringId ?? null,
                    timeGridId: term.timeGridId,
                    termWeek: body.termWeek,
                    dayOfWeek: body.dayOfWeek,
                    blockIndex: body.blockIndex,
                    durationBlocks: body.durationBlocks,
                    isLocked: body.isLocked,
                    /**
                     * Deliberately NOT attributed to `generationId`. The
                     * baseline above is what the EVENT hangs off — an event
                     * with no baseline cannot be replayed — but the Session
                     * itself did not come from that Generation, and saying it
                     * did would make provenance a lie. Null reads as "placed by
                     * a human", which is exactly what happened.
                     */
                    generationId: null,
                },
            }),
        );

        for (const roomId of body.roomIds) {
            await mapDbErrors(() =>
                tx.sessionRoom.create({
                    data: { sessionId: created.id, roomId, tenantId: identity.tenantId },
                }),
            );
        }

        for (const groupId of body.groupIds) {
            await mapDbErrors(() =>
                tx.sessionGroup.create({
                    data: { sessionId: created.id, groupId, tenantId: identity.tenantId },
                }),
            );
        }

        // Lecturers and directly-assigned people are the same table; deduped so
        // a person named in both lists does not violate the composite PK.
        for (const personId of [...new Set([...body.lecturerIds, ...body.personIds])]) {
            await mapDbErrors(() =>
                tx.sessionPerson.create({
                    data: { sessionId: created.id, personId, roleId: null, tenantId: identity.tenantId },
                }),
            );
        }

        /**
         * The first CREATE event this system has ever emitted. `materializeGeneration()`
         * writes no per-session events at all — the Generation snapshot is the
         * record for solver-originated Sessions — so there was no existing shape
         * to match, and this one mirrors MOVE's `to` half so replay stays
         * uniform across event types.
         */
        const logged = await appendEvent(tx, identity, {
            type: 'CREATE',
            generationId,
            sessionId: created.id,
            payload: {
                to: {
                    ...placementOf(created),
                    roomIds: body.roomIds,
                    groupIds: body.groupIds,
                    personIds: [...new Set([...body.lecturerIds, ...body.personIds])],
                },
                offeringId: body.offeringId ?? null,
                kindId: kind.id,
                isLocked: body.isLocked,
                isEvent: !body.offeringId,
            },
            reason: body.reason,
        });

        await refreshViolations(tx, {
            tenantId: identity.tenantId,
            federationId: identity.federationId,
            sessionIds: [created.id],
            detectedByEventId: logged.id,
            generationId,
        });

        const violations = await tx.constraintViolation.findMany({
            where: { tenantId: identity.tenantId, sessionId: created.id },
        });

        setResponseStatus(event, 201);

        return { session: created, event: logged, violations };
    });
});
