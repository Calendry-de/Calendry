import type { ConstraintViolation, PlacedSession, SolverOutput } from '@calendry-de/calendry-proto';
import type { Tx } from './tenantDb';
import { LECTURER_ROLE_KEY } from '../../shared/roles';
import { appendEvent } from './sessionEvents';
import { fromWireWeek } from './solverSessions';
import { parseWireOfferingId } from './offeringSplit';

/**
 * Turning a solver result into real Session rows, split into a PLAN (reads only)
 * and an EXECUTE (writes).
 *
 * AT APPLY, NOT AT CAPTURE: `/api/sessions` never filters by generation, so a
 * Session appears on the live schedule the moment it exists. Writing placements
 * at capture would mean "review before apply" reviews a schedule that has already
 * changed. Placements stay in `solver_run.result` until someone applies.
 *
 * THE PLAN IS SEPARATE so the review screen can answer "what will this do?" with
 * the same code the apply uses — computing it twice would let the preview lie with
 * nothing to catch it. It is a SNAPSHOT, not a promise: a manual edit in between
 * legitimately changes the outcome, which is what `computedAt` is for.
 */

/** One placement the solver returned, resolved against what already exists. */
export interface PlannedPlacement {
    action: 'create' | 'move' | 'unchanged';
    /** Null when the solver invented this Session — there is no row yet. */
    sessionId: string | null;
    offeringId: string;
    placement: Placement;
    /** Where it currently sits. Null for a create; the diff view needs it. */
    previous: Placement | null;
    roomId: string | null;
    /**
     * The FULL Room set, `roomId` included.
     *
     * The wire leaves `PlacedSession.room_ids` empty for an ordinary
     * single-Room placement — `room_id` is already the complete answer there —
     * so this normalises both shapes into one list the apply can write without
     * a branch. Writing only `roomId` would silently drop the extra Rooms of
     * every multi-Room placement the solver just learned to produce.
     */
    roomIds: string[];
    /**
     * Whether the solver had authority over this Session's attendees.
     *
     * FALSE for a Session it moved from OUTSIDE the scope. Such a Session
     * reaches the solver as a movable `PlacementVar`, which deliberately
     * carries no lecturer/group/attendee snapshot — the search reads those from
     * the Offering's current definition. So the lists that come back are the
     * OFFERING's, not the Session's, and a Session whose attendees were
     * overridden through `sessions/[id]/details.post.ts` would have that
     * override silently rewritten by a repair that only meant to move it.
     *
     * A repair moves Sessions; it does not re-cast them.
     */
    attendeesAreAuthoritative: boolean;
    groupIds: string[];
    lecturerIds: string[];
    personIds: string[];
}

export interface Placement {
    termWeek: number;
    dayOfWeek: number;
    blockIndex: number;
    durationBlocks: number;
}

export interface PlannedDelete {
    sessionId: string;
    /**
     * Never NULL in practice — the delete filter requires `inScope.has(...)`,
     * which an Event's NULL offering can never satisfy — but typed nullable
     * because the column is. Narrowing it here would be a lie the compiler
     * could not check.
     */
    offeringId: string | null;
    placement: Placement;
}

export interface PlanCounts {
    created: number;
    /** Returned with a DIFFERENT placement than it had. */
    moved: number;
    /**
     * The subset of `moved` the caller did NOT ask for — Sessions of Offerings
     * outside the run's scope, which only a `LOCK_POLICY_MINIMIZE_MOVEMENT` run
     * can produce.
     *
     * Reported because it is the mode working, not a fault, and therefore the
     * one thing about a repair a reviewer cannot infer: "6 moved" reads as six
     * consequences of what they asked for. Applying a repair that quietly
     * reshuffles an untouched cohort is precisely the surprise warn-and-allow
     * exists to prevent, so the plan says how many of the moves were the
     * solver's idea. Always 0 under a hard lock, where out-of-scope Sessions are
     * never returned at all.
     */
    movedCollateral: number;
    /**
     * Returned at the placement it already had.
     *
     * Separated from `moved` because the apply report is read by a human: a
     * solver that reproduces the existing timetable would otherwise say "48
     * moved" and invite someone to go looking for 48 changes that do not exist.
     */
    unchanged: number;
    deleted: number;
    skippedLocked: number;
    /**
     * Placements that cannot be written at all — the Offering is not in this
     * term, or the placement carries no slot.
     *
     * Split out from `violationsUnmapped` in Stage 6a. The two were one counter
     * and have nothing in common: this is a PLACEMENT that cannot be stored,
     * that is a VIOLATION that cannot be attached to a row. Different causes,
     * different fixes, and merging them made both unreadable.
     */
    placementsUnmapped: number;
}

