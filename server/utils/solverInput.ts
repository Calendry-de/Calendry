import { createHash } from 'node:crypto';
import { SolverInput } from '@mindcollaps/calendry-proto';
import type {
    ConstraintConfig, ExternalOccupancy, Offering, Person, Room, SlotRef,
} from '@mindcollaps/calendry-proto';
import type { Tx } from './tenantDb';
import { assertClosedUnderParent, conflictClosure, referencedGroupIds } from './solverGroups';
import {
    TermEndedError,
    buildAcademicCalendar,
    computeReferenceSlot,
    isoWeekday,
    toWireTimeGrid,
    weekIndexOf,
} from './solverCalendar';
import { multiRoomSessionIds, toWireSession } from './solverSessions';
import { HEAVY_VETO_RATIO, blockedSlotSummary } from '../../shared/availability';
import { approvedBlackoutsFor } from './availability';
import { deriveCapacity } from '../../shared/groupCapacity';
import { splitsIntoSeries, wireOfferingId } from './offeringSplit';
// Relative, not `#shared`: this module is loaded OUTSIDE Nuxt too — by
// scripts/ and by vitest — where Nuxt's aliases do not exist. App code under
// app/ can use `#shared` freely because it only ever runs inside Nuxt.
import {
    findConstraintType,
    missingConstraintParams,
    severityMismatch,
} from '../../shared/constraintTypes';

/**
 * Stage 3b/3e — the real SolverInput, assembled from tenant data.
 *
 * THE SOLVER KNOWS ONLY WHAT IS IN HERE. It never touches Postgres, so every
 * omission below is a wrong answer it has no way to detect: a Room left out is
 * a Room it will never use, a Session left out is a slot it thinks is free.
 * That is why the narrowings are counted and returned rather than being quiet.
 *
 * SCOPE (CLAUDE.md, Stages 1–6): single-tenant, non-federated. Federation-owned
 * Rooms and Offerings are EXCLUDED, not included-and-hoped-for — including a
 * shared Room while sending an empty `external_occupancy` is precisely the case
 * that silently double-books across a tenant boundary.
 */

/** Everything narrowed or dropped on the way to the wire. Returned, never swallowed. */
export interface AssemblyReport {
    /** Federation-shared Rooms now sent to the solver (Stage 7b). */
    includedFederationRooms: number;
    /** Slots other tenants already occupy on those shared Rooms. */
    externalOccupancySlots: number;
    excludedFederationOfferings: number;
    /** Sessions whose extra Rooms the wire cannot carry (see CLAUDE.md). */
    multiRoomSessions: string[];
    /** Equipment requirements whose quantity the wire cannot carry. */
    droppedEquipmentQuantities: number;
    /**
     * Offerings whose room-capacity requirement could not be established at
     * all: `requiredCapacity` unset AND no attached Group with either real
     * membership or an estimate anywhere in its closure.
     *
     * These are sent with `minCapacity: 0`, which the solver reads as "any room
     * qualifies" — the same silent state this whole derivation exists to fix,
     * so it is REPORTED rather than merely happening. There is no other value
     * to send: the wire field is a plain uint32 with no absent case, and
     * inventing a number would be worse than admitting the gap.
     */
    offeringsWithNoDerivableCapacity: { id: string; title: string }[];
    /**
     * Offerings whose derived capacity rests on a roll that looks INCOMPLETE —
     * materially fewer enrolled people than the attached Groups expect.
     *
     * Not an error and not a narrowing: the real count is still used, because
     * an enrolment list is a fact and a stale estimate is not. What it prevents
     * is learning that "4 against an expected 96" was the basis only when a
     * room turns out to hold a twentieth of the cohort.
     *
     * Both numbers travel so severity is a human judgement rather than the
     * threshold's — 4-of-96 and 86-of-96 both appear here and are obviously
     * different problems.
     */
    offeringsWithPartialEnrolment: { id: string; title: string; members: number; expected: number }[];
    /**
     * People whose APPROVED unavailability removes at least `HEAVY_VETO_RATIO`
     * of the teaching week.
     *
     * Warn-and-allow, per TAXONOMY.md §3. Heavy unavailability is legitimate and
     * an administrator already approved it; what it must not do is stay
     * invisible, because an infeasible term traces back to somebody's calendar
     * far more often than to anything else in the input, and the solver's output
     * cannot say so.
     *
     * Both numbers travel, so the threshold decides only WHETHER to mention it,
     * never how bad it is — 20-of-40 and 39-of-40 are obviously different
     * problems and neither is hidden behind the other.
     */
    personsWithHeavyVetoLoad: { id: string; name: string; blocked: number; total: number }[];
    /**
     * Offerings that became SEVERAL independent series, one per attached Group.
     *
     * Reported because the change is invisible otherwise and it multiplies the
     * problem: twelve Offerings with four Groups each become forty-eight wire
     * entries and four times the placements. A solve that suddenly does that
     * with no explanation is exactly the kind of silent change this codebase
     * keeps getting bitten by.
     */
    offeringsSplitByGroup: { id: string; title: string; series: number }[];
    /**
     * Sessions of a split Offering that belong to no single series — they carry
     * none or several of its Groups, so they predate the semantic change.
     *
     * Deliberately NOT sent to the solver, and deliberately not silent: they
     * will be removed by the next apply, and the count is how a reviewer learns
     * that before it happens.
     */
    legacyCombinedSessionsOmitted: number;
    /** Constraints not sent, with the reason. Never sent with invented defaults. */
    skippedConstraints: { id: string; type: string; reason: string }[];
    /**
     * Rows whose stored severity contradicts the catalogue's fixed severity for
     * that type. Sent using the CATALOGUE's severity — the wire has no severity
     * field, the type determines it — with any weight on a HARD type ignored.
     */
    severityMismatches: { id: string; type: string; stored: string; expected: string }[];
    /**
     * Groups the tenant has that this Term's problem does not involve, and which
     * were therefore not sent. Reported rather than narrowed quietly, like every
     * other omission in this report — it is the difference between "the tenant
     * has three cohorts" and "this Term uses three cohorts", and a run that
     * looks wrong is easier to explain with the number in hand.
     */
    groupsOmitted: number;
    counts: {
        rooms: number;
        persons: number;
        groups: number;
        offerings: number;
        existingSessions: number;
        constraints: number;
        weeks: number;
    };
}

