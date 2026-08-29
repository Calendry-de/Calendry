import { createHash } from 'node:crypto';
import { CompactnessScope, SchedulingPattern, SolverInput } from '@mindcollaps/calendry-proto';
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
import { sessionsOverRoomCap, toWireSession } from './solverSessions';
import { HEAVY_VETO_RATIO, blockedSlotSummary } from '../../shared/availability';
import { blackedOutWeeks } from '../../shared/academicCalendar';
import { approvedBlackoutsFor, statedPreferencesFor } from './availability';
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
 * The real SolverInput, assembled from tenant data.
 *
 * THE SOLVER KNOWS ONLY WHAT IS IN HERE. It never touches Postgres, so every
 * omission is a wrong answer it has no way to detect: a Room left out is a Room
 * it will never use, a Session left out is a slot it thinks is free. Hence the
 * narrowings are counted and returned rather than being quiet.
 *
 * Federation-owned Offerings are EXCLUDED — including a shared resource while
 * sending empty occupancy is what silently double-books across a tenant boundary.
 */

/** Everything narrowed or dropped on the way to the wire. Returned, never swallowed. */
export interface AssemblyReport {
    /** Federation-shared Rooms now sent to the solver (Stage 7b). */
    includedFederationRooms: number;
    /** Slots other tenants already occupy on those shared Rooms. */
    externalOccupancySlots: number;
    excludedFederationOfferings: number;
    /**
     * Sessions carrying more Rooms than the wire can express.
     *
     * Replaced `multiRoomSessions`, which named every Session with more than
     * one Room. That gap is closed — `Session.room_ids` now carries the full
     * set and the solver honours it — so the reason to report has narrowed to
     * the cap: beyond four Rooms `convert.rs` truncates silently, which puts the
     * solver back to reasoning about a Session occupying less Room than it
     * really does.
     */
    sessionsOverRoomCap: string[];
    /**
     * Equipment quantity requirements NO sent Room can meet.
     *
     * This replaced `droppedEquipmentQuantities`, which counted requirements the
     * wire could not carry — a gap that closed when `Offering
     * .room_feature_requirements` and `Room.feature_quantities` shipped in proto
     * v0.10.0. The reason to report anything here now is the opposite one: those
     * counts are ENFORCED, so a room that used to qualify on mere presence can
     * fail on count, and an Offering whose requirement nothing satisfies has no
     * eligible room at all. The run does not fail — it comes back unable to
     * place that Offering — so the cause is named here rather than left to be
     * inferred from a placement that never happened.
     *
     * `bestAvailable` is null when no Room states a count for the feature at
     * all, which is the likelier cause in practice: the requirement was typed
     * and the supply side never was.
     */
    unsatisfiableEquipmentQuantities: {
        id: string;
        title: string;
        feature: string;
        required: number;
        bestAvailable: number | null;
    }[];
    /**
     * Offerings with no establishable capacity requirement. Sent with
     * `minCapacity: 0`, which the solver reads as "any room qualifies" — the
     * silent state this derivation exists to fix, so it is REPORTED. There is no
     * other value to send: the wire field is a plain uint32 with no absent case.
     */
    offeringsWithNoDerivableCapacity: { id: string; title: string }[];
    /**
     * Offerings whose derived capacity rests on a roll that looks INCOMPLETE.
     * Not a narrowing — the real count is still used, because an enrolment list is
     * a fact and a stale estimate is not. Both numbers travel, so 4-of-96 and
     * 86-of-96 are visibly different problems.
     */
    offeringsWithPartialEnrolment: { id: string; title: string; members: number; expected: number }[];
    /**
     * People whose APPROVED unavailability removes at least `HEAVY_VETO_RATIO` of
     * the teaching week. Warn-and-allow (TAXONOMY.md §3): an administrator already
     * approved it, but an infeasible term traces back to somebody's calendar more
     * often than to anything else, and the solver's output cannot say so.
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
    /**
     * Group availability windows, and whether any of them narrows anything.
     *
     * Two numbers for the same reason the preference block below has four: a
     * tenant can set a window, see it saved, enable `group_veto`, and have it
     * change nothing — because the range happens to cover the whole Term, or
     * because week granularity rounded it away. That reads identically to a
     * feature that does not work. `windowsCoveringWholeTerm == windowsSent`
     * means every window is inert.
     */
    groupAvailability: {
        /** Groups being sent that carry a window for this Term. */
        windowsSent: number;
        /** Of those, windows that black out no week at all. */
        windowsCoveringWholeTerm: number;
    };
    /**
     * What the preference rule has to work with, and whether it has anything.
     *
     * TWO DISTINCT FACTS, not one. `droppedOutOfGridValues` is an ordinary
     * narrowing report like the equipment-quantity and multi-room counts: the
     * write boundary validates a preference against the tenant's WIDEST grid, so
     * a stored block can legitimately name a slot this Term's grid has not got,
     * and it is dropped rather than sent as a slot the solver would reject.
     *
     * `placementsWithNoSignal` is not a narrowing at all — nothing was dropped,
     * there was simply nothing to say. It is here because a tenant can enable
     * `person_preference_fit`, give it a weight, see it active in the constraint
     * grid, and have it contribute exactly zero to every placement: no counted
     * lecturer, or none of them has stated anything. That is the `lecturer_veto`
     * shape — a rule that looks configured and can never fire — and the reason it
     * went unnoticed there is precisely that nothing counted it. Equal to
     * `placementsCounted` means the rule is wholly inert.
     */
    preferences: {
        /** Lecturers being sent who have stated something after narrowing. */
        lecturersWithPreference: number;
        /** Values this Term's grid has no day or block for. */
        droppedOutOfGridValues: number;
        /** Placements no counted lecturer has said anything about. */
        placementsWithNoSignal: number;
        /** Placements the rule could speak about at all, so the ratio is readable. */
        placementsCounted: number;
    };
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
 * One stored Constraint row as a wire `ConstraintConfig`, or why it cannot be sent.
 *
 * SKIP-AND-REPORT, never defaults: a rule the tenant never chose, enforced by a
 * solver and reported to nobody, is worse than one that visibly did not run. The
 * type → wire-field mapping is DATA on the catalogue, not a switch here.
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
     * A catalogue entry whose proto field has not shipped yet: skipped and named
     * in the report rather than encoded. The config is assembled with an
     * `as ConstraintConfig` cast and ts-proto writes only fields it knows, so a
     * fabricated field name would send a ConstraintConfig with no params at all.
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
 * rule — and only four carry parameters.
 *
 * `percent` is converted here: tenants think in 0–100, the wire wants 0.0–1.0,
 * and doing it at this single boundary keeps the STORED value the one the user
 * typed.
 *
 * THE `default` BRANCH IS ONLY SAFE FOR A MESSAGE WITH NO FIELDS AT ALL, which
 * is not the same as a message this app sends no values for. ts-proto's encoder
 * iterates a repeated field without a presence check (`for (const v of
 * message.roles)`), so `{}` for a message that HAS a repeated field throws
 * `not iterable` — and it throws inside `hashInput`, before any request is made,
 * which surfaces as the whole assembly failing rather than as a bad constraint.
 * Probed across all sixteen variants: `MaxOnlineShare`, `MinimizeBlockUsage`,
 * `MinimizeDayUsage`, `MinimizeRoomRank` and `PersonPreferenceFit` all crash on
 * `{}`, and the first four have explicit cases below. `PersonPreferenceFit` was
 * the only one that could reach the default, and it did the moment its
 * `wireField` was set.
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