export interface MaterializationPlan {
    placements: PlannedPlacement[];
    deletes: PlannedDelete[];
    /** Ids of locked Sessions, which are never touched. */
    skippedLocked: string[];
    counts: PlanCounts;
}

export interface MaterializeCounts extends PlanCounts {
    violationsSession: number;
    violationsOffering: number;
    /** Violations naming a Session or Offering that could not be resolved. */
    violationsUnmapped: number;
}

function samePlacement(a: Placement, b: Placement): boolean {
    return a.termWeek === b.termWeek
        && a.dayOfWeek === b.dayOfWeek
        && a.blockIndex === b.blockIndex
        && a.durationBlocks === b.durationBlocks;
}

/**
 * Decides what applying this output would do. Reads the database; writes nothing.
 *
 * THE THREE-WAY PARTITION:
 *
 *   session_id empty            create — the solver invented this Session
 *   session_id matches a row    move   — same Session, new placement
 *   existing in-scope, absent   DELETE — the solver chose not to place it
 *
 * That last case is deliberate: leaving unreturned Sessions where they were would
 * mean the applied schedule contains placements the solver rejected while
 * `frequency` appears satisfied. It is recoverable through the event log.
 *
 * LOCKED SESSIONS ARE NEVER TOUCHED — they were sent as immovable fixtures, so the
 * answer was computed on the assumption they would not move.
 */