export interface AssembledInput {
    input: SolverInput;
    referenceSlot: SlotRef;
    /** SHA-256 over the serialized input — makes "same problem?" answerable. */
    inputHash: string;
    /**
     * Scope in both languages: `wire` is what the solver must be told (split
     * `offering::group` ids included), `real` is what the app records so
     * `planMaterialization` can match against `session.offering_id`.
     */
    scopeOfferingIds: { wire: string[]; real: string[] };
    report: AssemblyReport;
}

/**
 * Turns one stored Constraint row into a wire `ConstraintConfig`, or explains
 * why it cannot be sent.
 *
 * SKIP-AND-REPORT, never defaults. A constraint missing a required parameter is
 * withheld with a reason rather than transmitted with a guess: a rule the tenant
 * never chose, enforced by a solver and reported to nobody, is worse than one
 * that visibly did not run.
 *
 * The type → wire-field mapping is DATA (`wireField` on the catalogue), not a
 * switch here, so the catalogue stays the one place a type's identity lives.
 */
export function toWireConstraint(row: {
    id: string;
    type: string;
    severity: string;
    weight: number | null;
    params: unknown;
    scopes: { offeringId: string | null; kindId: string | null }[];
}, kindKeyById: Map<string, string>): { config: ConstraintConfig } | { skip: string } {
    const type = findConstraintType(row.type);

    if (!type) {
        return { skip: `'${row.type}' is not in the constraint catalogue (shared/constraintTypes.ts).` };
    }

    /*
     * A catalogue entry whose proto field has not shipped yet. Skipped, and
     * named in the report, rather than encoded: the config is assembled with an
     * `as ConstraintConfig` cast and ts-proto writes only fields it knows, so a
     * fabricated field name would leave the request with a ConstraintConfig
     * carrying no params at all — a rule the tenant enabled, weighted, and that
     * silently never reached the solver. This is the same refusal the
     * offering-scope branch below makes for the same reason: when the wire
     * cannot express it, say so, never approximate.
     */
    if (!type.wireField) {
        return {
            skip: 'The wire has no field for this type yet, so it cannot be sent. '
                + 'Enabling it has no effect until the proto carries it.',
        };
    }

    const params = (row.params && typeof row.params === 'object' ? row.params : {}) as Record<string, unknown>;
    const missing = missingConstraintParams(type, params);

    if (missing.length) {
        return { skip: `Required parameter(s) not set: ${missing.join(', ')}.` };
    }

    /**
     * `ConstraintScope` can name an Offering, but the wire's ConstraintConfig
     * has only `applies_to_kinds` — there is no offering-scoped equivalent.
     * Skipped rather than degraded to unscoped, which would silently WIDEN the
     * rule to every offering: the opposite of what was configured.
     */
    if (row.scopes.some((scope) => scope.offeringId)) {
        return {
            skip: 'Scoped to specific offerings, which the wire cannot express '
                + '(ConstraintConfig carries applies_to_kinds only). Sending it unscoped '
                + 'would widen the rule rather than narrow it.',
        };
    }

    const appliesToKinds = row.scopes
        .map((scope) => (scope.kindId ? kindKeyById.get(scope.kindId) : undefined))
        .filter((key): key is string => Boolean(key));

    const config = {
        id: row.id,
        enabled: true,
        appliesToKinds,
        // Meaningful for SOFT only; the solver ignores it for a HARD type. Read
        // from the catalogue's severity, not the row's — see severityMismatch.
        weight: type.severity === 'SOFT' ? (row.weight ?? 0) : 0,
        [type.wireField]: buildVariant(type.key, params),
    } as ConstraintConfig;

    return { config };
}