        case 'compactness':
            /*
             * EMPTY MEANS BOTH on the wire, so 'BOTH' sends an empty list rather
             * than naming both scopes. Not interchangeable in principle — the
             * proto's own comment defines empty as "both axes counted
             * independently", so a two-entry list is a second spelling of one
             * state, and two spellings of one state is what `inputHash` cannot
             * see past: the same rule would produce two different hashes and a
             * retry would launch a fresh run.
             */
            return {
                scope: params.scope === 'GROUP'
                    ? [CompactnessScope.COMPACTNESS_SCOPE_GROUP]
                    : params.scope === 'PERSON'
                        ? [CompactnessScope.COMPACTNESS_SCOPE_PERSON]
                        : [],
            };

        case 'minimize_exam_week_sessions':
            /*
             * SENT EXPLICITLY, though `{}` happens to reach the solver as false
             * too. ts-proto writes this field whenever it is not literally
             * `false`, so an absent key encodes as `0800` — an explicit zero
             * rather than nothing — which decodes correctly but makes the bytes,
             * and therefore `inputHash`, depend on a coincidence rather than on
             * a value this mapper chose. `Boolean()` for the same reason it is
             * used on `minimize_high_ranking_rooms` below: a row stored before
             * this parameter existed keeps the direction it already had.
             */
            return { invert: Boolean(params.invert) };

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

