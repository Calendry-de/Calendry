import { createHash } from 'node:crypto';
import { CompactnessScope, SchedulingPattern, ShareWindow, SolverInput } from '@calendry-de/calendry-proto';
import type {
    ConstraintConfig, ExternalOccupancy, Offering, OfferingRelation, Person, Room, SlotRef,
} from '@calendry-de/calendry-proto';
import type { Tx } from './tenantDb';
import { assertClosedUnderParent, conflictClosure, referencedGroupIds } from './solverGroups';
import {
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
import { resolveRoomRestriction } from './offeringRooms';
import type { RoomRestrictionFailure } from './offeringRooms';
import { forcedOnlineAboveShareCap } from './onlineShareFloor';
import type { ForcedOnlineOverCap, ShareCapOffering, ShareCapRule } from './onlineShareFloor';
import type { DemandEntry } from './solverDemand';
import type { SessionKindType } from '../../shared/sessionKindType';
import { UNBOUNDED_ROOM_CAPACITY } from '../../shared/rooms';
import { LECTURER_ROLE_KEY } from '../../shared/roles';
import { isPlacedSession } from '../../shared/sessionPlacement';
// Relative, not `#shared`: this module is loaded OUTSIDE Nuxt too, by
// scripts/ and by vitest, where Nuxt's aliases do not exist. App code under
// app/ can use `#shared` freely because it only ever runs inside Nuxt.
import {
    findConstraintType,
    missingConstraintParams,
    parseBlockPositions,
    parseWeekdayList,
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
 * Federation-owned Offerings are EXCLUDED: including a shared resource while
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
     * one Room. That gap is closed: `Session.room_ids` now carries the full
     * set and the solver honours it, so the reason to report has narrowed to
     * the cap: beyond four Rooms `convert.rs` truncates silently, which puts the
     * solver back to reasoning about a Session occupying less Room than it
     * really does.
     */
    sessionsOverRoomCap: string[];
    /**
     * How many Offerings carry each scheduling pattern.
     *
     * EXISTS TO EXPOSE AN INERT RULE. `distributed_pattern_adherence` and
     * `block_pattern_adherence` price only the Offerings tagged with their own
     * pattern, and an Offering nobody has classified is untouched by both,
     * which is every Offering until somebody sets the field. So a tenant can
     * enable either rule, weight it, see it in the catalogue, and have it do
     * nothing at all.
     *
     * That is the `lecturer_veto` shape this codebase already paid for: a rule
     * that looks configured and can never fire, unnoticed precisely because
     * nothing counted it. Counting it is the whole fix.
     */
    offeringsByPattern: { distributed: number; block: number; unclassified: number };
    /**
     * Offerings asking for more Rooms at once than the snapshot even contains.
     *
     * A DEFINITE impossibility, unlike most of what the solver weighs: it does
     * not depend on capacity, features or what else is placed. Fewer Rooms exist
     * than one Session must occupy simultaneously, so no combination can be
     * built and the Offering cannot be placed at all.
     *
     * Reported rather than refused, matching `unsatisfiableEquipmentQuantities`:
     * the run is still worth making, and the answer comes back as hard
     * violations. What is not acceptable is for the cause to be invisible:
     * "why is this course unplaced" has an exact answer here, and it is one
     * nobody would guess from a violation naming a slot.
     */
    offeringsNeedingMoreRoomsThanExist: { id: string; title: string; needs: number; available: number }[];
    /**
     * Equipment quantity requirements NO sent Room can meet.
     *
     * This replaced `droppedEquipmentQuantities`, which counted requirements the
     * wire could not carry, a gap that closed when `Offering
     * .room_feature_requirements` and `Room.feature_quantities` shipped in proto
     * v0.10.0. The reason to report anything here now is the opposite one: those
     * counts are ENFORCED, so a room that used to qualify on mere presence can
     * fail on count, and an Offering whose requirement nothing satisfies has no
     * eligible room at all. The run does not fail: it comes back unable to
     * place that Offering, so the cause is named here rather than left to be
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
     * ROOM PINS AND REQUIRED-ONLINE THAT NOTHING CAN SATISFY (issue #123).
     *
     * THE SHARPEST TRAP IN THIS FILE, which is why it is a report entry and not
     * a narrowing. `Offering.allowed_room_ids` is EMPTY = ANY ROOM on the wire,
     * so a restriction that shrinks to nothing on the way out reads as its own
     * opposite: "must be online" becomes "anywhere at all" and every Session
     * lands in a physical room with nobody told. `resolveRoomRestriction`
     * (`server/utils/offeringRooms.ts`) therefore sends `NO_ELIGIBLE_ROOM_ID`
     * rather than `[]`, the Offering comes back unplaced, and this names why.
     *
     * The three reasons have three different fixes and the solver's output
     * names none of them: create a virtual Room, reactivate (or re-share) the
     * pinned Room, or stop asking for two contradictory things at once.
     */
    offeringsWithUnsatisfiableRoomRestriction: {
        id: string;
        title: string;
        reason: RoomRestrictionFailure;
        /** Rooms named by `offering_room`, present in the snapshot or not. */
        pinnedStored: number;
        /** How many of those the snapshot actually holds. */
        pinnedInSnapshot: number;
        virtualInSnapshot: number;
    }[];
    /**
     * Offerings whose Room restriction leaves fewer Rooms than ONE Session must
     * occupy simultaneously.
     *
     * A DEFINITE impossibility, the same class as
     * `offeringsNeedingMoreRoomsThanExist` — which compares against the whole
     * snapshot and would keep quietly passing an Offering pinned to one Room
     * but needing two. Both entries stay: they answer different questions
     * ("the institution has too few Rooms" vs "you narrowed it too far"), and
     * the second is the one somebody can act on today.
     */
    offeringsWithRestrictionBelowRoomCount: { id: string; title: string; available: number; needs: number }[];
    /**
     * GROUPS WHOSE ONLINE-SHARE CAP IS UNREACHABLE BECAUSE THE TEACHING IS
     * FORCED ONLINE.
     *
     * `max_online_ratio_per_group` is HARD, so a group over its cap comes back
     * as a residual `MaxOnlineShare` violation. That reads as a placement
     * somebody can fix, and for these groups it is not one: an Offering whose
     * Room restriction permits virtual Rooms only has no on-site placement to
     * be moved to, so once its demand alone exceeds the cap no arrangement of
     * anything can satisfy the rule.
     *
     * REPORTED, NOT NARROWED: the rule still crosses the wire as configured and
     * the run still comes back with its violation. This says WHY, naming the
     * groups and the Offerings, so the reviewer reads "these lessons must be
     * placed online" rather than "the solver broke a hard rule". The
     * distinction cannot be drawn on the solver's side — `MaxOnlineShare`
     * reaches it as a ratio and a window, and its violation names neither a
     * Session nor an Offering. See `onlineShareFloor.ts`.
     */
    groupsWithForcedOnlineAboveShareCap: ForcedOnlineOverCap[];
    /**
     * A pinned Room that never reaches the wire: inactive, or not visible in
     * this snapshot at all (deleted, or federation-owned and out of reach).
     *
     * Reported per Room rather than per Offering because the fix is per Room,
     * and reported even when other pinned Rooms survive: silently shrinking an
     * allow-list is how a pin that was a real choice becomes a narrower one
     * nobody made. When it shrinks to ZERO,
     * `offeringsWithUnsatisfiableRoomRestriction` says so as well.
     */
    pinnedRoomsNotSent: { id: string; title: string; roomId: string; reason: 'inactive' | 'absent' }[];
    /**
     * A Room restriction that survives, but whose Rooms cannot meet the
     * Offering's OWN capacity or feature requirements.
     *
     * The combination that makes this likely is not one person's mistake:
     * somebody pins the room, somebody else later raises `requiredCapacity` or
     * attaches equipment, and no screen shows the two together. Capacity is
     * SUMMED across `requiredRoomCount` Rooms, matching `convert.rs`; features
     * are required of EACH Room, also matching it.
     *
     * Reported per SERIES (the wire id), not per Offering: a split Offering
     * derives its capacity per Group, so one series can be too big for the
     * pinned room while its siblings fit.
     */
    offeringsWithNoSuitablePinnedRoom: {
        id: string;
        title: string;
        reason: 'capacity' | 'features';
        /** Rooms the restriction leaves. */
        available: number;
        minCapacity: number;
        /** Best capacity reachable from the restricted set, summed over `requiredRoomCount`. */
        bestCapacity: number;
    }[];
    /**
     * Offerings with no establishable capacity requirement. Sent with
     * `minCapacity: 0`, which the solver reads as "any room qualifies": the
     * silent state this derivation exists to fix, so it is REPORTED. There is no
     * other value to send: the wire field is a plain uint32 with no absent case.
     */
    offeringsWithNoDerivableCapacity: { id: string; title: string }[];
    /**
     * Offerings whose derived capacity rests on a roll that looks INCOMPLETE.
     * Not a narrowing: the real count is still used, because an enrolment list is
     * a fact and a stale estimate is not. Both numbers travel, so 4-of-96 and
     * 86-of-96 are visibly different problems.
     */
    offeringsWithPartialEnrolment: { id: string; title: string; members: number; expected: number }[];
    /**
     * Offerings whose explicit `requiredLecturerCount` exceeds the attached
     * candidate pool (`offering.lecturers.length`). The wire is never sent the
     * impossible number: `required` is clamped down to `available` before it
     * ships, so this is the only place the mismatch is visible at all.
     */
    offeringsWithInsufficientLecturers: { id: string; title: string; required: number; available: number }[];
    /**
     * Offerings sent with an EMPTY candidate pool and no explicit
     * `requiredLecturerCount` (issue #130). The derivation
     * `requiredLecturerCount ?? Math.min(1, pool.length)` is deliberate for a
     * non-empty pool, and collapses to zero for an empty one: the wire then
     * reads "requires zero lecturers", identical to what a genuinely
     * lecturer-free kind (self-directed study, `SessionKind.requiresLecturer
     * = false`) sends on purpose. This is the ONLY signal that tells the two
     * apart, so it is reported rather than silently accepted for every OTHER
     * kind, where an empty pool means nobody has staffed the Offering yet.
     *
     * Disjoint from `offeringsWithInsufficientLecturers` above: that entry
     * fires on an explicit, too-large `requiredLecturerCount`; this one fires
     * only when the count was never set at all, so a tenant who explicitly
     * wrote `requiredLecturerCount: 0` — a deliberate per-Offering statement,
     * not the kind's default — is not reported either.
     */
    offeringsWithNoLecturerAssigned: { id: string; title: string }[];
    /**
     * Series whose per-Group LECTURER PIN (`offering_group.lecturer_person_id`,
     * issue #131) names a person who is NOT in the Offering's candidate pool,
     * so the pin was IGNORED and the series sent with the pool instead.
     *
     * The pin is meant to narrow the pool, never to widen it: honouring a pin
     * outside the pool would put someone on the wire as a candidate whom
     * `OfferingLecturer` — the one authority on who leads an Offering, for
     * self-service and for `/api/me/offerings` alike — says does not. Reported
     * rather than refused at the write for the reason the pool has no CHECK
     * against `requiredLecturerCount` either: the roster and the pin are
     * saved by separate requests, and the pool can shrink under a pin at any
     * time. Keyed by WIRE id (the series), since only that series is affected.
     */
    offeringsWithLecturerPinOutsidePool: { id: string; title: string; groupId: string; personId: string }[];
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
     * Sessions of a split Offering that belong to no single series: they carry
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
     * that type. Sent using the CATALOGUE's severity (the wire has no severity
     * field, the type determines it), with any weight on a HARD type ignored.
     */
    severityMismatches: { id: string; type: string; stored: string; expected: string }[];
    /**
     * A relation (e.g. `different_time`) naming an Offering that no longer
     * exists in this Term's snapshot: deleted after being added, or never
     * belonging to this Term. Filtered out here rather than sent and left for
     * the solver's `ConvertError::UnknownOffering` to refuse the WHOLE run:
     * a dangling member makes only ITS relation unenforceable, not every rule
     * in the tenant.
     */
    relationsWithDanglingMembers: { id: string; type: string; danglingOfferingIds: string[] }[];
    /**
     * Groups the tenant has that this Term's problem does not involve, and which
     * were therefore not sent. Reported rather than narrowed quietly, like every
     * other omission in this report: it is the difference between "the tenant
     * has three cohorts" and "this Term uses three cohorts", and a run that
     * looks wrong is easier to explain with the number in hand.
     */
    groupsOmitted: number;
    /**
     * Group availability windows, and whether any of them narrows anything.
     *
     * Two numbers for the same reason the preference block below has four: a
     * tenant can set a window, see it saved, enable `group_veto`, and have it
     * change nothing, because the range happens to cover the whole Term, or
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
     * `placementsWithNoSignal` is not a narrowing at all: nothing was dropped,
     * there was simply nothing to say. It is here because a tenant can enable
     * `person_preference_fit`, give it a weight, see it active in the constraint
     * grid, and have it contribute exactly zero to every placement: no counted
     * lecturer, or none of them has stated anything. That is the `lecturer_veto`
     * shape (a rule that looks configured and can never fire), and the reason it
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
    /**
     * WHAT WAS ASKED, PER WIRE OFFERING: the record the apply reconciles
     * against.
     *
     * Every other field here reports something NARROWED on the way to the wire.
     * This one reports what was sent in full, and it is here because the apply
     * needs it later: `planMaterialization()` deletes an in-scope Session the
     * output does not mention, and that inference is only sound while the
     * output carries every Offering's full `required_session_count`. A run that
     * came back short must not be allowed to authorise those deletes, and
     * nothing downstream can tell short from complete without this.
     *
     * Recorded rather than recomputed at apply time: see the module comment on
     * `solverDemand.ts` for why the Offering as it is NOW is the wrong answer.
     */
    demand: DemandEntry[];
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
    /** SHA-256 over the serialized input, which makes "same problem?" answerable. */
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
    timeGridId?: string | null;
}, kindKeyById: Map<string, string>, kindKeysByType?: Map<SessionKindType, string[]>, runTimeGridId?: string | null): { config: ConstraintConfig } | { skip: string } {
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
     * has only `applies_to_kinds`; there is no offering-scoped equivalent.
     * Skipped rather than degraded to unscoped, which would silently WIDEN the
     * rule to every offering: the opposite of what was configured.
     */
    /*
     * A PARAMETER COMBINATION THAT CANNOT BE SENT (`ConstraintTypeDef
     * .unsendableWhen`): `protected_block` with no days and no blocks would
     * reserve the ENTIRE timetable rather than nothing (an empty axis means
     * "every value"), and `minimize_block_usage` with nothing selected has no
     * blocks to steer away from at all. Skipped and named here as ordinary
     * narrowing; `validateConstraint` (shared/constraintTypes.ts) runs the
     * SAME check before a run is even created, so the tenant sees this before
     * clicking "Generate schedule" rather than reading it off a skipped-rule
     * report after the fact.
     */
    const unsendable = type.unsendableWhen?.(params);

    if (unsendable) {
        return { skip: unsendable.message };
    }

    /**
     * A RULE SCOPED TO ANOTHER GRID IS NOT SENT, and this is the one skip here
     * that is not a defect.
     *
     * `SolverInput.time_grid` is SINGULAR: a run is per-Term and a Term has
     * exactly one grid, so the solver has nothing to disambiguate and no field
     * to carry this. The filter therefore has to be applied on the way out, and
     * a rule about the evening grid must simply not appear in a run over the
     * academic one.
     *
     * Reported like every other skip, deliberately, even though it is routine:
     * a tenant looking for why a rule did not apply gets the answer in the same
     * place as every other reason, rather than having to know that this one
     * category is silent.
     */
    if (row.timeGridId && runTimeGridId && row.timeGridId !== runTimeGridId) {
        return {
            skip: 'Scoped to a different TimeGrid than this term uses, so it does not apply '
                + 'here. This is ordinary narrowing, not a misconfiguration.',
        };
    }

    if (row.scopes.some((scope) => scope.offeringId)) {
        return {
            skip: 'Scoped to specific offerings, which the wire cannot express '
                + '(ConstraintConfig carries applies_to_kinds only). Sending it unscoped '
                + 'would widen the rule rather than narrow it.',
        };
    }

    /**
     * A DECLARED type derives its kinds; it does not read `ConstraintScope`.
     *
     * `kindKeysByType` is optional so the many callers that only ever pass
     * ordinary rows (tests, `violations.ts`) are unchanged. Absent is treated
     * as "no kind is classified", which is the SAFE reading: it produces the
     * skip below rather than an empty list.
     */
    const declared = type.appliesToKindType;
    const appliesToKinds = declared
        ? (kindKeysByType?.get(declared) ?? [])
        : row.scopes
            .map((scope) => (scope.kindId ? kindKeyById.get(scope.kindId) : undefined))
            .filter((key): key is string => Boolean(key));

    /**
     * AN EMPTY DERIVED SET IS NOT AN EMPTY SCOPE: it is the whole institution.
     *
     * `ConstraintConfig.applies_to_kinds` says "Empty = all kinds", so sending
     * `[]` here would turn "no group may sit two EXAMS in a day" into "no group
     * may sit two SESSIONS in a day" for a tenant whose only mistake was never
     * classifying a kind. The wire has no way to say "no kinds", so the only
     * honest answer is not to send the rule.
     *
     * Reported, never silent: a rule the tenant enabled and weighted is not
     * being applied, and the fix (classify a kind as EXAM) is not something
     * anyone would guess from a timetable.
     *
     * Note this cannot happen to a manually scoped rule, where an empty set
     * legitimately means "every kind" and the tenant chose it.
     */
    if (declared && appliesToKinds.length === 0) {
        return {
            skip: `No session kind is classified as ${declared}, so this rule has nothing `
                + 'to apply to. Sending it would widen it to EVERY kind rather than none, '
                + `because the wire reads an empty scope as "all kinds". Set a session `
                + `kind's type to ${declared} to switch the rule on.`,
        };
    }

    const config = {
        id: row.id,
        enabled: true,
        appliesToKinds,
        // Meaningful for SOFT only; the solver ignores it for a HARD type. Read
        // from the catalogue's severity, not the row's; see severityMismatch.
        weight: type.severity === 'SOFT' ? (row.weight ?? 0) : 0,
        [type.wireField]: buildVariant(type.key, params),
    } as ConstraintConfig;

    return { config };
}