/**
 * The per-type payload. Most variants are empty messages — the type IS the
 * rule — and only three carry parameters.
 *
 * `percent` is converted here: tenants think in 0–100, the wire wants 0.0–1.0,
 * and doing it at this single boundary keeps the STORED value the one the user
 * typed.
 */
function buildVariant(typeKey: string, params: Record<string, unknown>): Record<string, unknown> {
    switch (typeKey) {
        case 'max_online_ratio_per_group':
            return {
                maxRatio: Number(params.maxRatio) / 100,
                window: params.window === 'SHARE_WINDOW_PER_WEEK' ? 2 : 1,
            };

        case 'minimize_specifc_day':
            return { days: (params.days as number[]).map(Number).sort((a, b) => a - b) };

        case 'minimize_high_ranking_rooms':
            return {
                rankThreshold: Number(params.rankThreshold),
                /*
                 * `Boolean()`, so a row stored before this parameter existed
                 * sends false — which is the behaviour it already had. An
                 * absent key must not become a direction the tenant never
                 * chose, and 0.5.0's own default for the field is the same
                 * false, so the two agree.
                 */
                invert: Boolean(params.invert),
            };

        case 'minimize_block_usage':
            return {
                // Stored 1-based because that is how a human counts blocks in
                // the UI; the wire and the solver are 0-based. Converted at the
                // boundary, exactly like `percent` params, so neither side has
                // to know about the other's convention.
                //
                // Non-numeric and out-of-range entries are dropped rather than
                // rejected: the field is free text, and a stale position is
                // already inert solver-side, so failing the whole run over one
                // stray character would be the harsher answer to the same input.
                blocks: String(params.blocks ?? '')
                    .split(',')
                    .map((part) => Number(part.trim()))
                    .filter((n) => Number.isInteger(n) && n >= 1)
                    .map((n) => n - 1)
                    .sort((a, b) => a - b),
                first: Boolean(params.first),
                last: Boolean(params.last),
            };

        default:
            return {};
    }
}