        case 'person_preference_fit':
            /*
             * EMPTY, BUT PRESENT. `roles` must be an empty array rather than
             * absent for two independent reasons, and only one of them is about
             * this app.
             *
             * Encoding: see the note above — ts-proto iterates `roles`
             * unguarded, so omitting it throws during `hashInput`.
             *
             * Semantics: the solver REFUSES a non-empty `roles`
             * (`PreferenceRolesUnsupported`) rather than approximating it.
             * Empty means "lecturers only", which is the decided scope — a
             * Session's attendee set includes every member of every attached
             * Group's descendant closure, so counting attendees would let a
             * 200-student cohort's aggregate preference outweigh the person
             * teaching. So this is the only ACCEPTED value, not a placeholder
             * for one; sending a role would fail the run. Solver ADR-0026;
             * DECISIONS.md § "`PersonPreferenceFit.roles`" records the decision
             * and the three things widening it would require first.
             */
            return { roles: [] };

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
            tx.group.findMany({
                where: { tenantId: options.tenantId },
                /*
                 * The Term-scoped availability window, if the tenant set one.
                 * Filtered to THIS Term here rather than at use: a window is a
                 * range of dates inside one Term, and week indices on the wire
                 * are indices into THAT Term's calendar — the same ambiguity
                 * `person_unavailability.term_id` exists to remove.
                 */
                include: { availability: { where: { termId: options.termId } } },
            }),
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
     * Federation-owned ROOMS are included: they arrive through the widened RLS
     * read policy and are sent with other tenants' occupancy of them.
     *
     * Federation-owned OFFERINGS remain excluded — placing one raises "which
     * tenant owns the resulting Session?", a placement-ownership question rather
     * than an occupancy one.
     */
    const includedFederationRooms = roomRows.filter((room) => room.federationId !== null).length;
    const federationOfferings = await tx.offering.count({
        where: { federationId: { not: null }, tenantId: null, termId: term.id, isActive: true },
    });

