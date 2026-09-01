import type { H3Event } from 'h3';
import type { Tx } from './tenantDb';
import type { TenantScopedIdentity } from './tenantResolver';
import { appendEvent, placementOf, requireBaselineGeneration } from './sessionEvents';
import { refreshViolations } from './violations';
import { fitsGrid } from './gridBounds';
import { WEEK_KIND_NAME, classifyWeeks, weekCountOf } from '../../shared/academicCalendar';
import type { WeekKindName } from '../../shared/academicCalendar';
import { isPlacedSession } from '../../shared/sessionPlacement';
import { deriveCapacity } from '../../shared/groupCapacity';

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
    identity: TenantScopedIdentity,
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

/** COUNT-BASED result of {@link assertTeachingComplete}: how much of the module's own teaching plan is actually on the calendar. */
export interface TeachingCompleteness {
    /** `placedCount >= requiredCount`. */
    complete: boolean;
    placedCount: number;
    requiredCount: number;
}

/**
 * Has the module's whole teaching plan actually been PLACED — not whether any
 * of it has already happened.
 *
 * COUNT-BASED, deliberately: it does not matter whether the placed Sessions'
 * dates are in the past or future, only that `offering.frequency` worth of
 * them exist on the calendar. `isPlacedSession` is the one predicate for "has
 * a real placement" — a banked/cancelled Session (issue #22) has
 * `termWeek: null` and must not count as taught.
 *
 * WARN, DON'T BLOCK — same convention as a manual edit's hard-constraint
 * violations: this returns a result rather than throwing, so a caller can
 * surface it as queryable state instead of refusing the request or the
 * approval. An exam on a module whose teaching is not yet fully scheduled is
 * a fact worth showing, not a reason to stop someone.
 *
 * PURE READ, no side effects — safe to call from both the request and the
 * approval routes, and safe to call twice with the same DB state.
 */
export async function assertTeachingComplete(
    tx: Tx,
    tenantId: string,
    offeringId: string,
): Promise<TeachingCompleteness> {
    const offering = await tx.offering.findFirst({
        where: { id: offeringId, tenantId },
        select: { frequency: true },
    });

    // No such Offering is not this function's question to answer — callers
    // that need it to exist already assert that themselves. Reporting
    // "complete" here would be a lie; reporting a fixed 0/0 keeps the shape
    // honest without inventing a verdict.
    if (!offering) {
        return { complete: true, placedCount: 0, requiredCount: 0 };
    }

    const sessions = await tx.session.findMany({
        where: { offeringId, tenantId },
        select: { termWeek: true, dayOfWeek: true, blockIndex: true },
    });

    const placedCount = sessions.filter(isPlacedSession).length;

    return {
        complete: placedCount >= offering.frequency,
        placedCount,
        requiredCount: offering.frequency,
    };
}

/** Result of {@link assertExamRoomCapacity} — a room's exam capacity checked against the expected sitting size. */
export interface ExamCapacityCheck {
    /** False when there is no preferred room, or nothing to compare it against — nothing was actually checked. */
    checked: boolean;
    /** `room.examCapacity ?? room.capacity`. Null when `checked` is false. */
    roomCapacity: number | null;
    /** `Offering.requiredCapacity` if set, else `deriveCapacity()` over the module's attached Groups. Null when underivable. */
    requiredCapacity: number | null;
    /** True whenever nothing was checked, or the room capacity meets the requirement. */
    sufficient: boolean;
}