export async function planMaterialization(tx: Tx, options: {
    tenantId: string;
    termId: string;
    output: SolverOutput;
    /** Offerings the run was allowed to place. Anything else is out of scope. */
    scopeOfferingIds: string[];
    /** Set when the tenant belongs to a Federation, so shared Sessions are seen. */
    federationId?: string | null;
}): Promise<MaterializationPlan> {
    const { tenantId, federationId = null, termId, output, scopeOfferingIds } = options;

    const inScope = new Set(scopeOfferingIds);

    /**
     * TWO SETS: `visible` is everything this tenant can see, including
     * Federation-shared Sessions, so the plan is aware of them; `existing` is the
     * tenant-owned subset and the only thing the plan may move or delete.
     *
     * One set would be the dangerous version: a member tenant's run would treat a
     * shared Session it did not return as an orphan and delete another tenant's
     * event. RLS would refuse the write, but the intent would already be wrong.
     */
    const visible = await tx.session.findMany({
        where: {
            termId,
            OR: [
                { tenantId },
                ...(federationId ? [{ federationId }] : []),
            ],
        },
        select: {
            id: true, tenantId: true, offeringId: true, isLocked: true,
            termWeek: true, dayOfWeek: true, blockIndex: true, durationBlocks: true,
        },
    });

    // Tenant-keyed explicitly rather than by absence: `tenantId === options
    // .tenantId` is the ownership test, and nothing else may be mutated.
    const existing = visible.filter((session) => session.tenantId === tenantId);

    const existingById = new Map(existing.map((s) => [s.id, s]));

    // Kind is per-Offering; the wire carries the kind KEY on each placement but
    // the Session column is a foreign key, so it is resolved from the Offering
    // rather than looked up by string.
    const offerings = await tx.offering.findMany({
        where: { tenantId, termId },
        select: { id: true, kindId: true, durationBlocks: true },
    });
    const offeringById = new Map(offerings.map((o) => [o.id, o]));

    const placements: PlannedPlacement[] = [];
    const skippedLocked = existing.filter((s) => s.isLocked).map((s) => s.id);
    const keptIds = new Set<string>(skippedLocked);

    let placementsUnmapped = 0;

    for (const placed of output.sessions) {
        /**
         * UN-SPLIT FIRST, ALWAYS. A multi-group Offering is sent as one wire
         * Offering per Group under a synthetic `offering::group` id and the output
         * echoes it back; every id from here on must be the REAL one. Reversal
         * happens here and in the violation mapper, nowhere else, and an id that
         * cannot be reversed with confidence is counted as unmapped rather than
         * attached to a guess.
         */
        const parsed = parseWireOfferingId(placed.offeringId);

        if (parsed.ambiguous) {
            placementsUnmapped++;

            continue;
        }

        const offering = offeringById.get(parsed.offeringId);

        // A placement for an Offering this term does not have cannot be written
        // — the FK would reject it. Counted rather than thrown: one bad
        // placement should not abandon an otherwise good apply.
        if (!offering || !placed.startSlot) {
            placementsUnmapped++;

            continue;
        }

        const current = placed.sessionId ? existingById.get(placed.sessionId) : undefined;

        // The solver was told this one could not move; its own output should
        // agree, but the app does not rely on that.
        if (current?.isLocked) {
            continue;
        }

        const placement: Placement = {
            termWeek: fromWireWeek(placed.startSlot.week),
            dayOfWeek: placed.startSlot.day,
            blockIndex: placed.startSlot.block,
            durationBlocks: placed.durationBlocks || offering.durationBlocks,
        };

        const previous: Placement | null = current
            ? {
                termWeek: current.termWeek,
                dayOfWeek: current.dayOfWeek,
                blockIndex: current.blockIndex,
                durationBlocks: current.durationBlocks,
            }
            : null;

        placements.push({
            action: !current
                ? 'create'
                : samePlacement(placement, previous!) ? 'unchanged' : 'move',
            sessionId: current?.id ?? null,
            offeringId: parsed.offeringId,
            placement,
            previous,
            roomId: placed.roomId || null,
            /*
             * KEYED ON SCOPE, not on the run's mode. Under `LOCK_POLICY_HARD` an
             * out-of-scope Session is never returned at all, so this can only be
             * false under a minimize-movement run — but writing the test as
             * "is it a repair?" would put the run's mode into a function that
             * has never needed it, and would be wrong the moment a rebuild
             * narrows its scope.
             */
            attendeesAreAuthoritative: !current || inScope.has(parsed.offeringId),
            // Non-empty ONLY for a genuine multi-Room placement; the singular
            // field carries the ordinary case. Deduplicated because the wire's
            // full set includes `room_id`, and a duplicate would violate
            // `session_room`'s composite primary key.
            roomIds: [...new Set(
                placed.roomIds.length > 0 ? placed.roomIds : [placed.roomId],
            )].filter(Boolean),
            groupIds: placed.groupIds,
            lecturerIds: placed.lecturerIds,
            personIds: placed.personIds,
        });

        if (current) {
            keptIds.add(current.id);
        }
    }

    /**
     * Everything in scope that the solver did not return. Locked Sessions and
     * Sessions of out-of-scope Offerings are excluded — the solver was never
     * asked about those and its silence says nothing.
     */
    const deletes: PlannedDelete[] = existing
        .filter((s) => {
            /**
             * An EVENT is never deleted by an apply. Stated as its own clause
             * rather than left to `inScope.has(null)` returning false — that
             * would be an exemption that WORKS but is invisible, and the next
             * person to change `inScope` into something that tolerates null
             * (a list, a predicate, a widened Set) would silently start
             * deleting Events with no test naming what broke.
             *
             * TAXONOMY.md §2: an Event is placed by a human and belongs to no
             * demand, so a solver's silence about it says nothing at all.
             */
            if (s.offeringId === null) {
                return false;
            }

            return !keptIds.has(s.id) && !s.isLocked && inScope.has(s.offeringId);
        })
        .map((s) => ({
            sessionId: s.id,
            offeringId: s.offeringId,
            placement: {
                termWeek: s.termWeek,
                dayOfWeek: s.dayOfWeek,
                blockIndex: s.blockIndex,
                durationBlocks: s.durationBlocks,
            },
        }));

    return {
        placements,
        deletes,
        skippedLocked,
        counts: {
            created: placements.filter((p) => p.action === 'create').length,
            moved: placements.filter((p) => p.action === 'move').length,
            // Derived from the same list as `moved` rather than counted
            // alongside it, so the subset relationship cannot drift: a
            // collateral move is a move whose Offering nobody put in scope.
            movedCollateral: placements
                .filter((p) => p.action === 'move' && !inScope.has(p.offeringId)).length,
            unchanged: placements.filter((p) => p.action === 'unchanged').length,
            deleted: deletes.length,
            skippedLocked: skippedLocked.length,
            placementsUnmapped,
        },
    };
}

export interface WeekSummaryRow {
    termWeek: number;
    created: number;
    moved: number;
    unchanged: number;
    deleted: number;
}