export async function assembleSolverInput(
    tx: Tx,
    options: { tenantId: string; termId: string; now: Date },
): Promise<AssembledInput> {
    const tenant = await tx.tenant.findFirstOrThrow({
        where: { id: options.tenantId },
        select: { id: true, timezone: true, federationId: true },
    });

    const term = await tx.term.findFirst({
        where: { id: options.termId, tenantId: options.tenantId },
        // `breaks` travels with the grid: computeReferenceSlot() resolves a
        // block from the wall clock, and a day-specific break changes which
        // block that is. The breaks themselves are NOT forwarded to the solver
        // — see toWireTimeGrid().
        include: { timeGrid: { include: { breaks: true } }, calendarPeriods: true },
    });

    if (!term) {
        throw createError({ statusCode: 404, statusMessage: 'Term not found.' });
    }

    // A grid is not optional: every placement is addressed against it, and
    // TAXONOMY.md §2 forbids assuming a shape when one is missing.
    const grid = term.timeGrid
        ?? await tx.timeGrid.findFirst({
            where: { tenantId: options.tenantId, isDefault: true },
            include: { breaks: true },
        });

    if (!grid) {
        throw createError({
            statusCode: 422,
            statusMessage: 'This term has no TimeGrid and the tenant has no default. Nothing can be placed.',
        });
    }

    // Throws TermEndedError, which the route turns into a 422 rather than
    // returning a confidently empty timetable.
    const referenceSlot = computeReferenceSlot({
        now: options.now,
        timeZone: tenant.timezone,
        termStart: term.startDate,
        termEnd: term.endDate,
        grid,
    });

    const [roomRows, personRows, groupRows, offeringRows, sessionRows, constraintRows, lecturerRole] =
        await Promise.all([
            tx.room.findMany({
                /**
                 * Federation-owned Rooms are included alongside the tenant's own
                 * (Stage 7b). RLS already narrows `federationId IS NOT NULL` to
                 * the caller's OWN federation, so this cannot widen past it.
                 */
                where: {
                    isActive: true,
                    OR: [
                        { tenantId: options.tenantId },
                        { tenantId: null, federationId: { not: null } },
                    ],
                },
                include: { roomEquipment: { include: { equipment: true } } },
            }),
            tx.person.findMany({
                where: { tenantId: options.tenantId, isActive: true },
                include: { personRoles: { include: { role: true } }, memberships: true },
            }),
            tx.group.findMany({ where: { tenantId: options.tenantId } }),
            tx.offering.findMany({
                where: { tenantId: options.tenantId, termId: term.id, isActive: true },
                include: {
                    kind: true,
                    groups: true,
                    lecturers: true,
                    equipment: { include: { equipment: true } },
                },
            }),
            tx.session.findMany({
                /**
                 * Own Sessions plus Federation-shared ones (Stage 7c). A shared
                 * event occupies a room and a slot the solver must respect; it
                 * is sent as immovable occupancy, which `toWireSession` enforces
                 * by forcing isLocked when the Session has no owning tenant.
                 */
                where: {
                    termId: term.id,
                    OR: [
                        { tenantId: options.tenantId },
                        ...(tenant.federationId ? [{ federationId: tenant.federationId }] : []),
                    ],
                },
                include: { kind: true, rooms: true, people: true, groups: true },
            }),
            tx.constraint.findMany({
                where: { tenantId: options.tenantId, isEnabled: true },
                include: { scopes: true },
            }),
            tx.role.findFirst({ where: { tenantId: options.tenantId, key: 'lecturer' }, select: { id: true } }),
        ]);

    /**
     * Federation-owned ROOMS are now included (Stage 7b) — they arrive through
     * the widened RLS read policy and are sent with the other tenants' occupancy
     * of them, so the solver can place into a shared hall without overlapping
     * somebody else's event.
     *
     * Federation-owned OFFERINGS remain excluded, deliberately and separately:
     * placing one raises "which tenant owns the resulting Session?", which is a
     * placement-ownership question rather than an occupancy one and deserves its
     * own decision.
     */
    const includedFederationRooms = roomRows.filter((room) => room.federationId !== null).length;
    const federationOfferings = await tx.offering.count({
        where: { federationId: { not: null }, tenantId: null, termId: term.id, isActive: true },
    });

    const rooms: Room[] = roomRows.map((room) => ({
        id: room.id,
        // Ownership reported honestly: a shared hall belongs to the federation,
        // not to the requesting tenant, and the solver distinguishes the two.
        tenantId: room.tenantId ?? '',
        federationId: room.federationId ?? '',
        name: `${room.code} · ${room.name}`,
        capacity: room.capacity,
        // Same direction on both sides: HIGHER = more premium/scarce.
        rank: Math.max(0, room.ranking),
        isVirtual: room.isVirtual,
        // Presence only — RoomEquipment.quantity has nowhere to go on the wire.
        featureTags: room.roomEquipment.map((link) => link.equipment.key),
        location: room.location ?? '',
    } as Room));

    /**
     * Only the Groups this Term's problem can involve.
     *
     * Derived from what the Offerings and Sessions actually REFERENCE, expanded
     * to the conflict closure the solver will rebuild from `parent_id`. NOT
     * filtered by `group_term`: that table is tenant configuration a human sets,
     * so trusting it here would let a mis-scoped Group produce an input whose
     * Offerings name a `group_id` the solver was never sent. See solverGroups.ts
     * for why the closure is exactly sufficient and why it cannot leave a
     * dangling parent.
     */
    const sentGroupIds = conflictClosure(groupRows, referencedGroupIds(offeringRows, sessionRows));
    const sentGroupRows = groupRows.filter((group) => sentGroupIds.has(group.id));

    // The proof says this holds; asserted because a silently weakened conflict
    // propagation is invisible until a timetable double-books a cohort.
    assertClosedUnderParent(sentGroupRows);

    /**
     * APPROVED unavailability only, through the single read path in
     * `availability.ts`.
     *
     * Until this landed, `blackouts` was `[]` unconditionally — so
     * `lecturer_veto`, a HARD constraint enabled by default in every tenant, ran
     * against an empty set in every solve and could never once fire. It looked
     * healthy the whole time, which is the point of the story rather than an
     * aside: a rule with no data is indistinguishable from a rule that is
     * satisfied.
     *
     * PENDING and REJECTED windows are excluded, and that filter is the safety
     * property of the whole feature: an unreviewed veto reaching the wire would
     * apply a hard constraint nobody approved, and would announce itself only as
     * unplaced Sessions. Hence one read path, and a test that fails when the
     * filter is removed.
     */
    const blackoutsByPerson = await approvedBlackoutsFor(
        tx,
        personRows.map((person) => person.id),
        // The term being solved. A week-scoped window counts THIS calendar's
        // weeks; one from another term would name a different fortnight.
        term.id,
    );

    /**
     * People who have blocked out a large share of the teaching week.
     *
     * Warn-and-allow, exactly as TAXONOMY.md §3 has it for manual edits: heavy
     * unavailability is legitimate (a 20% appointment really is unavailable most
     * of the week) and refusing it would be this layer overruling an
     * administrator who already approved it. What it must not do is stay
     * invisible — an infeasible term traces back to a person's calendar far more
     * often than to anything else in the input, and that is not deducible from
     * the solver's output.
     *
     * Counted against the DEFAULT grid, blanket windows only. See
     * `blockedSlotSummary`.
     */
    const personsWithHeavyVetoLoad: { id: string; name: string; blocked: number; total: number }[] = [];

    for (const person of personRows) {
        const windows = blackoutsByPerson.get(person.id) ?? [];

        if (windows.length === 0) {
            continue;
        }

        const summary = blockedSlotSummary(windows, grid.activeDays, grid.blocksPerDay);

        if (summary.total > 0 && summary.blocked / summary.total >= HEAVY_VETO_RATIO) {
            personsWithHeavyVetoLoad.push({
                id: person.id,
                name: `${person.givenName} ${person.familyName}`.trim(),
                blocked: summary.blocked,
                total: summary.total,
            });
        }
    }

    const persons: Person[] = personRows.map((person) => ({
        id: person.id,
        roleTags: person.personRoles.map((link) => link.role.key),
        /**
         * Narrowed to the Groups actually being sent, for the same reason the
         * Groups themselves are: a `group_id` the solver was never given is a
         * dangling reference it cannot resolve.
         *
         * Dropping the rest loses nothing. A membership only matters if the
         * Group it names carries a placement in this Term, and a Group with a
         * placement is by definition referenced — so it is in the sent set,
         * along with its whole conflict closure. Membership of a Group with no
         * placements cannot produce a clash for anyone to detect.
         */
        groupIds: person.memberships
            .map((link) => link.groupId)
            .filter((groupId) => sentGroupIds.has(groupId)),
        blackouts: (blackoutsByPerson.get(person.id) ?? []).map((window) => ({
            days: window.days,
            blocks: window.blocks,
            weeks: window.weeks,
            // The wire carries a reason field; the app deliberately does not
            // send one. A veto's reason is often personal (medical, caring),
            // it changes no placement, and the solver never reads it — so it
            // stays in the database where the tenant's own access rules govern
            // it rather than travelling to a service that has no use for it.
            reason: '',
        })),
    }));

    const groups = sentGroupRows.map((group) => ({
        id: group.id,
        parentId: group.parentGroupId ?? '',
        name: group.name,
        size: group.expectedSize ?? 0,
        // group_closure is deliberately NOT transmitted: the solver derives the
        // ancestor/descendant closure from parent_id, and shipping ours would
        // create a second source of truth that can drift undetectably.
    }));

    let droppedEquipmentQuantities = 0;
    const offeringsWithNoDerivableCapacity: { id: string; title: string }[] = [];
    const offeringsWithPartialEnrolment: {
        id: string; title: string; members: number; expected: number;
    }[] = [];

    /**
     * Capacity inputs, fetched ONCE for the whole assembly rather than per
     * Offering: every Offering's closure is walked against the same tenant tree
     * and the same roll, and twelve Offerings would otherwise mean twelve
     * identical queries.
     *
     * `groupRows` is every Group in the tenant — deliberately NOT the filtered
     * `sentGroupRows`. That set is narrowed to what the SOLVER needs to reason
     * about; a Group's real size depends on descendants that may carry no
     * placement of their own, and dropping them would under-count.
     */
    const capacityGroups = groupRows.map((group) => ({
        id: group.id,
        parentGroupId: group.parentGroupId,
        expectedSize: group.expectedSize,
    }));

    const capacityMemberships = (await tx.membership.findMany({
        where: { tenantId: options.tenantId },
        select: { groupId: true, personId: true },
    }));

    /**
     * ONE WIRE OFFERING PER SERIES.
     *
     * An Offering carrying two or more Groups means an INDEPENDENT series per
     * Group — each with the full frequency and its own room requirement — not
     * one combined Session for the union. The solver needs no change to express
     * that: N wire entries are indistinguishable from N hand-made Offerings,
     * because it keys everything by wire id and echoes that id straight back.
     *
     * A single-group or group-less Offering emits exactly one entry under its
     * REAL id, so nothing downstream changes for it.
     */
    const offeringsSplitByGroup: { id: string; title: string; series: number }[] = [];

    /** Wire id -> the real Offering id, for the scope the app keeps. */
    const realOfferingIdOf = new Map<string, string>();

    const offerings: Offering[] = offeringRows.flatMap((offering) => {
        droppedEquipmentQuantities += offering.equipment.filter((link) => link.quantity !== null).length;

        const groupIds = offering.groups.map((link) => link.groupId);
        const split = splitsIntoSeries(groupIds);

        if (split) {
            offeringsSplitByGroup.push({
                id: offering.id,
                title: offering.title,
                series: groupIds.length,
            });
        }

        /**
         * Each series carries ONE group, so capacity is derived per series from
         * that group alone — the existing single-group path, not the union.
         *
         * This is the point of the change as much as the scheduling is: four
         * 24-person cohorts previously produced one requirement of 96, which no
         * physical room in the demo tenant could satisfy. Four independent
         * requirements of 24 fit the rooms that exist.
         */
        const seriesGroups: (string | null)[] = split ? groupIds : [null];

        return seriesGroups.map((seriesGroupId) => {
            const capacityGroupIds = seriesGroupId === null ? groupIds : [seriesGroupId];

            /**
             * THE DOCUMENTED BEHAVIOUR, NOW REAL.
             *
             * `requiredCapacity` stays authoritative when a human set it — an
             * explicit number is a decision, and a derived one must never
             * overrule it. Only the NULL case derives, which is precisely what
             * the schema comment and the form's help text have promised all
             * along while `?? 0` quietly satisfied every room in the tenant.
             */
            const derived = offering.requiredCapacity === null
                ? deriveCapacity(capacityGroupIds, capacityGroups, capacityMemberships)
                : null;

            const wireId = seriesGroupId === null
                ? offering.id
                : wireOfferingId(offering.id, seriesGroupId);

            realOfferingIdOf.set(wireId, offering.id);

            // Reported per SERIES, since each has its own requirement and one
            // series can be underivable while its siblings are fine.
            if (derived && derived.capacity === null) {
                offeringsWithNoDerivableCapacity.push({ id: wireId, title: offering.title });
            }

            if (derived?.partialEnrolment && derived.capacity !== null && derived.estimate !== null) {
                offeringsWithPartialEnrolment.push({
                    id: wireId,
                    title: offering.title,
                    members: derived.capacity,
                    expected: derived.estimate,
                });
            }

            return {
            id: wireId,
            tenantId: options.tenantId,
            kind: offering.kind.key,
            requiredSessionCount: offering.frequency,
            durationBlocks: offering.durationBlocks,
            candidateLecturerIds: offering.lecturers.map((link) => link.personId),
            // The app has no separate count: OfferingLecturer IS the assignment
            // ("Who leads it" in the management UI), so the pool equals the
            // requirement and the solver does not choose. Tracked as a modelling
            // limit rather than papered over with a guess.
            requiredLecturerCount: offering.lecturers.length,
            // The SERIES' own group, not the Offering's whole set. This is
            // what makes each series independent — and it is what comes back in
            // `PlacedSession.group_ids`, so materialization gets the one right
            // group for `session_group` with no extra bookkeeping.
            groupIds: capacityGroupIds,
            // The app models no direct per-Offering participants beyond groups.
            participantPersonIds: [],
            requiredRoomFeatures: offering.equipment.map((link) => link.equipment.key),
            // 0 only when genuinely underivable — and that case is reported
            // above rather than passing as "no requirement".
            minCapacity: offering.requiredCapacity ?? derived?.capacity ?? 0,
            // Empty = any eligible Room. The app has no allow-list.
            allowedRoomIds: [],
            allowOnline: offering.allowOnline,
            } as Offering;
        });
    });

    /**
     * EXISTING SESSIONS MUST SPEAK THE SPLIT'S LANGUAGE.
     *
     * `convert.rs` resolves an existing Session's Offering by matching its
     * `offering_id` against the wire ids, and uses that to decide scope, to
     * count what is `already_realized`, and to reuse Session ids. A Session
     * still carrying its REAL Offering id after a split would resolve to
     * nothing: it would become immovable out-of-scope occupancy, count toward
     * no series, and the solver would place the full frequency again ON TOP of
     * it. Duplication, silently.
     *
     * So a Session of a split Offering is re-pointed at the series whose Group
     * it carries.
     *
     * A LEGACY COMBINED Session — one carrying none or several of the
     * Offering's Groups — belongs to no series and is OMITTED from the wire
     * entirely rather than sent as occupancy. It is going to be deleted by the
     * apply (the app-side scope keeps the real Offering id, so the delete
     * partition still reaches it), and freezing it as occupancy would block the
     * very slots its replacements need while it waits to be removed.
     */
    const splitOfferingGroupIds = new Map<string, Set<string>>();

    for (const offering of offeringRows) {
        const ids = offering.groups.map((link) => link.groupId);

        if (splitsIntoSeries(ids)) {
            splitOfferingGroupIds.set(offering.id, new Set(ids));
        }
    }

    let legacyCombinedSessionsOmitted = 0;

    const wireSessionRows = sessionRows.filter((session) => {
        const seriesGroups = session.offeringId
            ? splitOfferingGroupIds.get(session.offeringId)
            : undefined;

        if (!seriesGroups) {
            return true;
        }

        const owned = session.groups.map((link) => link.groupId).filter((id) => seriesGroups.has(id));

        if (owned.length === 1) {
            return true;
        }

        legacyCombinedSessionsOmitted += 1;

        return false;
    });

    const sessionInputs = wireSessionRows.map((session) => ({
        id: session.id,
        tenantId: session.tenantId,
        offeringId: (() => {
            const seriesGroups = session.offeringId
                ? splitOfferingGroupIds.get(session.offeringId)
                : undefined;

            if (!seriesGroups) {
                return session.offeringId;
            }

            // Exactly one by construction — the filter above kept only those.
            const own = session.groups.map((link) => link.groupId).find((id) => seriesGroups.has(id))!;

            return wireOfferingId(session.offeringId!, own);
        })(),
        kindId: session.kindId,
        kindKey: session.kind.key,
        termWeek: session.termWeek,
        dayOfWeek: session.dayOfWeek,
        blockIndex: session.blockIndex,
        durationBlocks: session.durationBlocks,
        isLocked: session.isLocked,
        roomIds: session.rooms.map((link) => link.roomId),
        lecturerIds: session.people.filter((p) => p.roleId === lecturerRole?.id).map((p) => p.personId),
        personIds: session.people.filter((p) => p.roleId !== lecturerRole?.id).map((p) => p.personId),
        groupIds: session.groups.map((link) => link.groupId),
    }));

    const kindKeyById = new Map(
        (await tx.sessionKind.findMany({ where: { tenantId: options.tenantId } }))
            .map((kind) => [kind.id, kind.key]),
    );

    const skippedConstraints: AssemblyReport['skippedConstraints'] = [];
    const severityMismatches: AssemblyReport['severityMismatches'] = [];
    const constraints: ConstraintConfig[] = [];

    for (const row of constraintRows) {
        const type = findConstraintType(row.type);
        const mismatch = type ? severityMismatch(type, row.severity) : null;

        if (type && mismatch) {
            // Reported, not refused and not normalised in the database. The row
            // is the tenant's; the wire simply has no severity field to carry
            // the contradiction, so the catalogue's severity wins on the wire.
            severityMismatches.push({
                id: row.id,
                type: row.type,
                stored: mismatch.stored,
                expected: mismatch.expected,
            });
        }

        const mapped = toWireConstraint(row, kindKeyById);

        if ('skip' in mapped) {
            skippedConstraints.push({ id: row.id, type: row.type, reason: mapped.skip });

            continue;
        }

        constraints.push(mapped.config);
    }

    const calendar = buildAcademicCalendar(
        term.id,
        term.startDate,
        term.endDate,
        term.calendarPeriods.map((p) => ({ kind: p.kind, startDate: p.startDate, endDate: p.endDate })),
    );

    /**
     * Other tenants' use of Federation-shared Rooms.
     *
     * Read through the parameterless SECURITY DEFINER function, because those
     * Sessions belong to sibling tenants and are invisible under normal RLS —
     * which is the whole reason shared rooms were excluded until now. What comes
     * back is occupancy and nothing else: no session ids, no tenant ids, no
     * titles.
     */
    const occupancyRows = tenant.federationId
        ? await tx.$queryRaw<{
            room_id: string;
            occupied_on: Date;
            block_index: number;
            duration_blocks: number;
        }[]>`SELECT * FROM calendry_internal.federation_room_occupancy()`
        : [];

    /**
     * Map each occupied DATE into this tenant's own week numbering.
     *
     * The function returns absolute dates because term-relative weeks are not a
     * shared frame: terms are tenant-scoped rows, so the other tenant's term id
     * never matches ours and its "week 3" is not our "week 3". The calendar is
     * the one frame a Federation agrees on, so the conversion happens here,
     * anchored on the same Monday `buildAcademicCalendar` uses.
     */
    const externalOccupancy: ExternalOccupancy[] = occupancyRows
        .map((row) => {
            const date = new Date(row.occupied_on);
            // Shared with computeReferenceSlot, which anchors the same way. A
            // negative index here means "before the term" and is filtered below.
            const week = weekIndexOf(term.startDate, date);

            return { row, date, week };
        })
        // Occupancy outside this term's span tells the solver nothing — it can
        // only place within the weeks the calendar declares.
        .filter(({ week }) => week >= 0 && week < (calendar.weeks?.length ?? 0))
        .map(({ row, date, week }) => ({
            roomId: row.room_id,
            // Already 0-based: `week` counts from the term's first Monday, which
            // is exactly what SlotRef.week means on the wire.
            startSlot: { week, day: isoWeekday(date), block: row.block_index },
            durationBlocks: row.duration_blocks,
            // Documented as "opaque; diagnostics only" — deliberately carries no
            // identifier, so nothing about the owning tenant leaks through it.
            sourceRef: 'federation-shared',
        } as ExternalOccupancy));

    const input: SolverInput = {
        requestingTenantId: options.tenantId,
        // Now real: the snapshot carries federation-shared rooms and the
        // occupancy that makes them safe to place into.
        federationId: tenant.federationId ?? '',
        timeGrid: toWireTimeGrid(grid, tenant.timezone),
        calendar,
        rooms,
        persons,
        groups,
        offerings,
        existingSessions: sessionInputs.map(toWireSession),
        externalOccupancy,
        constraints,
        referenceSlot,
    };

    return {
        input,
        referenceSlot,
        inputHash: hashInput(input),
        /**
         * The WIRE ids the solver must be given as scope, and the REAL Offering
         * ids the app must record.
         *
         * They differ once anything is split, and both are needed: the solver
         * places nothing for an Offering absent from its scope, while
         * `planMaterialization` tests `inScope.has(session.offeringId)` against
         * DB ids — so recording wire ids there would mean no existing Session
         * was ever in scope and nothing would ever be deleted.
         */
        scopeOfferingIds: {
            wire: [...realOfferingIdOf.keys()],
            real: [...new Set(realOfferingIdOf.values())],
        },
        report: {
            includedFederationRooms,
            externalOccupancySlots: externalOccupancy.length,
            excludedFederationOfferings: federationOfferings,
            multiRoomSessions: multiRoomSessionIds(sessionInputs),
            droppedEquipmentQuantities,
            offeringsWithNoDerivableCapacity,
            offeringsWithPartialEnrolment,
            personsWithHeavyVetoLoad,
            offeringsSplitByGroup,
            legacyCombinedSessionsOmitted,
            skippedConstraints,
            severityMismatches,
            groupsOmitted: groupRows.length - sentGroupRows.length,
            counts: {
                rooms: rooms.length,
                persons: persons.length,
                groups: groups.length,
                offerings: offerings.length,
                existingSessions: input.existingSessions.length,
                constraints: constraints.length,
                weeks: calendar.weeks.length,
            },
        },
    };
}

/**
 * Hash of the ENCODED protobuf, not of a JSON rendering.
 *
 * Two inputs that encode identically are the same problem to the solver, which
 * is exactly the question this answers. A JSON hash would also change with key
 * order and with how BigInt happened to stringify.
 */
export function hashInput(input: SolverInput): string {
    return createHash('sha256').update(SolverInput.encode(input).finish()).digest('hex');
}

export { TermEndedError };