/**
 * Is the request's preferred room big enough for an exam sitting of this
 * module?
 *
 * EXAM CAPACITY, NOT TEACHING CAPACITY — `Room.examCapacity` exists because
 * exam spacing/invigilation reduces usable seats below a room's normal
 * teaching capacity; `null` there falls back to `Room.capacity`, same as
 * `Offering.requiredCapacity` falling back to a derived number.
 *
 * REUSES `deriveCapacity()`, the same function `assembleSolverInput` already
 * uses for ordinary room-capacity checks: an explicit `Offering.requiredCapacity`
 * wins, otherwise the number is derived from the attached Groups' membership
 * closure. Two independent notions of "how many people" would drift.
 *
 * WARN, DON'T BLOCK — mirrors `materializeExam`'s own room-clash comment
 * ("an approved exam that double-books a room is carried out and the clash is
 * reported"). A too-small room is surfaced on the approval response, not
 * refused: the reviewer already chose to grant the request, and the room was
 * only ever a PREFERENCE (see `ExamRequest.roomId`'s own comment).
 *
 * PURE READ — safe to call repeatedly.
 */
export async function assertExamRoomCapacity(
    tx: Tx,
    tenantId: string,
    offeringId: string,
    roomId: string | null,
): Promise<ExamCapacityCheck> {
    if (!roomId) {
        return { checked: false, roomCapacity: null, requiredCapacity: null, sufficient: true };
    }

    const room = await tx.room.findFirst({
        where: { id: roomId, tenantId },
        select: { capacity: true, examCapacity: true },
    });

    if (!room) {
        return { checked: false, roomCapacity: null, requiredCapacity: null, sufficient: true };
    }

    const roomCapacity = room.examCapacity ?? room.capacity;

    const offering = await tx.offering.findFirst({
        where: { id: offeringId, tenantId },
        select: { requiredCapacity: true, groups: { select: { groupId: true } } },
    });

    if (!offering) {
        return { checked: false, roomCapacity, requiredCapacity: null, sufficient: true };
    }

    let requiredCapacity = offering.requiredCapacity;

    // NULL means "derive it", exactly as it does for the solver's own
    // room-capacity check — never treated as "no requirement".
    if (requiredCapacity === null) {
        const groupIds = offering.groups.map((link) => link.groupId);

        const [groups, memberships] = await Promise.all([
            tx.group.findMany({ where: { tenantId }, select: { id: true, parentGroupId: true, expectedSize: true } }),
            tx.membership.findMany({ where: { tenantId }, select: { groupId: true, personId: true } }),
        ]);

        requiredCapacity = deriveCapacity(groupIds, groups, memberships).capacity;
    }

    return {
        checked: requiredCapacity !== null,
        roomCapacity,
        requiredCapacity,
        sufficient: requiredCapacity === null || roomCapacity >= requiredCapacity,
    };
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
    identity: TenantScopedIdentity,
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

/**
 * What KIND of week each `termWeek` in a Term is.
 *
 * WHY THE EXAM FLOW NEEDS THIS AT ALL. An approved exam is a locked Event, and
 * the solver never places an Event — so `MinimizeExamWeek`, the rule whose whole
 * job is steering sessions relative to the exam period, cannot reach it. The
 * lecturer's chosen week IS the final answer, which makes "is that week actually
 * the exam period" a question the UI has to answer rather than the objective.
 *
 * It also answers the thing `#6` recorded as an open solver question. "Exams
 * ideally near term-end" needs no weighting: an institution says where its
 * term-end assessment window is by declaring an EXAM calendar period, and that
 * declaration is right here.
 *
 * ADVISORY, NEVER A GATE. A Nachklausur legitimately sits in an ordinary
 * teaching week — the real timetable this project's demo data came from is full
 * of them — so refusing a non-exam week would forbid a thing institutions
 * actually do. Warn and allow, as everywhere else.
 */
export async function classifyTermWeeks(
    tx: Tx,
    tenantId: string,
    termId: string,
): Promise<{ week: number; kind: WeekKindName }[]> {
    const term = await tx.term.findFirst({
        where: { id: termId, tenantId },
        select: { startDate: true, endDate: true, calendarPeriods: true },
    });

    if (!term) {
        return [];
    }

    return classifyWeeks(term.startDate, term.endDate, term.calendarPeriods).map((week) => ({
        // `termWeek` in the database is 1-based; `ClassifiedWeek.index` is not.
        week: week.index + 1,
        kind: WEEK_KIND_NAME[week.kind] ?? 'UNSPECIFIED',
    }));
}