/**
 * The plan's changes bucketed by term week.
 *
 * A review screen renders one week at a time — the payload for a whole term can
 * be a thousand placements — which leaves a reviewer clicking through nineteen
 * weeks to find the three that changed. This is the index that makes the week
 * picker able to say where the changes are.
 *
 * Derived from the plan rather than queried: it is the same decision, counted a
 * second way, so it cannot disagree with the numbers beside it.
 */
export function summarizePlanByWeek(plan: MaterializationPlan): WeekSummaryRow[] {
    const byWeek = new Map<number, WeekSummaryRow>();

    const row = (termWeek: number) => {
        const existing = byWeek.get(termWeek)
            ?? { termWeek, created: 0, moved: 0, unchanged: 0, deleted: 0 };

        byWeek.set(termWeek, existing);

        return existing;
    };

    // The action names and the count names differ by design — `create` is what
    // happens, `created` is how many — so the mapping is explicit rather than
    // an index that happens to line up.
    const KEY = { create: 'created', move: 'moved', unchanged: 'unchanged' } as const;

    for (const placement of plan.placements) {
        row(placement.placement.termWeek)[KEY[placement.action]]++;
    }

    // A deletion belongs to the week it currently occupies — that is where a
    // reviewer will look for the session that is about to vanish.
    for (const del of plan.deletes) {
        row(del.placement.termWeek).deleted++;
    }

    return [...byWeek.values()].sort((a, b) => a.termWeek - b.termWeek);
}

/**
 * Performs exactly what the plan says, then records the run's residual
 * violations.
 *
 * Takes the plan rather than recomputing it, so that what a preview showed and
 * what an apply did are the same decision rather than two that happen to agree.
 */
export async function executePlan(tx: Tx, plan: MaterializationPlan, options: {
    tenantId: string;
    termId: string;
    generationId: string;
    violations: ConstraintViolation[];
    /** Who to attribute the DELETE events to. Null for a background apply. */
    actorPersonId: string | null;
}): Promise<MaterializeCounts> {
    const { tenantId, termId, generationId, violations, actorPersonId } = options;

    const offerings = await tx.offering.findMany({
        where: { tenantId, termId },
        select: { id: true, kindId: true },
    });
    const kindByOffering = new Map(offerings.map((o) => [o.id, o.kindId]));

    const lecturerRole = await tx.role.findFirst({
        where: { tenantId, key: LECTURER_ROLE_KEY },
        select: { id: true },
    });

    for (const planned of plan.placements) {
        const placement = { ...planned.placement, generationId };

        const sessionId = planned.sessionId
            ? (await tx.session.update({ where: { id: planned.sessionId }, data: placement })).id
            : (await tx.session.create({
                data: {
                    tenantId,
                    termId,
                    offeringId: planned.offeringId,
                    kindId: kindByOffering.get(planned.offeringId)!,
                    ...placement,
                },
            })).id;

        /*
         * Join rows are replaced wholesale rather than diffed: the placement is
         * the authority on who and what is involved, and a diff would be three
         * code paths where this is one.
         *
         * EXCEPT WHERE IT IS NOT THE AUTHORITY. Rooms always are — the solver
         * chose the room, that is what moving a Session means. Attendees are
         * not, for a Session moved from outside the scope: see
         * `attendeesAreAuthoritative`. Those rows are left exactly as they were,
         * which is the only way a per-Session override survives a repair.
         */
        await tx.sessionRoom.deleteMany({ where: { sessionId } });

        if (planned.attendeesAreAuthoritative) {
            await Promise.all([
                tx.sessionPerson.deleteMany({ where: { sessionId } }),
                tx.sessionGroup.deleteMany({ where: { sessionId } }),
            ]);
        }

        // EVERY Room, not just the primary. `session_room` is a join table and
        // always could hold several; until the solver could return several this
        // loop was indistinguishable from the single write it replaces.
        for (const roomId of planned.roomIds) {
            await tx.sessionRoom.create({ data: { sessionId, roomId, tenantId } });
        }

        /*
         * A BLOCK, not an early `continue`. The attendee writes are the last
         * thing in this loop today, so a `continue` would be equivalent — and
         * would silently skip whatever somebody appends here next, for exactly
         * the placements whose handling is already the subtle case.
         */
        if (planned.attendeesAreAuthoritative) {
            for (const personId of planned.lecturerIds) {
                await tx.sessionPerson.create({
                    data: { sessionId, personId, roleId: lecturerRole?.id ?? null, tenantId },
                });
            }

            for (const personId of planned.personIds) {
                await tx.sessionPerson.create({ data: { sessionId, personId, roleId: null, tenantId } });
            }

            for (const groupId of planned.groupIds) {
                await tx.sessionGroup.create({ data: { sessionId, groupId, tenantId } });
            }
        }
    }

    if (plan.deletes.length) {
        /**
         * A DELETE event PER Session, written BEFORE the rows go.
         *
         * Materialize used to delete silently — the only record was a `deleted`
         * count on the APPLY_GENERATION event, so "what was removed, and from
         * where" had no answer. A delete is also the one change the Generation
         * snapshot cannot describe on its own.
         *
         * Order matters: `session_event.session_id` is ON DELETE SET NULL and the
         * append-only trigger permits exactly that detach, so the event is written
         * against a live Session and the delete then NULLs the pointer while
         * leaving the payload intact. Writing it afterwards would point at nothing.
         */
        for (const deleted of plan.deletes) {
            await appendEvent(tx, { tenantId, actorPersonId }, {
                type: 'DELETE',
                generationId,
                sessionId: deleted.sessionId,
                payload: {
                    from: {
                        termId,
                        ...deleted.placement,
                    },
                    offeringId: deleted.offeringId,
                    reason: 'not_returned_by_solver',
                },
                reason: 'Removed by applying a solver Generation: the run did not place it.',
            });
        }

        await tx.session.deleteMany({
            where: { id: { in: plan.deletes.map((d) => d.sessionId) } },
        });
    }

    return {
        ...plan.counts,
        ...await materializeViolations(tx, { tenantId, generationId, violations }),
    };
}