    /*
     * NO `as Room` HERE, deliberately. This literal used to end `} as Room`,
     * which is an assertion about what the wire wants rather than a check of
     * it: when v0.10.0 added `feature_quantities` the cast kept typecheck green
     * and `Room.encode` threw "featureQuantities is not iterable" at runtime,
     * inside `hashInput`, on every assembly. Checked construction fails at the
     * edit instead.
     */
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
        /*
         * BOTH LISTS, ALWAYS. A feature with a stated quantity appears here too,
         * not only in `featureQuantities` — the solver's two checks are additive
         * and independent (`required_room_features` against this, and
         * `room_feature_requirements` against the quantities), so dropping a
         * counted feature from the presence list would make a room ineligible
         * for every Offering that asks for mere presence of it.
         */
        featureTags: room.roomEquipment.map((link) => link.equipment.key),
        location: room.location ?? '',
        /*
         * The SUPPLY side of equipment counts. Only links that state one: a NULL
         * `quantity` means the tenant never counted this feature for this room,
         * which is not the same as counting it at zero — sending 0 would make
         * the room fail every quantity requirement instead of simply not
         * answering the question.
         */
        featureQuantities: room.roomEquipment
            .filter((link) => link.quantity !== null)
            .map((link) => ({ feature: link.equipment.key, quantity: link.quantity! })),
    }));

    /**
     * The best count any sent Room supplies, per feature — used only to REPORT a
     * requirement nothing can satisfy (see `unsatisfiableEquipmentQuantities`).
     *
     * Built from the same `roomRows` the wire gets, so the report answers the
     * question the solver will actually be asked rather than a wider one about
     * the tenant's whole estate.
     */
    const bestRoomQuantity = new Map<string, number>();

    for (const room of roomRows) {
        for (const link of room.roomEquipment) {
            if (link.quantity === null) {
                continue;
            }

            const key = link.equipment.key;

            bestRoomQuantity.set(key, Math.max(bestRoomQuantity.get(key) ?? 0, link.quantity));
        }
    }

    /**
     * Only the Groups this Term's problem can involve: what the Offerings and
     * Sessions actually REFERENCE, expanded to the conflict closure. NOT filtered
     * by `group_term` — that is human-set configuration, so trusting it here would
     * let a mis-scoped Group produce an input whose Offerings name a `group_id`
     * the solver was never sent. See solverGroups.ts.
     */
    const sentGroupIds = conflictClosure(groupRows, referencedGroupIds(offeringRows, sessionRows));
    const sentGroupRows = groupRows.filter((group) => sentGroupIds.has(group.id));

    // The proof says this holds; asserted because a silently weakened conflict
    // propagation is invisible until a timetable double-books a cohort.
    assertClosedUnderParent(sentGroupRows);

    /**
     * APPROVED unavailability only, through the single read path in
     * `availability.ts`. Until this landed `blackouts` was `[]` unconditionally, so
     * `lecturer_veto` — a HARD constraint enabled by default — ran against an empty
     * set in every solve and could never fire, looking healthy throughout.
     *
     * PENDING and REJECTED are excluded, and that filter is the safety property of
     * the feature: an unreviewed veto reaching the wire would apply a hard
     * constraint nobody approved and announce itself only as unplaced Sessions.
     */
    const blackoutsByPerson = await approvedBlackoutsFor(
        tx,
        personRows.map((person) => person.id),
        // The term being solved. A week-scoped window counts THIS calendar's
        // weeks; one from another term would name a different fortnight.
        term.id,
    );

    /**
     * Stated preferences, narrowed to THIS Term's grid.
     *
     * The write boundary validates against the tenant's widest grid on purpose —
     * a preference is not term-scoped, so it stays expressible for every grid the
     * tenant has. Here one grid is in force, and a value naming a day it does not
     * teach or a block it does not have is dropped and counted. Sending it would
     * be sending the solver a slot that does not exist.
     */
    const preferencesByPerson = await statedPreferencesFor(
        tx,
        personRows.map((person) => person.id),
    );
    const activeDays = new Set(grid.activeDays);
    const narrowedPreferences = new Map<string, {
        days: number[];
        blocks: number[];
        weightMultiplier?: number;
        preferredRoomFeatures: string[];
    }>();
    let droppedOutOfGridValues = 0;

    for (const [personId, stated] of preferencesByPerson) {
        const days = stated.days.filter((day) => activeDays.has(day));
        const blocks = stated.blocks.filter((block) => block < grid.blocksPerDay);

        droppedOutOfGridValues += (stated.days.length - days.length) + (stated.blocks.length - blocks.length);

        /*
         * ROOM FEATURES COUNT TOWARD "has stated something".
         *
         * A lecturer who states ONLY a room preference has no day and no block,
         * so a condition testing those two alone drops their row entirely and
         * their preference never reaches the solver — silently, since an absent
         * `Person.preferred` is a legitimate state meaning "no opinion". The
         * solver guards the mirror image of this on its own side (`room_wanted`
         * is built off `persons[l].preferred` directly rather than off the
         * day/block `counted` set, for exactly this lecturer).
         *
         * An empty result is still NOT stored: after narrowing it means the same
         * thing as no row at all, and `Person.preferred` has one representation
         * for that — absent. Keeping `{days:[],blocks:[]}` would give it two.
         */
        if (days.length > 0 || blocks.length > 0 || stated.roomFeatures.length > 0) {
            narrowedPreferences.set(personId, {
                days,
                blocks,
                /*
                 * NULL becomes ABSENT, never 0. The column's NULL means "use the
                 * tenant default"; the wire field is `optional double` for
                 * exactly this reason, because proto3's zero default is itself a
                 * meaningful multiplier — 0 would mean "ignore this person
                 * entirely". Passing `null` through would not compile, and
                 * coercing it to a number would be the silent wrong answer.
                 */
                weightMultiplier: stated.weightMultiplier ?? undefined,
                /*
                 * NOT GRID-NARROWED, unlike days and blocks, because there is no
                 * grid to narrow against: the vocabulary is the tenant's own
                 * Equipment keys, and a key is either in it or the FK would not
                 * have let the row exist. A preference for a feature no Room
                 * happens to carry is inert rather than invalid — the solver
                 * compares it against each candidate room's features and finds
                 * nothing, which costs the same as having no preference.
                 */
                preferredRoomFeatures: stated.roomFeatures,
            });
        }
    }

    /**
     * Warn-and-allow: refusing heavy unavailability would be this layer overruling
     * an administrator who already approved it. Counted against the DEFAULT grid,
     * blanket windows only — see `blockedSlotSummary`.
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
         * Narrowed to the Groups being sent: a `group_id` the solver was never
         * given is a dangling reference. Dropping the rest loses nothing — a
         * membership only matters if its Group carries a placement in this Term,
         * and such a Group is referenced and therefore in the sent set.
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
        /*
         * ABSENT when the person has stated nothing, rather than an empty
         * `Preference`. The wire's own comment says empty means no preference, so
         * the two are the same fact — and this codebase's rule is that such a
         * fact gets one representation.
         *
         * The rule this feeds is NOT yet sent: the catalogue entry still has no
         * `wireField` — which it now DOES, since `calendry-solver` 41f6227 added
         * the evaluator and the catalogue entry was flipped in the same change.
         * The ordering mattered and is worth keeping: before the evaluator
         * existed, naming the field would have turned a reported skip into
         * `Status::unimplemented`, failing every solve for a tenant that
         * enabled the rule rather than merely doing nothing.
         */
        preferred: narrowedPreferences.get(person.id),
    }));

    let groupsWithAvailabilityWindow = 0;
    let groupWindowsCoveringWholeTerm = 0;

    const groups = sentGroupRows.map((group) => {
        /*
         * POSITIVE IN, NEGATIVE OUT. The tenant stores when the Group IS
         * available; the wire has one convention for absence, shared with
         * `Person.blackouts`. `blackedOutWeeks` owns the flip — see its comment
         * for why a partially-covered week counts as available.
         */
        const window = group.availability[0];
        const weeks = window
            ? blackedOutWeeks(term.startDate, term.endDate, window)
            : [];

        if (window) {
            groupsWithAvailabilityWindow += 1;

            if (weeks.length === 0) {
                // A window that blacks out nothing. Legitimate — a tenant may
                // set a range covering the Term — and worth counting, because
                // "configured" and "configured to no effect" are otherwise the
                // same absence of violations. Same reasoning as
                // `placementsWithNoSignal` for preferences.
                groupWindowsCoveringWholeTerm += 1;
            }
        }

        return {
            id: group.id,
            parentId: group.parentGroupId ?? '',
            name: group.name,
            size: group.expectedSize ?? 0,
            /*
             * ALWAYS AN ARRAY, never omitted. ts-proto iterates a repeated field
             * without a presence check, so an absent `blackouts` throws
             * `not iterable` inside `hashInput` — before any request is made,
             * surfacing as the whole assembly failing rather than as one bad
             * Group. Cost the same hour on `PersonPreferenceFit.roles`.
             */
            blackouts: weeks.length
                ? [{ days: [], blocks: [], weeks, reason: 'group availability window' }]
                : [],
            // group_closure is deliberately NOT transmitted: the solver derives the
            // ancestor/descendant closure from parent_id, and shipping ours would
            // create a second source of truth that can drift undetectably.
        };
    });

    const unsatisfiableEquipmentQuantities: AssemblyReport['unsatisfiableEquipmentQuantities'] = [];
    const offeringsWithNoDerivableCapacity: { id: string; title: string }[] = [];
    const offeringsWithPartialEnrolment: {
        id: string; title: string; members: number; expected: number;
    }[] = [];

    /**
     * Fetched ONCE for the whole assembly: every Offering's closure is walked
     * against the same tree and roll.
     *
     * `groupRows` is every Group in the tenant, deliberately NOT `sentGroupRows`:
     * a Group's real size depends on descendants that may carry no placement of
     * their own, and dropping them would under-count.
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
     * ONE WIRE OFFERING PER SERIES. An Offering carrying two or more Groups means
     * an INDEPENDENT series per Group, each with the full frequency, not one
     * combined Session for the union. The solver needs no change: N wire entries
     * are indistinguishable from N hand-made Offerings.
     */
    const offeringsSplitByGroup: { id: string; title: string; series: number }[] = [];

    /** Wire id -> the real Offering id, for the scope the app keeps. */
    const realOfferingIdOf = new Map<string, string>();

    const offerings: Offering[] = offeringRows.flatMap((offering) => {
        for (const link of offering.equipment) {
            if (link.quantity === null) {
                continue;
            }

            const best = bestRoomQuantity.get(link.equipment.key) ?? null;

            if (best === null || best < link.quantity) {
                unsatisfiableEquipmentQuantities.push({
                    // The REAL Offering id, not a per-series wire id: equipment
                    // is a property of the Offering, so a split would report the
                    // same requirement once per group for no added information.
                    id: offering.id,
                    title: offering.title,
                    feature: link.equipment.key,
                    required: link.quantity,
                    bestAvailable: best,
                });
            }
        }

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
            /*
             * The DEMAND side of equipment counts, and only the links that state
             * one. A link with a NULL quantity is already fully expressed by
             * `requiredRoomFeatures` above — the proto says an absent
             * `min_quantity` asks exactly the presence question — so sending it
             * here as well would be the same requirement twice, and a reader
             * comparing the two lists would have no way to tell which entries
             * carry information.
             */
            roomFeatureRequirements: offering.equipment
                .filter((link) => link.quantity !== null)
                .map((link) => ({ feature: link.equipment.key, minQuantity: link.quantity! })),
            /*
             * STILL ZERO, because this app models neither — not because either
             * is being withheld. Both arrived with proto v0.10.0 and are PROTO
             * ONLY on the solver side too, so what is sent here cannot change a
             * placement either way:
             *
             * STILL ZERO, because this app models no multi-room Session — not
             * because the field is being withheld. 0 and 1 both mean today's
             * single-room behaviour, and the solver assigns one Room per
             * placement regardless. "A Session with more than one Room" is the
             * card; widening it is a data-model change here first.
             */
            requiredRoomCount: 0,
            /*
             * NULL IS UNSPECIFIED, and that is a claim rather than a gap: the
             * Offering has not been classified. Mapping it to DISTRIBUTED — what
             * most timetables assume — would send an institution's assumption as
             * though somebody had chosen it, and the solver would then be free
             * to act on it the moment a pattern rule is enabled.
             */
            schedulingPattern: offering.schedulingPattern === 'DISTRIBUTED'
                ? SchedulingPattern.SCHEDULING_PATTERN_DISTRIBUTED
                : offering.schedulingPattern === 'BLOCK'
                    ? SchedulingPattern.SCHEDULING_PATTERN_BLOCK
                    : SchedulingPattern.SCHEDULING_PATTERN_UNSPECIFIED,
            };
        });
    });

    /**
     * EXISTING SESSIONS MUST SPEAK THE SPLIT'S LANGUAGE. `convert.rs` resolves an
     * existing Session's Offering by matching `offering_id` against the wire ids,
     * so one still carrying its REAL id after a split resolves to nothing: it
     * becomes immovable out-of-scope occupancy, counts toward no series, and the
     * solver places the full frequency again on top of it.
     *
     * A LEGACY COMBINED Session — carrying none or several of the Offering's
     * Groups — belongs to no series and is OMITTED entirely: the apply will delete
     * it, and freezing it as occupancy would block the slots its replacements need.
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
        }));

    /**
     * Whether the preference rule has anything to say about each placement.
     *
     * Counted over the WIRE offerings, after the split, because that is the unit
     * the solver actually places: an Offering that became four series has four
     * independent lecturer sets and four times the placements. `frequency` gives
     * the placement count without inventing one.
     *
     * The counted set is `candidateLecturerIds` (§4.1 — lecturers only). Today
     * the pool equals the requirement, so it IS the set that will lead the
     * session; if genuine pool selection ever lands this becomes a decision
     * variable and this count becomes an upper bound rather than the answer.
     */
    let placementsWithNoSignal = 0;
    let placementsCounted = 0;

    for (const offering of offerings) {
        const placements = Math.max(0, offering.requiredSessionCount);

        placementsCounted += placements;

        const hasSignal = offering.candidateLecturerIds.some((id) => narrowedPreferences.has(id));

        if (!hasSignal) {
            placementsWithNoSignal += placements;
        }
    }

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
            sessionsOverRoomCap: sessionsOverRoomCap(sessionInputs),
            unsatisfiableEquipmentQuantities,
            offeringsWithNoDerivableCapacity,
            offeringsWithPartialEnrolment,
            personsWithHeavyVetoLoad,
            offeringsSplitByGroup,
            legacyCombinedSessionsOmitted,
            skippedConstraints,
            severityMismatches,
            groupsOmitted: groupRows.length - sentGroupRows.length,
            groupAvailability: {
                windowsSent: groupsWithAvailabilityWindow,
                windowsCoveringWholeTerm: groupWindowsCoveringWholeTerm,
            },
            preferences: {
                lecturersWithPreference: personRows.filter((person) => (
                    narrowedPreferences.has(person.id)
                    && person.personRoles.some((link) => link.role.key === 'lecturer')
                )).length,
                droppedOutOfGridValues,
                placementsWithNoSignal,
                placementsCounted,
            },
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
