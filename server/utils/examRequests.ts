import type { H3Event } from 'h3';
import type { Tx } from './tenantDb';
import type { RequestIdentity } from './tenantResolver';
import { appendEvent, placementOf, requireBaselineGeneration } from './sessionEvents';
import { refreshViolations } from './violations';
import { fitsGrid } from './gridBounds';
import { weekCountOf } from '../../shared/academicCalendar';

/**
 * The rules behind a lecturer's exam request, in one place because four routes
 * ask the same three questions and a fifth will.
 *
 * WHY THIS IS NOT `POST /api/sessions` WITH A NARROWER GATE. That route creates
 * a Session anywhere, for anyone, immediately. The whole point of the exam flow
 * is that a lecturer creates NOTHING until somebody decides — so the request is
 * a different object with a different lifetime, and the Session only exists on
 * the far side of an approval.
 */

/** An Offering the acting Person LEADS. Nothing else is "mine". */
export async function assertLeadsOffering(
    tx: Tx,
    identity: RequestIdentity,
    offeringId: string,
    termId: string,
): Promise<{ id: string; title: string }> {
    /*
     * `actorPersonId` is null for a screen key and for the poller, and
     * `heldPermissions()` already refuses those. Checked again here rather than
     * assumed: this function decides ownership, and "no acting person" must
     * never resolve to "leads everything" through an `undefined` filter.
     */
    if (!identity.actorPersonId) {
        throw createError({ statusCode: 403, statusMessage: 'Only a signed-in person can request an exam.' });
    }

    const offering = await tx.offering.findFirst({
        where: {
            id: offeringId,
            tenantId: identity.tenantId,
            termId,
            lecturers: { some: { personId: identity.actorPersonId } },
        },
        select: { id: true, title: true },
    });

    /*
     * 404, not 403, and deliberately the same answer as "no such Offering". A
     * distinct 403 would turn this route into a way to enumerate which modules
     * exist and who leads them, which is more than the holder of
     * `exam.request_own` is being given.
     */
    if (!offering) {
        throw createError({
            statusCode: 404,
            statusMessage: 'No module you lead in this term has that id.',
        });
    }

    return offering;
}

/**
 * The kind must be one the tenant has classified as an EXAM.
 *
 * Not a database CHECK because it is a cross-row condition, and not optional
 * because the whole feature depends on it: `exam_spacing_same_day` and
 * `exam_spacing_window` derive their scope from `SessionKind.type`, so an exam
 * recorded under a TEACHING kind is a Session no exam rule can see. It would
 * look right on the timetable and be invisible to every rule meant to govern
 * it.
 */
export async function assertExamKind(tx: Tx, tenantId: string, kindId: string) {
    const kind = await tx.sessionKind.findFirst({
        where: { id: kindId, tenantId },
        select: { id: true, name: true, type: true },
    });

    if (!kind) {
        throw createError({ statusCode: 404, statusMessage: 'Session kind not found.' });
    }

    if (kind.type !== 'EXAM') {
        throw createError({
            statusCode: 422,
            statusMessage: `'${kind.name}' is not an exam kind, so the exam rules would not apply `
                + 'to anything created under it. Set that kind’s type to Exam, or choose one '
                + 'already marked as an exam.',
            data: { field: 'kindId', type: kind.type },
        });
    }

    return kind;
}

export interface ExamPlacement {
    termWeek: number;
    dayOfWeek: number;
    blockIndex: number;
    durationBlocks: number;
}

/**
 * The placement resolves to real slots in the term's own grid.
 *
 * Same two guards `POST /api/sessions` applies, for the same reason: zod cannot
 * know how many blocks a tenant's grid has or which days it teaches, and a
 * placement outside that space is not a constraint violation to warn about — it
 * is a placement that resolves to no slot at all.
 */
export async function assertPlacementFits(
    tx: Tx,
    tenantId: string,
    term: { id: string; timeGridId: string | null; startDate: Date; endDate: Date },
    placement: ExamPlacement,
) {
    const weeks = weekCountOf(term.startDate, term.endDate);

    if (placement.termWeek > weeks) {
        throw createError({
            statusCode: 409,
            statusMessage: `Week ${placement.termWeek} is outside the term, which has ${weeks} weeks.`,
            data: { termWeek: placement.termWeek, weeks },
        });
    }

    // Named rather than filtered: a null `timeGridId` in a Prisma `id` filter
    // degrades to no guard at all instead of failing.
    const grid = term.timeGridId
        ? await tx.timeGrid.findFirst({
            where: { id: term.timeGridId, tenantId },
            select: { name: true, blocksPerDay: true, activeDays: true },
        })
        : null;

    if (grid && !fitsGrid(placement, grid)) {
        throw createError({
            statusCode: 409,
            statusMessage: `Day ${placement.dayOfWeek} block ${placement.blockIndex}`
                + `${placement.durationBlocks > 1 ? ` (${placement.durationBlocks} blocks)` : ''}`
                + ` is not a slot in '${grid.name}', which has ${grid.blocksPerDay} blocks`
                + ` on days ${grid.activeDays.join(', ')}.`,
            data: { ...placement, blocksPerDay: grid.blocksPerDay, activeDays: grid.activeDays },
        });
    }
}