/** Plan and execute in one step — the apply route's entry point. */
export async function materializeGeneration(tx: Tx, options: {
    tenantId: string;
    termId: string;
    generationId: string;
    output: SolverOutput;
    scopeOfferingIds: string[];
    federationId?: string | null;
    /** Attribution for the DELETE events this may emit. */
    actorPersonId: string | null;
}): Promise<MaterializeCounts> {
    const { tenantId, federationId = null, termId, generationId, output, scopeOfferingIds, actorPersonId } = options;

    const plan = await planMaterialization(tx, {
        tenantId, federationId, termId, output, scopeOfferingIds,
    });

    return executePlan(tx, plan, {
        tenantId,
        termId,
        generationId,
        violations: output.hardViolations,
        actorPersonId,
    });
}

/**
 * Maps the solver's residual hard violations onto `constraint_violation`.
 *
 * This is warn-and-allow made real: a SUCCEEDED run carrying violations still
 * applies, and its violations land in the same table and the same UI that
 * manual edits already use. Discarding them would make an unsatisfiable
 * timetable look clean.
 */
async function materializeViolations(tx: Tx, options: {
    tenantId: string;
    generationId: string;
    violations: ConstraintViolation[];
}): Promise<Pick<MaterializeCounts, 'violationsSession' | 'violationsOffering' | 'violationsUnmapped'>> {
    const { tenantId, generationId, violations } = options;

    const counts = { violationsSession: 0, violationsOffering: 0, violationsUnmapped: 0 };

    for (const violation of violations) {
        // `constraint_id` is the app's own Constraint row id — it was sent as
        // ConstraintConfig.id — so a miss means the constraint was deleted
        // between starting the run and applying it.
        const constraint = await tx.constraint.findFirst({
            where: { id: violation.constraintId, tenantId },
            select: { id: true, severity: true, weight: true },
        });

        if (!constraint) {
            counts.violationsUnmapped++;

            continue;
        }

        const detail = {
            reason: 'solver_hard_violation',
            constraintType: violation.constraintType,
            detail: violation.detail,
            sessionIds: violation.sessionIds,
            offeringIds: violation.offeringIds,
        };

        const base = {
            tenantId,
            constraintId: constraint.id,
            severity: constraint.severity,
            penalty: constraint.severity === 'SOFT' ? constraint.weight : null,
            detail,
            generationId,
        };

        // Session-scoped: one row per session named.
        for (const sessionId of violation.sessionIds) {
            const exists = await tx.session.findFirst({ where: { id: sessionId, tenantId }, select: { id: true } });

            if (!exists) {
                counts.violationsUnmapped++;

                continue;
            }

            // find-then-write: Prisma cannot express a compound unique key with
            // nullable columns. See the same note in violations.ts.
            await writeViolation(tx, { ...base, sessionId, offeringId: null });

            counts.violationsSession++;
        }

        /**
         * Offering-scoped: the ExactFrequency case. Recorded ONLY when the
         * violation named no sessions — otherwise a violation that names both
         * would be counted twice for the same breach.
         */
        if (violation.sessionIds.length === 0) {
            for (const wireOfferingId of violation.offeringIds) {
                /**
                 * The SECOND place a wire offering id must be reversed. A
                 * violation on a split series names `offering::group`, and
                 * `constraint_violation.offering_id` is a foreign key to the
                 * real row — so without this every ExactFrequency breach on a
                 * multi-group Offering would land in `violationsUnmapped` and
                 * the tenant would see no violations at all for exactly the
                 * Offerings most likely to have them.
                 */
                const parsed = parseWireOfferingId(wireOfferingId);

                const exists = parsed.ambiguous
                    ? null
                    : await tx.offering.findFirst({
                        where: { id: parsed.offeringId, tenantId },
                        select: { id: true },
                    });

                if (!exists) {
                    counts.violationsUnmapped++;

                    continue;
                }

                /**
                 * Several series of one Offering can each breach the same rule,
                 * and they collapse onto one real Offering id. `writeViolation`
                 * is find-then-write against
                 * (constraint_id, session_id, offering_id), so the second
                 * updates the first rather than colliding — the breach is
                 * reported once against the Offering, which is the row a human
                 * acts on.
                 */
                await writeViolation(tx, { ...base, sessionId: null, offeringId: parsed.offeringId });

                counts.violationsOffering++;
            }
        }
    }

    return counts;
}