/**
 * The per-relation-type payload: `OfferingRelation`'s equivalent of
 * `buildVariant` above, kept separate because a relation's wire shape
 * (`offeringIds` plus one discriminated variant) is not a `ConstraintConfig`
 * at all (see `assembleSolverInput`'s relation carve-out).
 *
 * `null` for an unmapped key: a catalogue entry can carry `relation` before
 * its wire variant ships, the same "ahead of the schema" situation
 * `ConstraintTypeDef.wireField` documents; reported by the caller rather
 * than guessed at here.
 */
function wireRelationVariant(
    typeKey: string,
    params: Record<string, unknown>,
): Pick<OfferingRelation, 'differentTime' | 'sameTime' | 'sameDays' | 'sameStart' | 'precedence'> | null {
    switch (typeKey) {
        case 'different_time':
            return { differentTime: {} };
        case 'same_time':
            return { sameTime: {} };
        case 'same_days':
            return { sameDays: {} };
        case 'same_start':
            return { sameStart: {} };
        case 'precedence':
            // `Number(undefined)` is NaN, and a NaN on the wire is a refused
            // run, so both fall back to the proto's own zero ("back-to-back
            // allowed", "no ceiling"), which is what the catalogue defaults to.
            return {
                precedence: {
                    minGapMinutes: Number(params.minGapMinutes) || 0,
                    maxDaysBetween: Number(params.maxDaysBetween) || 0,
                },
            };
        default:
            return null;
    }
}