/**
 * Turn an approved request into the exam itself.
 *
 * AN EVENT, NEVER A SESSION ON THE MODULE'S OFFERING, and this is the decision
 * the whole feature rests on. `ExactFrequency` is HARD: the solver expects
 * exactly `offering.frequency` Sessions for an Offering, so an extra one is
 * either deleted by the next apply or reported as violating the module's own
 * demand. An Event — `offeringId` NULL — is structurally out of every solve's
 * scope, because `planMaterialization` tests `inScope.has(s.offeringId)` and
 * `inScope` is a Set of ids.
 *
 * IT CARRIES THE MODULE'S GROUPS, which is what makes the exam rules reach it
 * at all: `exam_spacing_same_day` and `exam_spacing_window` are per-Group
 * aggregates over placements, so an exam attached to nobody is an exam no
 * spacing rule can space.
 *
 * Locked on top of the structural exemption — belt and braces, and the lock is
 * the weaker of the two since it is one UPDATE away from being cleared.
 */
export async function materializeExam(
    event: H3Event,
    tx: Tx,
    identity: RequestIdentity,
    request: {
        id: string;
        offeringId: string;
        termId: string;
        kindId: string;
        roomId: string | null;
        requestedByPersonId: string | null;
    } & ExamPlacement,
): Promise<{ sessionId: string }> {
    const offering = await tx.offering.findFirstOrThrow({
        where: { id: request.offeringId, tenantId: identity.tenantId },
        select: { id: true, title: true, groups: { select: { groupId: true } } },
    });
    const term = await tx.term.findFirstOrThrow({
        where: { id: request.termId, tenantId: identity.tenantId },
        select: { id: true, timeGridId: true },
    });

    const generationId = await requireBaselineGeneration(tx, identity.tenantId, null);

    const created = await tx.session.create({
        data: {
            tenantId: identity.tenantId,
            termId: term.id,
            kindId: request.kindId,
            // The whole point — see this function's own comment.
            offeringId: null,
            // An Event has nothing else to be called, and "Klausur" alone does
            // not distinguish two exams in one week.
            title: offering.title,
            timeGridId: term.timeGridId,
            termWeek: request.termWeek,
            dayOfWeek: request.dayOfWeek,
            blockIndex: request.blockIndex,
            durationBlocks: request.durationBlocks,
            isLocked: true,
            // Placed by a human, not by a Generation. Saying otherwise would
            // make provenance a lie.
            generationId: null,
        },
    });

    if (request.roomId) {
        await tx.sessionRoom.create({
            data: { tenantId: identity.tenantId, sessionId: created.id, roomId: request.roomId },
        });
    }

    for (const link of offering.groups) {
        await tx.sessionGroup.create({
            data: { tenantId: identity.tenantId, sessionId: created.id, groupId: link.groupId },
        });
    }

    if (request.requestedByPersonId) {
        await tx.sessionPerson.create({
            data: {
                tenantId: identity.tenantId,
                sessionId: created.id,
                personId: request.requestedByPersonId,
                roleId: null,
            },
        });
    }

    const logged = await appendEvent(tx, identity, {
        type: 'CREATE',
        generationId,
        sessionId: created.id,
        payload: {
            to: {
                ...placementOf(created),
                roomIds: request.roomId ? [request.roomId] : [],
                groupIds: offering.groups.map((g) => g.groupId),
                personIds: request.requestedByPersonId ? [request.requestedByPersonId] : [],
            },
            offeringId: null,
            title: offering.title,
            kindId: request.kindId,
            isLocked: true,
            isEvent: true,
            // The provenance that makes this Event explicable later: an Event
            // otherwise records no reason for existing, and "why is there a
            // locked Session nobody scheduled" has an answer here.
            examRequestId: request.id,
            examForOfferingId: offering.id,
        },
        reason: `Exam approved for ${offering.title}`,
    });

    // WARN AND ALLOW: an approved exam that double-books a room is carried out
    // and the clash is reported, exactly as a manual placement is. Refusing
    // here would make the decision fail for a reason the decider cannot fix
    // from the review screen.
    await refreshViolations(tx, {
        tenantId: identity.tenantId,
        federationId: identity.federationId,
        sessionIds: [created.id],
        detectedByEventId: logged.id,
        generationId,
    });

    return { sessionId: created.id };
}