/**
 * Counts how the run's violations WOULD map, without writing anything.
 *
 * Deliberately mirrors `materializeViolations()` rather than sharing its loop:
 * that one resolves against Sessions as they exist AFTER the plan is applied,
 * this one has to answer before any of it exists. What it can say honestly is
 * how many name a Session the solver invented and therefore cannot be attached
 * to any row — the tracked cross-repo gap. Reporting that number is the point;
 * netting it out would make an unsatisfiable timetable look cleaner than it is.
 */
export function summarizeProposedViolations(violations: ConstraintViolation[]): {
    hard: number;
    byType: Record<string, number>;
    /** References naming a Session that exists nowhere in the placements. */
    unmappable: number;
    sessionReferences: number;
} {
    const byType: Record<string, number> = {};
    let unmappable = 0;
    let sessionReferences = 0;

    for (const violation of violations) {
        byType[violation.constraintType] = (byType[violation.constraintType] ?? 0) + 1;

        for (const sessionId of violation.sessionIds) {
            sessionReferences++;

            // The solver names Sessions it invented with a synthetic
            // "<offeringId>#<index>" key that appears nowhere in the placements,
            // so there is no join key back to the row the apply will create.
            if (sessionId.includes('#')) {
                unmappable++;
            }
        }
    }

    return { hard: violations.length, byType, unmappable, sessionReferences };
}

/**
 * Insert-or-refresh one violation.
 *
 * Split out because the uniqueness it respects — (constraint, session, offering)
 * with NULLS NOT DISTINCT — is enforced by an index Prisma's type system cannot
 * describe, so `upsert` is unavailable and both call sites would otherwise
 * repeat the same eight lines.
 */
async function writeViolation(tx: Tx, row: {
    tenantId: string;
    constraintId: string;
    sessionId: string | null;
    offeringId: string | null;
    severity: 'HARD' | 'SOFT';
    penalty: number | null;
    detail: object;
    generationId: string;
}): Promise<void> {
    const existing = await tx.constraintViolation.findFirst({
        where: { constraintId: row.constraintId, sessionId: row.sessionId, offeringId: row.offeringId },
        select: { id: true },
    });

    if (existing) {
        await tx.constraintViolation.update({
            where: { id: existing.id },
            data: {
                severity: row.severity,
                penalty: row.penalty,
                detail: row.detail,
                generationId: row.generationId,
                detectedAt: new Date(),
            },
        });

        return;
    }

    await tx.constraintViolation.create({ data: row });
}

/** Placements a solver output carries, for a review screen that has not applied yet. */
export function summarizeOutput(output: SolverOutput): {
    placements: number;
    hardViolations: number;
    objective: number | undefined;
    terminationReason: string | undefined;
} {
    return {
        placements: output.sessions.length,
        hardViolations: output.hardViolations.length,
        objective: output.objective?.total,
        terminationReason: output.stats?.terminationReason,
    };
}

export type { PlacedSession };