/**
 * The per-type payload. Most variants are empty messages (the type IS the
 * rule), and only four carry parameters.
 *
 * `percent` is converted here: tenants think in 0–100, the wire wants 0.0–1.0,
 * and doing it at this single boundary keeps the STORED value the one the user
 * typed.
 *
 * THE `default` BRANCH IS ONLY SAFE FOR A MESSAGE WITH NO FIELDS AT ALL, which
 * is not the same as a message this app sends no values for. ts-proto's encoder
 * iterates a repeated field without a presence check (`for (const v of
 * message.roles)`), so `{}` for a message that HAS a repeated field throws
 * `not iterable`, and it throws inside `hashInput`, before any request is made,
 * which surfaces as the whole assembly failing rather than as a bad constraint.
 * Probed across all sixteen variants: `MaxOnlineShare`, `MinimizeBlockUsage`,
 * `MinimizeDayUsage`, `MinimizeRoomRank` and `PersonPreferenceFit` all crash on
 * `{}`, and the first four have explicit cases below. `PersonPreferenceFit` was
 * the only one that could reach the default, and it did the moment its
 * `wireField` was set.
 *
 * `parseWeekdayList`/`parseBlockPositions` moved to `shared/constraintTypes.ts`
 * (imported above): `unsendableWhen` needs them too, and that file is loaded
 * client-side, where this one (importing `node:crypto`) cannot go.
 */

/**
 * The GROUP / PERSON / BOTH selector shared by every whole-day rule.
 *
 * EMPTY MEANS BOTH on the wire, so 'BOTH' sends an empty list rather than
 * naming both scopes. Not interchangeable in principle: the proto defines
 * empty as "both axes counted independently", so a two-entry list is a second
 * spelling of one state, and two spellings is what `inputHash` cannot see past:
 * the same configured rule would hash two ways and a retry would launch a fresh
 * run instead of replaying.
 *
 * One function rather than one copy per type, because that identity is the
 * whole reason these rules are comparable to each other; four copies would
 * agree until one of them was edited.
 */
function compactnessScope(value: unknown): CompactnessScope[] {
    if (value === 'GROUP') {
        return [CompactnessScope.COMPACTNESS_SCOPE_GROUP];
    }

    if (value === 'PERSON') {
        return [CompactnessScope.COMPACTNESS_SCOPE_PERSON];
    }

    return [];
}

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
                 * sends false, which is the behaviour it already had. An
                 * absent key must not become a direction the tenant never
                 * chose, and 0.5.0's own default for the field is the same
                 * false, so the two agree.
                 */
                invert: Boolean(params.invert),
            };

        case 'max_concurrent_online_sessions':
            return { maxConcurrent: Number(params.maxConcurrent) };

        case 'room_turnaround_buffer':
            return { bufferBlocks: Number(params.bufferBlocks) };

        case 'minimize_room_churn':
            return { maxRoomsPerWeek: Number(params.maxRoomsPerWeek) };

        case 'minimize_capacity_waste':
            return { wasteRatioThreshold: Number(params.wasteRatioThreshold) };

        case 'max_weekly_teaching_load':
            return {
                maxPerWeek: Number(params.maxPerWeek),
                // `Boolean()`, so a row stored before this parameter existed
                // reads as false: the sessions-not-blocks reading it had.
                countBlocks: Boolean(params.countBlocks),
            };

        case 'max_consecutive_blocks':
            return {
                scope: compactnessScope(params.scope),
                maxConsecutive: Number(params.maxConsecutive),
            };

        case 'max_daily_span':
            return {
                scope: compactnessScope(params.scope),
                maxSpanBlocks: Number(params.maxSpanBlocks),
            };

        case 'minimize_location_change':
            return {
                scope: compactnessScope(params.scope),
                maxLocationsPerDay: Number(params.maxLocationsPerDay),
            };

        case 'exam_spacing_window':
            return { minDaysBetween: Number(params.minDaysBetween) };

        case 'protected_block':
            /*
             * ONE WINDOW, and `weeks` deliberately empty: the proto reads that
             * as every week, which is the recurring reservation this form
             * offers. Blocks are 1-based for a human and 0-based on the wire,
             * converted here exactly as `minimize_block_usage` does.
             */
            return {
                windows: [{
                    days: parseWeekdayList(params.days),
                    blocks: parseBlockPositions(params.blocks),
                    weeks: [],
                }],
            };

        case 'compactness':
            return { scope: compactnessScope(params.scope) };

        case 'max_offering_sessions_per_day':
            return { maxPerDay: Number(params.maxPerDay) };

        case 'max_consecutive_offering_blocks':
            return { maxConsecutive: Number(params.maxConsecutive) };

        case 'max_daily_session_count':
            return {
                scope: compactnessScope(params.scope),
                maxPerDay: Number(params.maxPerDay),
            };

        case 'max_days':
            return {
                scope: compactnessScope(params.scope),
                maxDays: Number(params.maxDays),
            };

        case 'max_consecutive_days':
            return {
                scope: compactnessScope(params.scope),
                maxConsecutiveDays: Number(params.maxConsecutiveDays),
            };

        case 'daybreak':
            return {
                scope: compactnessScope(params.scope),
                minRestMinutes: Number(params.minRestMinutes),
            };

        case 'travel_time_between_rooms':
            return {
                scope: compactnessScope(params.scope),
                minMinutesBetweenSites: Number(params.minMinutesBetweenSites),
            };

        case 'minimize_exam_week_sessions':
            /*
             * SENT EXPLICITLY, though `{}` happens to reach the solver as false
             * too. ts-proto writes this field whenever it is not literally
             * `false`, so an absent key encodes as `0800`, an explicit zero
             * rather than nothing, which decodes correctly but makes the bytes,
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
                blocks: parseBlockPositions(params.blocks),
                first: Boolean(params.first),
                last: Boolean(params.last),
            };

        case 'person_preference_fit':
            /*
             * EMPTY, BUT PRESENT. `roles` must be an empty array rather than
             * absent for two independent reasons, and only one of them is about
             * this app.
             *
             * Encoding: see the note above: ts-proto iterates `roles`
             * unguarded, so omitting it throws during `hashInput`.
             *
             * Semantics: the solver REFUSES a non-empty `roles`
             * (`PreferenceRolesUnsupported`) rather than approximating it.
             * Empty means "lecturers only", which is the decided scope: a
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
        // block that is. Since issue #26 the breaks ALSO reach the solver, for
        // `MinimizeBreakSpanning` alone;
        // see toWireTimeGrid().
        include: { timeGrid: { include: { breaks: true } }, calendarPeriods: true },
    });

    if (!term) {
        throw createError({ statusCode: 404, message: 'Term not found.' });
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
            message: 'This term has no TimeGrid and the tenant has no default. Nothing can be placed.',
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

    // Sequential: `tx` is one shared connection; concurrent queries on it
    // trip pg's deprecated overlapping-query warning.
    const roomRows = await tx.room.findMany({
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
    });
    const personRows = await tx.person.findMany({
        where: { tenantId: options.tenantId, isActive: true },
        include: { personRoles: { include: { role: true } }, memberships: true },
    });
    const groupRows = await tx.group.findMany({
        where: { tenantId: options.tenantId },
        /*
         * The Term-scoped availability window, if the tenant set one.
         * Filtered to THIS Term here rather than at use: a window is a
         * range of dates inside one Term, and week indices on the wire
         * are indices into THAT Term's calendar, the same ambiguity
         * `person_unavailability.term_id` exists to remove.
         */
        include: { availability: { where: { termId: options.termId } } },
    });
    const offeringRows = await tx.offering.findMany({
        where: { tenantId: options.tenantId, termId: term.id, isActive: true },
        include: {
            kind: true,
            groups: true,
            lecturers: true,
            equipment: { include: { equipment: true } },
            // The ROOM PIN (issue #123). Ids only: everything the resolution
            // needs about a Room comes from `roomRows`, which is the set
            // actually being sent, so joining the Room here would invite a
            // check against a Room the solver never sees.
            pinnedRooms: { select: { roomId: true } },
        },
    });
    const sessionRows = await tx.session.findMany({
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
    });
    const constraintRows = await tx.constraint.findMany({
        where: { tenantId: options.tenantId, isEnabled: true },
        include: { scopes: true, relationMembers: { orderBy: { position: 'asc' } } },
    });
    const lecturerRole = await tx.role.findFirst({ where: { tenantId: options.tenantId, key: LECTURER_ROLE_KEY }, select: { id: true } });

    /**
     * Federation-owned ROOMS are included: they arrive through the widened RLS
     * read policy and are sent with other tenants' occupancy of them.
     *
     * Federation-owned OFFERINGS remain excluded: placing one raises "which
     * tenant owns the resulting Session?", a placement-ownership question rather
     * than an occupancy one.
     */
    const includedFederationRooms = roomRows.filter((room) => room.federationId !== null).length;
    const federationOfferings = await tx.offering.count({
        where: { federationId: { not: null }, tenantId: null, termId: term.id, isActive: true },
    });

    /**
     * PINNED ROOMS THAT WILL NOT BE SENT, classified.
     *
     * `roomRows` differs from this query by exactly one clause (`isActive`), so
     * a pinned Room this finds and `roomRows` does not is INACTIVE, and one
     * neither finds is ABSENT: deleted, or federation-owned and out of this
     * tenant's reach. Two states with two different fixes, which is why they
     * are distinguished rather than both reported as "gone".
     *
     * Run once for the whole assembly rather than per Offering: pins overlap
     * heavily (a department pins the same three halls on twenty Offerings).
     */
    const pinnedRoomIdsInUse = [...new Set(
        offeringRows.flatMap((offering) => offering.pinnedRooms.map((link) => link.roomId)),
    )];
    const pinnedRoomsAnyState = pinnedRoomIdsInUse.length
        ? await tx.room.findMany({
            where: {
                id: { in: pinnedRoomIdsInUse },
                OR: [
                    { tenantId: options.tenantId },
                    { tenantId: null, federationId: { not: null } },
                ],
            },
            select: { id: true },
        })
        : [];
    /** Pinned Rooms that EXIST and are visible here, active or not. */
    const visiblePinnedRoomIds = new Set(pinnedRoomsAnyState.map((room) => room.id));

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
        /*
         * 0 MEANS UNLIMITED, translated here because the wire cannot say it;
         * see `UNBOUNDED_ROOM_CAPACITY`. Without this, the column's own default
         * makes an unmeasured room ineligible for everything.
         */
        capacity: room.capacity === 0 ? UNBOUNDED_ROOM_CAPACITY : room.capacity,
        // Same direction on both sides: HIGHER = more premium/scarce.
        rank: Math.max(0, room.ranking),
        isVirtual: room.isVirtual,
        /*
         * BOTH LISTS, ALWAYS. A feature with a stated quantity appears here too,
         * not only in `featureQuantities`: the solver's two checks are additive
         * and independent (`required_room_features` against this, and
         * `room_feature_requirements` against the quantities), so dropping a
         * counted feature from the presence list would make a room ineligible
         * for every Offering that asks for mere presence of it.
         */
        featureTags: room.roomEquipment.map((link) => link.equipment.key),
        location: room.location ?? '',
        /*
         * DELIBERATELY EMPTY, and not a gap (issue #38). The solver's
         * `TravelTimeBetweenRooms` reads `location` above, the same field
         * `MinimizeLocationChange` reads, and documents `site` as an unused
         * duplicate kept only because removing it would rewrite a made
         * commit. Sending `location` here as well would be the second field
         * for the identical concept the solver declined to introduce.
         */
        site: '',
        /*
         * The SUPPLY side of equipment counts. Only links that state one: a NULL
         * `quantity` means the tenant never counted this feature for this room,
         * which is not the same as counting it at zero: sending 0 would make
         * the room fail every quantity requirement instead of simply not
         * answering the question.
         */
        featureQuantities: room.roomEquipment
            .filter((link) => link.quantity !== null)
            .map((link) => ({ feature: link.equipment.key, quantity: link.quantity! })),
        // Issue #121. Inert until a `minimize_specialized_room_use` row is
        // enabled, and even then only priced for Offerings needing none of
        // this Room's features: the proto's documented semantics.
        isSpecialized: room.isSpecialized,
        /*
         * SHARED PHYSICAL FOOTPRINTS (issue #122; proto 0.17.0, solver
         * ADR-0022's third addendum). Rooms carrying the same tag occupy one
         * space; the solver expands the footprint on the QUERY side of its
         * occupancy check, never on mark, so overlap stays non-transitive.
         * Sent verbatim: a tag only one Room carries is inert, and a virtual
         * Room never carries one (the DB CHECK refuses it at the write, where
         * the solver would otherwise refuse it at conversion).
         */
        footprintTags: room.footprintTags,
    }));

    /**
     * The best count any sent Room supplies, per feature, used only to REPORT a
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
     * The Rooms this run is actually about, reduced to what a Room RESTRICTION
     * depends on (issue #123). Built from `roomRows`, never from the tenant's
     * whole estate: an allow-list resolved against Rooms the solver will not
     * see is an answer to a different question, and the one way to get this
     * wrong.
     */
    const roomFacts = roomRows.map((room) => ({ id: room.id, isVirtual: room.isVirtual }));
    const sentRoomIds = new Set(roomFacts.map((room) => room.id));

    /**
     * DERIVED EVERY RUN FROM `Room.isVirtual`, never persisted and never a
     * well-known id: nothing restricts a tenant to one virtual Room, and one
     * created next week must count for an Offering that already asked to be
     * online. The same flag `resolveRoomRestriction` and `violations.ts` key on.
     */
    const virtualRoomIds = new Set(roomFacts.filter((room) => room.isVirtual).map((room) => room.id));

    /**
     * Per-Room capacity and features, for judging whether a surviving
     * restriction can meet the Offering's own requirements.
     *
     * `UNBOUNDED_ROOM_CAPACITY` applied here for the same reason the wire
     * applies it: a Room measured at 0 is unmeasured, not tiny, and comparing
     * against the raw column would report every virtual Room as too small for
     * everything.
     */
    const roomProfile = new Map(roomRows.map((room) => [room.id, {
        capacity: room.capacity === 0 ? UNBOUNDED_ROOM_CAPACITY : room.capacity,
        features: new Set(room.roomEquipment.map((link) => link.equipment.key)),
        quantities: new Map(
            room.roomEquipment
                .filter((link) => link.quantity !== null)
                .map((link) => [link.equipment.key, link.quantity!]),
        ),
    }]));

    /**
     * Only the Groups this Term's problem can involve: what the Offerings and
     * Sessions actually REFERENCE, expanded to the conflict closure. NOT filtered
     * by `group_term`: that is human-set configuration, so trusting it here would
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
     * `lecturer_veto` (a HARD constraint enabled by default) ran against an empty
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
     * The write boundary validates against the tenant's widest grid on purpose:
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
         * their preference never reaches the solver, silently, since an absent
         * `Person.preferred` is a legitimate state meaning "no opinion". The
         * solver guards the mirror image of this on its own side (`room_wanted`
         * is built off `persons[l].preferred` directly rather than off the
         * day/block `counted` set, for exactly this lecturer).
         *
         * An empty result is still NOT stored: after narrowing it means the same
         * thing as no row at all, and `Person.preferred` has one representation
         * for that: absent. Keeping `{days:[],blocks:[]}` would give it two.
         */
        if (days.length > 0 || blocks.length > 0 || stated.roomFeatures.length > 0) {
            narrowedPreferences.set(personId, {
                days,
                blocks,
                /*
                 * NULL becomes ABSENT, never 0. The column's NULL means "use the
                 * tenant default"; the wire field is `optional double` for
                 * exactly this reason, because proto3's zero default is itself a
                 * meaningful multiplier: 0 would mean "ignore this person
                 * entirely". Passing `null` through would not compile, and
                 * coercing it to a number would be the silent wrong answer.
                 */
                weightMultiplier: stated.weightMultiplier ?? undefined,
                /*
                 * NOT GRID-NARROWED, unlike days and blocks, because there is no
                 * grid to narrow against: the vocabulary is the tenant's own
                 * Equipment keys, and a key is either in it or the FK would not
                 * have let the row exist. A preference for a feature no Room
                 * happens to carry is inert rather than invalid; the solver
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
     * blanket windows only; see `blockedSlotSummary`.
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
         * given is a dangling reference. Dropping the rest loses nothing: a
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
            // it changes no placement, and the solver never reads it, so it
            // stays in the database where the tenant's own access rules govern
            // it rather than travelling to a service that has no use for it.
            reason: '',
        })),
        /*
         * ABSENT when the person has stated nothing, rather than an empty
         * `Preference`. The wire's own comment says empty means no preference, so
         * the two are the same fact, and this codebase's rule is that such a
         * fact gets one representation.
         *
         * The rule this feeds is NOT yet sent: the catalogue entry still has no
         * `wireField`, which it now DOES, since `calendry-solver` 41f6227 added
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
         * `Person.blackouts`. `blackedOutWeeks` owns the flip; see its comment
         * for why a partially-covered week counts as available.
         */
        const window = group.availability[0];
        const weeks = window
            ? blackedOutWeeks(term.startDate, term.endDate, window)
            : [];

        if (window) {
            groupsWithAvailabilityWindow += 1;

            if (weeks.length === 0) {
                // A window that blacks out nothing. Legitimate, since a tenant may
                // set a range covering the Term, and worth counting, because
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
             * `not iterable` inside `hashInput`, before any request is made,
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
    const offeringsWithInsufficientLecturers: AssemblyReport['offeringsWithInsufficientLecturers'] = [];
    const offeringsWithNoLecturerAssigned: AssemblyReport['offeringsWithNoLecturerAssigned'] = [];
    const offeringsWithLecturerPinOutsidePool: AssemblyReport['offeringsWithLecturerPinOutsidePool'] = [];
    const offeringsWithUnsatisfiableRoomRestriction: AssemblyReport['offeringsWithUnsatisfiableRoomRestriction'] = [];
    const offeringsWithRestrictionBelowRoomCount: AssemblyReport['offeringsWithRestrictionBelowRoomCount'] = [];
    const pinnedRoomsNotSent: AssemblyReport['pinnedRoomsNotSent'] = [];
    const offeringsWithNoSuitablePinnedRoom: AssemblyReport['offeringsWithNoSuitablePinnedRoom'] = [];

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

    /**
     * Wire id -> what the online-share floor needs and the wire Offering does
     * not carry: a human-readable title, and whether every placement of this
     * series is forced online.
     *
     * Populated in the same loop that builds `offerings`, so a series can never
     * exist in one and not the other. See `onlineShareFloor.ts` for what it is
     * for; the check itself runs below, once the constraints are assembled.
     */
    const wireOfferingFacts = new Map<string, { title: string; forcedOnline: boolean }>();

    /**
     * BANKED SESSIONS, GROUPED BY OFFERING (issue #22). A banked Session
     * cannot be SENT: it has no placement, so `wireSessionRows` below excludes
     * it, but it must still `requiredSessionCount` toward, or the solver
     * would see the demand as unmet and invent a brand-new Session to fill
     * exactly the gap banking exists to hold open, doubling the teaching the
     * moment anyone next solves. Subtracting it here is the one place that
     * can happen: nowhere downstream still has both the count and the
     * Offering's frequency in hand.
     */
    const bankedSessionsByOffering = new Map<string, typeof sessionRows>();

    for (const session of sessionRows) {
        if (session.termWeek !== null || session.offeringId === null) {
            continue;
        }

        const bucket = bankedSessionsByOffering.get(session.offeringId) ?? [];

        bucket.push(session);
        bankedSessionsByOffering.set(session.offeringId, bucket);
    }

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

        /**
         * WHICH ROOMS THIS OFFERING MAY USE — the ONE call site (issue #123).
         *
         * A ROOM PIN (`offering_room`) and `onlineMode = REQUIRED` write the
         * SAME wire field, so composing them at two call sites is how they come
         * to disagree. Both rules — REQUIRED plus a pin INTERSECT, and an empty
         * result is an ERROR rather than an empty wire list — live in
         * `resolveRoomRestriction` (`server/utils/offeringRooms.ts`), which
         * `violations.ts` calls for a single manual placement, so a move the UI
         * warns about and a placement the solver refuses can never be different
         * questions.
         *
         * PER OFFERING, NOT PER SERIES, and deliberately outside the
         * `seriesGroups.map` below: the pin and the online mode are properties
         * of the Offering, so a split would resolve the identical restriction
         * once per Group and report it that many times.
         */
        const restriction = resolveRoomRestriction(
            {
                onlineMode: offering.onlineMode,
                pinnedRoomIds: offering.pinnedRooms.map((link) => link.roomId),
            },
            roomFacts,
        );

        /**
         * NO ON-SITE PLACEMENT EXISTS FOR THIS OFFERING.
         *
         * Read off `permittedRoomIds`, the composed answer, rather than off
         * `onlineMode`: an Offering pinned to virtual Rooms alone is forced
         * online just as surely as one marked `REQUIRED`, and asking the field
         * instead of the composition is how the pin and the mode come to
         * disagree — the whole reason `resolveRoomRestriction` exists.
         *
         * A `failure` is excluded deliberately: that Offering ships
         * `NO_ELIGIBLE_ROOM_ID` and comes back unplaced, so it contributes no
         * online session to count, and `offeringsWithUnsatisfiableRoomRestriction`
         * already names it with the fix it actually needs.
         */
        const forcedOnline = restriction.failure === null
            && restriction.permittedRoomIds !== null
            && restriction.permittedRoomIds.length > 0
            && restriction.permittedRoomIds.every((roomId) => virtualRoomIds.has(roomId));

        for (const link of offering.pinnedRooms) {
            if (sentRoomIds.has(link.roomId)) {
                continue;
            }

            pinnedRoomsNotSent.push({
                id: offering.id,
                title: offering.title,
                roomId: link.roomId,
                // Two states, two fixes: reactivate the Room, or work out where
                // it went. See `visiblePinnedRoomIds`.
                reason: visiblePinnedRoomIds.has(link.roomId) ? 'inactive' : 'absent',
            });
        }

        if (restriction.failure) {
            offeringsWithUnsatisfiableRoomRestriction.push({
                id: offering.id,
                title: offering.title,
                reason: restriction.failure.reason,
                pinnedStored: restriction.failure.pinnedStored,
                pinnedInSnapshot: restriction.failure.pinnedInSnapshot,
                virtualInSnapshot: restriction.failure.virtualInSnapshot,
            });
        } else if (
            restriction.permittedRoomIds !== null
            && restriction.allowedRoomIds.length > 0
            && restriction.allowedRoomIds.length < offering.requiredRoomCount
        ) {
            /*
             * Only when a restriction was actually STATED
             * (`allowedRoomIds` non-empty): with no pin and no required-online
             * the honest comparison is against the whole snapshot, which
             * `offeringsNeedingMoreRoomsThanExist` already makes.
             */
            offeringsWithRestrictionBelowRoomCount.push({
                id: offering.id,
                title: offering.title,
                available: restriction.allowedRoomIds.length,
                needs: offering.requiredRoomCount,
            });
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
         * that group alone: the existing single-group path, not the union.
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
             * Matched the same way `wireSessionRows` matches a PLACED Session to
             * its series below: by which of the series' Groups the Session
             * actually carries. Unsplit (`seriesGroupId === null`) takes every
             * banked Session the Offering has, mirroring how an unsplit series
             * takes every placed one.
             */
            const bankedCount = (bankedSessionsByOffering.get(offering.id) ?? [])
                .filter((s) => seriesGroupId === null || s.groups.some((g) => g.groupId === seriesGroupId))
                .length;

            /**
             * THE DOCUMENTED BEHAVIOUR, NOW REAL.
             *
             * `requiredCapacity` stays authoritative when a human set it: an
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
            wireOfferingFacts.set(wireId, { title: offering.title, forcedOnline });

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

            /*
             * WHO MAY LEAD THIS SERIES (issue #131).
             *
             * The Offering-wide pool (`offering_lecturer`), unless THIS series'
             * Group carries a LECTURER PIN (`offering_group.lecturer_person_id`,
             * the "Klassenlehrer"): then the one pinned person, and nobody
             * else. A pin makes the series the wire's own FIXED shape
             * (`candidates.length === requiredLecturerCount`), which is what
             * lets a per-person rule such as `LecturerVeto` precompute its mask
             * for it — a genuine pool cannot be evaluated against one person's
             * calendar before the search has chosen who leads (the run
             * refusal that surfaced this).
             *
             * WHICH GROUP'S PIN: the series' own when split; the single Group
             * when unsplit with exactly one (that series IS the Group); none
             * when the Offering has no Group at all. An unsplit Offering never
             * has two Groups (`splitsIntoSeries` is `>= 2`), so no
             * Group-per-series ambiguity is left unhandled here.
             *
             * A pin OUTSIDE the pool is reported and IGNORED, never honoured:
             * the pin narrows who may lead, it does not appoint. The pool is
             * saved by a separate request, so this state is reachable (remove
             * the pinned person from "Who leads it") and the write already
             * warned about it; the series falls back to the pool exactly as if
             * the pin were null, so nothing narrows silently either way.
             */
            const poolIds = offering.lecturers.map((link) => link.personId);
            const pinGroupId = seriesGroupId ?? (groupIds.length === 1 ? groupIds[0]! : null);
            const pinnedPersonId = pinGroupId === null
                ? null
                : offering.groups.find((link) => link.groupId === pinGroupId)?.lecturerPersonId ?? null;

            let candidateLecturerIds = poolIds;

            if (pinnedPersonId !== null) {
                if (poolIds.includes(pinnedPersonId)) {
                    candidateLecturerIds = [pinnedPersonId];
                } else {
                    offeringsWithLecturerPinOutsidePool.push({
                        id: wireId,
                        title: offering.title,
                        groupId: pinGroupId!,
                        personId: pinnedPersonId,
                    });
                }
            }

            // Against the SERIES' candidates, not the Offering's pool: a pinned
            // series has exactly one, so an explicit co-teaching count of two
            // is a demand this series cannot meet, and is reported as such.
            if (offering.requiredLecturerCount !== null && offering.requiredLecturerCount > candidateLecturerIds.length) {
                offeringsWithInsufficientLecturers.push({
                    id: wireId,
                    title: offering.title,
                    required: offering.requiredLecturerCount,
                    available: candidateLecturerIds.length,
                });
            }

            /*
             * `requiredLecturerCount === null`, not merely falsy: an explicit
             * `0` is the tenant overriding the kind's default for this ONE
             * Offering (a study period inside an otherwise-taught kind, say),
             * and is as deliberate as `SessionKind.requiresLecturer = false`
             * itself. Only the case nobody actually decided is reported.
             */
            if (
                offering.requiredLecturerCount === null
                && candidateLecturerIds.length === 0
                && offering.kind.requiresLecturer
            ) {
                offeringsWithNoLecturerAssigned.push({ id: wireId, title: offering.title });
            }

            const minCapacity = offering.requiredCapacity ?? derived?.capacity ?? 0;

            /*
             * CAN THE SURVIVING RESTRICTION ACTUALLY HOST THIS SERIES?
             *
             * Only asked when a restriction was stated and survived: with no
             * pin and no required-online, "no Room is big enough" is a fact
             * about the institution, not about a narrowing somebody typed, and
             * the run's own hard violations say it just as well.
             *
             * MIRRORS `individually_eligible` in `convert.rs`, both halves:
             * features (presence AND quantity) are required of EACH Room, while
             * capacity is SUMMED across `requiredRoomCount` of them. Getting
             * either the other way round would report a healthy pin as broken,
             * which is worse than not reporting: a false alarm here trains
             * people to ignore the whole report.
             */
            if (restriction.failure === null && restriction.allowedRoomIds.length > 0) {
                const profiles = restriction.allowedRoomIds
                    .map((roomId) => roomProfile.get(roomId))
                    .filter((profile): profile is NonNullable<typeof profile> => profile !== undefined);

                const featureEligible = profiles.filter((profile) => (
                    offering.equipment.every((link) => (
                        profile.features.has(link.equipment.key)
                        && (link.quantity === null || (profile.quantities.get(link.equipment.key) ?? 0) >= link.quantity)
                    ))
                ));

                const bestCapacity = featureEligible
                    .map((profile) => profile.capacity)
                    .sort((a, b) => b - a)
                    .slice(0, offering.requiredRoomCount)
                    .reduce((sum, capacity) => sum + capacity, 0);

                if (featureEligible.length === 0) {
                    offeringsWithNoSuitablePinnedRoom.push({
                        id: wireId,
                        title: offering.title,
                        reason: 'features',
                        available: restriction.allowedRoomIds.length,
                        minCapacity,
                        bestCapacity: 0,
                    });
                } else if (bestCapacity < minCapacity) {
                    offeringsWithNoSuitablePinnedRoom.push({
                        id: wireId,
                        title: offering.title,
                        reason: 'capacity',
                        available: restriction.allowedRoomIds.length,
                        minCapacity,
                        bestCapacity,
                    });
                }
            }

            return {
            id: wireId,
            tenantId: options.tenantId,
            kind: offering.kind.key,
            // Reduced by whatever is already banked (issue #22); see
            // `bankedSessionsByOffering` above for why the solver must not be
            // asked to fill a gap a human is holding open on purpose.
            requiredSessionCount: Math.max(0, offering.frequency - bankedCount),
            durationBlocks: offering.durationBlocks,
            // The SERIES' candidates: the pool, or the one pinned person; see
            // the derivation above.
            candidateLecturerIds,
            // NULL (every Offering nobody has touched) derives to one lecturer,
            // chosen by the solver from the candidates; see the column's schema
            // comment. Clamped to the candidate count either way: an explicit
            // count above it is reported in `offeringsWithInsufficientLecturers`
            // above rather than sent as a demand nothing can satisfy. For a
            // pinned series that clamp is what makes `1 === 1`, the fixed shape.
            requiredLecturerCount: Math.min(
                offering.requiredLecturerCount ?? Math.min(1, candidateLecturerIds.length),
                candidateLecturerIds.length,
            ),
            // The SERIES' own group, not the Offering's whole set. This is
            // what makes each series independent, and it is what comes back in
            // `PlacedSession.group_ids`, so materialization gets the one right
            // group for `session_group` with no extra bookkeeping.
            groupIds: capacityGroupIds,
            // The app models no direct per-Offering participants beyond groups.
            participantPersonIds: [],
            requiredRoomFeatures: offering.equipment.map((link) => link.equipment.key),
            // 0 only when genuinely underivable, and that case is reported
            // above rather than passing as "no requirement".
            minCapacity,
            /*
             * THE ALLOW-LIST, at last (issue #123). This was `[]` with the
             * comment "the app has no allow-list" for as long as the capability
             * was live in the solver and unreachable from here.
             *
             * EMPTY STILL MEANS "ANY ELIGIBLE ROOM", which is why neither value
             * here is computed inline: an Offering that STATED a restriction and
             * whose restriction resolves to nothing must never send `[]`, or
             * "must be online" ships as "anywhere at all". `resolveRoomRestriction`
             * owns that distinction; both fields come from the same call so the
             * pair cannot disagree.
             */
            allowedRoomIds: restriction.allowedRoomIds,
            allowOnline: restriction.allowOnline,
            /*
             * The DEMAND side of equipment counts, and only the links that state
             * one. A link with a NULL quantity is already fully expressed by
             * `requiredRoomFeatures` above: the proto says an absent
             * `min_quantity` asks exactly the presence question, so sending it
             * here as well would be the same requirement twice, and a reader
             * comparing the two lists would have no way to tell which entries
             * carry information.
             */
            roomFeatureRequirements: offering.equipment
                .filter((link) => link.quantity !== null)
                .map((link) => ({ feature: link.equipment.key, minQuantity: link.quantity! })),
            /*
             * Sent as stored, and 1 is the overwhelming majority. The proto
             * treats 0 and 1 identically, so this was pinned at 0 for as long
             * as the app had no column; the capability was live in the solver
             * and unreachable from here.
             *
             * NOT clamped on the way out. `MAX_ROOMS_PER_SESSION` is enforced
             * at the write and again by a database CHECK, so a value that
             * cannot be solved never reaches this line; clamping here would
             * turn the one input the solver deliberately REFUSES into a silent
             * substitution of a different Offering than the tenant described.
             */
            requiredRoomCount: offering.requiredRoomCount,
            /*
             * NULL IS UNSPECIFIED, and that is a claim rather than a gap: the
             * Offering has not been classified. Mapping it to DISTRIBUTED (what
             * most timetables assume) would send an institution's assumption as
             * though somebody had chosen it, and the solver would then be free
             * to act on it the moment a pattern rule is enabled.
             */
            schedulingPattern: offering.schedulingPattern === 'DISTRIBUTED'
                ? SchedulingPattern.SCHEDULING_PATTERN_DISTRIBUTED
                : offering.schedulingPattern === 'BLOCK'
                    ? SchedulingPattern.SCHEDULING_PATTERN_BLOCK
                    : SchedulingPattern.SCHEDULING_PATTERN_UNSPECIFIED,
            /*
             * The app has no such column; false is the proto's "no preference"
             * default, read only by `MinimizeOfferingDistinctDays` (a
             * constraint type not yet in this repo's catalogue). A real
             * per-Offering knob is part of landing that type.
             */
            preferFullerDays: false,
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
     * A LEGACY COMBINED Session (carrying none or several of the Offering's
     * Groups) belongs to no series and is OMITTED entirely: the apply will delete
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
        // BANKED, NOT SENT (issue #22). A banked Session has no placement to
        // put on the wire: `requiredSessionCount` above already accounted
        // for it, so omitting it here is not a loss, it is the other half of
        // the same accounting.
        if (session.termWeek === null) {
            return false;
        }

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
    }).filter(isPlacedSession);

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

            // Exactly one by construction; the filter above kept only those.
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

    const kindRows = await tx.sessionKind.findMany({ where: { tenantId: options.tenantId } });
    const kindKeyById = new Map(kindRows.map((kind) => [kind.id, kind.key]));

    /**
     * Kind KEYS grouped by their fixed classification, for the rules that derive
     * their scope from it rather than from `ConstraintScope`.
     *
     * Keys, not ids, because that is what crosses the wire: the solver has
     * never seen a database id for a kind, and building this as ids would put
     * one translation step between the declaration and the rule.
     */
    const kindKeysByType = new Map<SessionKindType, string[]>();

    for (const kind of kindRows) {
        const bucket = kindKeysByType.get(kind.type) ?? [];

        bucket.push(kind.key);
        kindKeysByType.set(kind.type, bucket);
    }

    const skippedConstraints: AssemblyReport['skippedConstraints'] = [];
    const severityMismatches: AssemblyReport['severityMismatches'] = [];
    const relationsWithDanglingMembers: AssemblyReport['relationsWithDanglingMembers'] = [];
    const constraints: ConstraintConfig[] = [];
    const offeringRelations: OfferingRelation[] = [];
    const realOfferingIds = new Set(offeringRows.map((o) => o.id));

    for (const row of constraintRows) {
        const type = findConstraintType(row.type);

        /*
         * RELATION TYPES NEVER REACH `toWireConstraint`. Their type carries no
         * `wireField` because there is no `ConstraintConfig` field for them to
         * populate: the whole point of a relation is that its operands are an
         * ordered set of Offerings, sent instead as `SolverInput.offeringRelations`
         * (assembled below, from the same row). Falling through to
         * `toWireConstraint` would report every one of these as "wire has no
         * field for this type yet", which is the message for a catalogue entry
         * shipped ahead of the proto, the wrong diagnosis for a type that is
         * sent, just on a different message.
         */
        if (type?.relation) {
            const dangling = row.relationMembers
                .map((m) => m.offeringId)
                .filter((id) => !realOfferingIds.has(id));

            /*
             * A DANGLING MEMBER IS OMITTED WHOLE, not filtered down to its
             * remaining members. ADR-0028: "a relation with one side missing
             * is a rule that cannot be evaluated, and running it half-applied
             * would satisfy it by construction": a 3-member DifferentTime
             * missing one Offering is not a valid 2-member DifferentTime, it
             * is a different, unconfigured rule.
             */
            if (dangling.length > 0) {
                relationsWithDanglingMembers.push({ id: row.id, type: row.type, danglingOfferingIds: dangling });

                continue;
            }

            const variant = wireRelationVariant(
                row.type,
                (row.params && typeof row.params === 'object' ? row.params : {}) as Record<string, unknown>,
            );

            if (!variant) {
                skippedConstraints.push({
                    id: row.id, type: row.type,
                    reason: 'The wire has no relation-kind field for this type yet.',
                });

                continue;
            }

            offeringRelations.push({
                id: row.id,
                enabled: row.isEnabled,
                // Meaningful for SOFT relation types only; `different_time` is
                // always HARD, so this is never read.
                weight: row.weight ?? 0,
                offeringIds: row.relationMembers.map((m) => m.offeringId),
                ...variant,
            });

            continue;
        }

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

        const mapped = toWireConstraint(row, kindKeyById, kindKeysByType, term.timeGridId);

        if ('skip' in mapped) {
            skippedConstraints.push({ id: row.id, type: row.type, reason: mapped.skip });

            continue;
        }

        constraints.push(mapped.config);
    }

    /**
     * THE ONLINE-SHARE FLOOR, read off what was actually SENT.
     *
     * `constraints` and `offerings`, not `constraintRows` and `offeringRows`:
     * the answer has to be about the input the solver will evaluate, so a rule
     * skipped above (scoped to another grid, missing a parameter) must not be
     * checked here, and a split Offering must be counted per series exactly as
     * the solver counts it. Deriving either from the source rows would produce
     * a warning about a run that was never made.
     *
     * `groups` carries the wire's `''`-for-no-parent convention, and the
     * downward expansion happens inside: the solver derives the closure from
     * `parent_id` too, so both sides answer from the same tree.
     */
    const shareCapRules: ShareCapRule[] = constraints
        .filter((config) => config.maxOnlineShare !== undefined)
        .map((config) => ({
            constraintId: config.id,
            maxRatio: config.maxOnlineShare!.maxRatio,
            perWeek: config.maxOnlineShare!.window === ShareWindow.SHARE_WINDOW_PER_WEEK,
            appliesToKinds: config.appliesToKinds,
        }));

    const shareCapOfferings: ShareCapOffering[] = offerings.map((offering) => {
        // Present for every wire id by construction: written in the loop that
        // built `offerings`. The fallback keeps a series countable rather than
        // dropping it, which would under-state the denominator — the direction
        // that invents a breach.
        const facts = wireOfferingFacts.get(offering.id);

        return {
            id: offering.id,
            title: facts?.title ?? offering.id,
            kind: offering.kind,
            groupIds: offering.groupIds,
            requiredSessionCount: offering.requiredSessionCount,
            forcedOnline: facts?.forcedOnline ?? false,
        };
    });

    const groupsWithForcedOnlineAboveShareCap = forcedOnlineAboveShareCap(
        shareCapRules,
        shareCapOfferings,
        groups,
    );

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
     * Sessions belong to sibling tenants and are invisible under normal RLS,
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
        // Occupancy outside this term's span tells the solver nothing: it can
        // only place within the weeks the calendar declares.
        .filter(({ week }) => week >= 0 && week < (calendar.weeks?.length ?? 0))
        .map(({ row, date, week }) => ({
            roomId: row.room_id,
            // Already 0-based: `week` counts from the term's first Monday, which
            // is exactly what SlotRef.week means on the wire.
            startSlot: { week, day: isoWeekday(date), block: row.block_index },
            durationBlocks: row.duration_blocks,
            // Documented as "opaque; diagnostics only": deliberately carries no
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
     * The counted set is `candidateLecturerIds` (§4.1, lecturers only). Today
     * the pool equals the requirement, so it IS the set that will lead the
     * session; if genuine pool selection ever lands this becomes a decision
     * variable and this count becomes an upper bound rather than the answer.
     */
    /**
     * THE DEMAND LEDGER: one entry per wire Offering, built from the two lists
     * that are about to be sent rather than from the rows they came from.
     *
     * Reading `offerings` and `sessionInputs` here (not `offeringRows` and
     * `sessionRows`) is the point: the ledger has to say what CROSSED THE WIRE,
     * including the banked subtraction, the per-group split, and every Session
     * the filters above omitted. Derived from the source rows it would record a
     * request the solver never received, and the apply would then reconcile
     * against a fiction.
     */
    const existingSentByWireOffering = new Map<string, number>();

    for (const session of sessionInputs) {
        if (!session.offeringId) {
            continue;
        }

        existingSentByWireOffering.set(
            session.offeringId,
            (existingSentByWireOffering.get(session.offeringId) ?? 0) + 1,
        );
    }

    const demand: DemandEntry[] = offerings.map((offering) => ({
        wireOfferingId: offering.id,
        // Present for every wire id by construction: `realOfferingIdOf` is
        // written in the same loop that builds `offerings`. Falling back to the
        // wire id keeps an unsplit id correct rather than dropping the entry,
        // which would under-report demand: the one direction that silently
        // authorises a delete.
        offeringId: realOfferingIdOf.get(offering.id) ?? offering.id,
        requiredSessionCount: offering.requiredSessionCount,
        existingSessionsSent: existingSentByWireOffering.get(offering.id) ?? 0,
    }));

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
        // Built above, alongside `constraints`, from the same `constraintRows`,
        // every enabled `different_time` row with no dangling member.
        offeringRelations,
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
         * DB ids, so recording wire ids there would mean no existing Session
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
            offeringsNeedingMoreRoomsThanExist: offeringRows
                .filter((o) => o.requiredRoomCount > roomRows.length)
                .map((o) => ({
                    id: o.id,
                    title: o.title,
                    needs: o.requiredRoomCount,
                    // The Rooms actually SENT, not the tenant's whole estate:
                    // the report has to answer the question the solver was
                    // asked, which federation sharing can widen.
                    available: roomRows.length,
                })),
            offeringsByPattern: {
                distributed: offeringRows.filter((o) => o.schedulingPattern === 'DISTRIBUTED').length,
                block: offeringRows.filter((o) => o.schedulingPattern === 'BLOCK').length,
                // NULL, counted explicitly rather than derived by subtraction:
                // it is the number that makes an enabled pattern rule inert, so
                // it should be readable without arithmetic.
                unclassified: offeringRows.filter((o) => o.schedulingPattern === null).length,
            },
            offeringsWithNoDerivableCapacity,
            offeringsWithPartialEnrolment,
            offeringsWithInsufficientLecturers,
            offeringsWithNoLecturerAssigned,
            offeringsWithLecturerPinOutsidePool,
            offeringsWithUnsatisfiableRoomRestriction,
            offeringsWithRestrictionBelowRoomCount,
            groupsWithForcedOnlineAboveShareCap,
            pinnedRoomsNotSent,
            offeringsWithNoSuitablePinnedRoom,
            personsWithHeavyVetoLoad,
            offeringsSplitByGroup,
            legacyCombinedSessionsOmitted,
            skippedConstraints,
            severityMismatches,
            relationsWithDanglingMembers,
            groupsOmitted: groupRows.length - sentGroupRows.length,
            groupAvailability: {
                windowsSent: groupsWithAvailabilityWindow,
                windowsCoveringWholeTerm: groupWindowsCoveringWholeTerm,
            },
            preferences: {
                lecturersWithPreference: personRows.filter((person) => (
                    narrowedPreferences.has(person.id)
                    && person.personRoles.some((link) => link.role.key === LECTURER_ROLE_KEY)
                )).length,
                droppedOutOfGridValues,
                placementsWithNoSignal,
                placementsCounted,
            },
            demand,
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
 * The wire bytes of a `SolverInput`: what `hashInput` digests and what
 * `SolverInputSnapshot.compressedInput` gzips (issue #24). One encode, not
 * one per caller, so a snapshot and its own run's `inputHash` can never
 * describe two different encodings of what was, in memory, the same object.
 */
export function encodeInput(input: SolverInput): Buffer {
    return Buffer.from(SolverInput.encode(input).finish());
}

/**
 * Hash of the ENCODED protobuf, not of a JSON rendering.
 *
 * Two inputs that encode identically are the same problem to the solver, which
 * is exactly the question this answers. A JSON hash would also change with key
 * order and with how BigInt happened to stringify.
 */
export function hashInput(input: SolverInput): string {
    return createHash('sha256').update(encodeInput(input)).digest('hex');
}
