import type { SessionKindType } from './sessionKindType';

/**
 * The constraint-type library (TAXONOMY.md §7).
 *
 * In `shared/` because two consumers must not drift: `server/utils/violations.ts`
 * decides which types it can evaluate, and the rule builder decides which a
 * tenant may configure. A type in the UI that the evaluator does not know is a
 * rule that exists, is enabled, shows no violations, and means nothing.
 *
 * NOT A DSL: constraints are predefined types plus parameters. Adding one is a
 * code change, because a type with no evaluator is a promise nothing keeps.
 */

/** Structural types the app itself decides, from placement data alone. */
export const STRUCTURAL_CONSTRAINT_TYPES = [
    'no_double_booking_room',
    'no_double_booking_lecturer',
    'no_double_booking_group',
    'no_double_booking_person',
] as const;

export type StructuralConstraintType = (typeof STRUCTURAL_CONSTRAINT_TYPES)[number];

/**
 * App-decided, but PER SESSION rather than pairwise: a fact about one
 * placement and the TimeGrid it sits in, needing no counterpart Session to
 * compare against.
 *
 * A SEPARATE LIST FROM `STRUCTURAL_CONSTRAINT_TYPES`, not a fifth member of it,
 * because that list drives `describeCollision`'s dispatch, whose switch is
 * exhaustive over pairs (`(a, b)`) and has nowhere to put a check that only
 * ever looks at one Session. Folding this in would mean either a dead case
 * that never fires from the pairwise loop, or bending the pairwise loop to
 * also iterate seeds alone; `server/utils/violations.ts` runs this list as its
 * own pass instead.
 */
export const PER_SESSION_CONSTRAINT_TYPES = [
    'no_session_spanning_break',
    'no_unplaced_session',
    'no_session_outside_allowed_room',
] as const;

export type PerSessionConstraintType = (typeof PER_SESSION_CONSTRAINT_TYPES)[number];

/**
 * App-decided, pairwise, but keyed by explicit RELATION MEMBERSHIP
 * (`ConstraintRelationMember`) rather than a shared Room/Lecturer/Group/Person
 * already loaded into `describeCollision`'s `ctx`.
 *
 * A SEPARATE LIST FROM `STRUCTURAL_CONSTRAINT_TYPES`, for the same reason
 * `PER_SESSION_CONSTRAINT_TYPES` is: `describeCollision`'s switch is
 * exhaustive over pairs sharing that one precomputed context, and a relation's
 * data (which Offerings relate) isn't in it and can't be added to it without
 * changing what every other branch receives. `server/utils/violations.ts` runs
 * this list as its own third pass instead.
 */
export const RELATION_CONSTRAINT_TYPES = [
    'different_time',
] as const;

export type RelationConstraintType = (typeof RELATION_CONSTRAINT_TYPES)[number];

/**
 * Relation kinds the SOLVER evaluates and this app does not (issues #37, #54).
 *
 * Same storage and same wire carve-out as `RELATION_CONSTRAINT_TYPES`
 * (`ConstraintRelationMember`, `OfferingRelation`), but NOT in that list on
 * purpose: `violations.ts` evaluates every type in it as `different_time`
 * (pairwise overlap), which is the opposite of what `same_time` means. Until
 * an app-side evaluator exists for a kind, a manual edit that breaks it warns
 * about nothing, exactly as every solver-owned type behaves today.
 */
export const SOLVER_RELATION_CONSTRAINT_TYPES = [
    'same_time',
    'same_days',
    'same_start',
    'precedence',
] as const;

export type SolverRelationConstraintType = (typeof SOLVER_RELATION_CONSTRAINT_TYPES)[number];

/**
 * Types owned by the solver service (TAXONOMY.md §7), evaluated at generation
 * time rather than by this app on every manual edit.
 *
 * Listed so the boundary is explicit and a missing app-side check is visibly
 * deferred rather than forgotten. The comment here used to say the solver "does
 * not exist yet", which stopped being true a long time before it was corrected.
 */
export const SOLVER_OWNED_CONSTRAINT_TYPES = [
    'exact_frequency_per_offering',
    'lecturer_veto',
    'online_onsite_same_day_exclusion',
    'max_online_ratio_per_group',
    'minimize_first_block',
    'minimize_last_block',
    'minimize_block_usage',
    'minimize_specifc_day',
    'minimize_high_ranking_rooms',
    'minimize_exam_week_sessions',
    'minimize_online_sessions',
    'person_preference_fit',
    'block_pattern_adherence',
    'distributed_pattern_adherence',
    'protected_block',
    'exam_spacing_window',
    'exam_spacing_same_day',
    'minimize_location_change',
    'max_daily_span',
    'max_consecutive_blocks',
    'max_weekly_teaching_load',
    'minimize_capacity_waste',
    'minimize_room_churn',
    'room_turnaround_buffer',
    'max_concurrent_online_sessions',
    'minimize_weekday_imbalance',
    'room_consistency',
    'group_size_fits_room',
    'group_veto',
    'compactness',
    'lecturer_consistency',
    'minimize_offering_day_split',
    'max_offering_sessions_per_day',
    'max_consecutive_offering_blocks',
    'max_daily_session_count',
    'max_days',
    'max_consecutive_days',
    'daybreak',
    'minimize_specialized_room_use',
    'minimize_break_spanning',
    'travel_time_between_rooms',
] as const;

export type SolverOwnedConstraintType = (typeof SOLVER_OWNED_CONSTRAINT_TYPES)[number];

/** Who decides whether a constraint is breached. */
export type ConstraintEvaluator =
    /** This application, synchronously, on every manual edit. */
    | 'app'
    /**
     * The Rust solver service, at generation time, as opposed to `'app'`, which
     * evaluates synchronously on every manual edit.
     *
     * This said "Not implemented, configurable but inert", which had been stale
     * for a long time and became flatly wrong on 2026-08-27, when
     * `person_preference_fit` (the last unevaluated type) gained its evaluator in
     * `calendry-solver` 41f6227. Every catalogue type now crosses the wire and is
     * priced or enforced. What `'solver'` does still mean is that a breach is
     * invisible until a run produces it: nothing here is checked while somebody
     * drags a session around.
     */
    | 'solver';

export type ConstraintParamType =
    | 'number'
    /** Stored 0–100 for humans; converted to the wire's 0.0–1.0 at the boundary. */
    | 'percent'
    | 'boolean'
    | 'text'
    /** ISO-weekday multi-select, 1 = Monday … 7 = Sunday. */
    | 'weekdays'
    /** Fixed choice; `options` is required. */
    | 'select';

export interface ConstraintParamDef {
    key: string;
    label: string;
    type: ConstraintParamType;
    help?: string;
    min?: number;
    max?: number;
    required?: boolean;
    default?: number | string | boolean;
    /** For `select`. The value is what reaches the wire. */
    options?: { value: string; label: string }[];
}

/**
 * The field each type populates on the wire's `ConstraintConfig`.
 *
 * Declared as data rather than a switch in the mapper so the catalogue is the
 * single place a type's identity lives, and so a test can assert the mapping is
 * total and injective without re-reading the mapper's control flow.
 *
 * A string union rather than `keyof ConstraintConfig`: this file is imported by
 * the CLIENT too, and pulling the generated proto types into the browser bundle
 * to name a field would be a poor trade.
 */
export type WireConstraintField =
    | 'roomDoubleBooking'
    | 'lecturerDoubleBooking'
    | 'groupDoubleBooking'
    | 'personDoubleBooking'
    | 'exactFrequency'
    | 'lecturerVeto'
    | 'onlineOnsiteSameDay'
    | 'maxOnlineShare'
    | 'minimizeFirstBlock'
    | 'minimizeLastBlock'
    | 'minimizeDayUsage'
    | 'minimizeRoomRank'
    | 'minimizeExamWeek'
    | 'minimizeOnline'
    | 'minimizeBlockUsage'
    | 'personPreferenceFit'
    | 'blockPatternAdherence'
    | 'distributedPatternAdherence'
    | 'protectedBlock'
    | 'examSpacingWindow'
    | 'examSpacingSameDay'
    | 'minimizeLocationChange'
    | 'maxDailySpan'
    | 'maxConsecutiveBlocks'
    | 'maxWeeklyTeachingLoad'
    | 'minimizeCapacityWaste'
    | 'minimizeRoomChurn'
    | 'roomTurnaroundBuffer'
    | 'maxConcurrentOnlineSessions'
    | 'minimizeWeekdayImbalance'
    | 'roomConsistency'
    | 'groupSizeFitsRoom'
    | 'groupVeto'
    | 'compactness'
    | 'lecturerConsistency'
    | 'minimizeOfferingDaySplit'
    | 'maxOfferingSessionsPerDay'
    | 'maxConsecutiveOfferingBlocks'
    | 'maxDailySessionCount'
    | 'maxDays'
    | 'maxConsecutiveDays'
    | 'daybreak'
    | 'minimizeSpecializedRoomUse'
    | 'minimizeBreakSpanning'
    | 'travelTimeBetweenRooms';

/**
 * What a rule is ABOUT, for grouping the manage UI into filterable, collapsible
 * shelves, independent of `severity`, which is what a breach MEANS.
 */
export type ConstraintCategory =
    | 'structure'
    | 'availability'
    | 'days'
    | 'rooms'
    | 'online'
    | 'exams'
    | 'workload';

/** Display metadata for each category, keyed for `CONSTRAINT_CATEGORY_ORDER` to walk. */
export const CONSTRAINT_CATEGORIES: Record<ConstraintCategory, { label: string; blurb: string }> = {
    structure: {
        label: 'Placement & structure',
        blurb: 'What makes a timetable valid at all: no overlaps, nothing left unplaced.',
    },
    availability: {
        label: 'Availability & preferences',
        blurb: 'Honouring what a person, group or slot is configured to allow or want.',
    },
    days: {
        label: 'Days & patterns',
        blurb: 'How sessions distribute across a day or week: spread, compactness, repeating patterns.',
    },
    rooms: {
        label: 'Rooms',
        blurb: 'Which room a session lands in, and how consistently.',
    },
    online: {
        label: 'Online & on-site mix',
        blurb: 'Balancing or separating online and in-person sessions.',
    },
    exams: {
        label: 'Exams',
        blurb: 'Spacing and placement rules specific to exam periods.',
    },
    workload: {
        label: 'Teaching load',
        blurb: 'How much, and how consistently, a lecturer teaches.',
    },
};

/** Fixed display order, not alphabetical: structure-first-to-niche. */
export const CONSTRAINT_CATEGORY_ORDER: ConstraintCategory[] = [
    'structure', 'availability', 'days', 'rooms', 'online', 'exams', 'workload',
];

export interface ConstraintTypeDef {
    key: string;
    /**
     * Which `ConstraintConfig` field this becomes on the wire.
     *
     * OPTIONAL for one situation: a catalogue entry landing before the proto field
     * that carries it. Naming a field that does not exist would not fail:
     * `toWireConstraint` casts and ts-proto writes only fields it knows, so the
     * constraint would be dropped from the request with nothing reporting it.
     * A type with no `wireField` is SKIPPED and named in the assembly report.
     *
     * NO TYPE USES THIS TODAY: `person_preference_fit` was the last one, and it
     * gained its field when the solver gained its evaluator. The optionality
     * stays because the situation recurs every time a catalogue entry ships
     * ahead of the schema, and skipping is the only safe answer; the test suite
     * asserts the catalogue is currently complete, so a new type arriving
     * without a field is a visible fact rather than a silently dropped rule.
     */
    wireField?: WireConstraintField;
    label: string;
    /** One sentence, in the tenant's language rather than the schema's. */
    description: string;
    evaluator: ConstraintEvaluator;
    /**
     * HARD when a breach is a defect, SOFT when it is a preference with a weight;
     * `null` means the tenant chooses. Fixed for most types because the severity IS
     * the meaning. The database CHECK enforces the HARD⇄no-weight pairing
     * regardless of what the UI offers.
     *
     * A SOFT weight is RELATIVE and unbounded above: see the note on
     * `RESOURCES.constraints.weight`.
     */
    severity: 'HARD' | 'SOFT' | null;
    /**
     * Which shelf this type sits on in the manage UI, orthogonal to `severity`.
     * Severity says whether a breach is a defect or a preference; category says
     * what the rule is ABOUT (rooms, days, exams, …), so the grid can offer both
     * axes as independent filters instead of one flat list of thirteen-plus
     * switches.
     */
    category: ConstraintCategory;
    /**
     * Derive `applies_to_kinds` from the tenant's Session kinds CLASSIFIED this
     * way, instead of from the rule's own `ConstraintScope` rows.
     *
     * For a rule that is only meaningful about one class of session. "No two
     * exams for a group in a day" is not a rule a tenant should be able to aim
     * at lectures by accident, and under manual scoping the accident had a
     * particularly bad shape: `applies_to_kinds` EMPTY MEANS EVERY KIND on the
     * wire, so forgetting to scope such a rule did not disable it; it widened
     * it to every session in the institution, live, on the next solve.
     *
     * A DECLARATION, NOT A DEFAULT. `toWireConstraint` ignores `ConstraintScope`
     * entirely for these types, the write boundary refuses to store one, and the
     * builder shows no kind picker. Two sources for one answer is what let two
     * exam rules disagree about which kind was the exam kind.
     *
     * AN EMPTY DERIVED SET IS A SKIP, NEVER AN EMPTY LIST: see
     * `toWireConstraint`. That is the entire safety property: the wire cannot
     * express "no kinds", so a tenant with nothing classified must have the rule
     * withheld and reported, not sent meaning its exact opposite.
     */
    appliesToKindType?: SessionKindType;
    /**
     * This rule is stated in units the TimeGrid defines, so a tenant running
     * more than one grid almost certainly does not mean it tenant-wide.
     *
     * A HINT, NOT A RULE. `constraint_def.time_grid_id` is available on every
     * type and NULL means every grid, which is right for most of them: "no
     * double-booking" means the same thing on any grid. This marks the ones
     * where a gap, a block count or a span is being compared against numbers
     * only one grid produces: a 45-minute grid's "three consecutive blocks" is
     * 135 minutes and a 60-minute grid's is 180.
     *
     * The builder surfaces the grid selector for these when the tenant has more
     * than one grid, and says nothing when it has one; a filter exists when it
     * has more than one option, never because a flag is set.
     */
    gridRelative?: boolean;
    /**
     * Weight a tenant's DEFAULT row is seeded with. Required for every SOFT
     * type and meaningless for HARD ones, because `constraint_weight_matches_severity`
     * demands SOFT rows carry a weight even while disabled, so "seed it
     * disabled with no weight" is not a representable state.
     *
     * These are a coherent RELATIVE scale, not calibrated magnitudes: only
     * ratios between enabled soft rules mean anything to the solver. A tenant
     * is expected to retune them; the point is that toggling a rule on does not
     * present an empty required input.
     */
    defaultWeight?: number;
    /**
     * Overrides `defaultConstraintRow`'s isEnabled heuristic (structural +
     * per-session types only) for THIS type specifically.
     *
     * ABSENT, NOT `false`, is the safe default for a type not listed here: a
     * brand-new catalogue entry (or one nobody has opted in yet) falls back
     * to the heuristic and is seeded disabled, so `backfill:constraints
     * --all-missing` can never silently switch on a new solver-steering rule
     * for every existing tenant. Setting `true` is a deliberate, per-type
     * decision, not a blanket toggle.
     */
    defaultEnabled?: boolean;
    params: ConstraintParamDef[];
    /**
     * A parameter COMBINATION this type cannot function without, beyond what
     * each individual param's `required` expresses.
     *
     * EXISTS FOR "AT LEAST ONE OF" SHAPES. `missingConstraintParams` can only
     * ask "is this one param set", so a type where no single param is
     * required but SOME combination of them must be has no way to say so:
     * `minimize_block_usage`'s `blocks`/`first`/`last` are each optional, and
     * all three empty is not a smaller version of the rule, it is a rule with
     * nothing to steer away from. `toWireConstraint` sent it anyway and the
     * solver rejected the whole run with `INVALID_ARGUMENT`, 68ms after the
     * row was created: an instant failure indistinguishable from a broken
     * button, because nothing before the solver call could see it coming.
     *
     * ONE FUNCTION, TWO CALLERS: `toWireConstraint` (skip this constraint,
     * report why, keep going) and `validateConstraint` (block the RUN before
     * it starts, name the constraint and the fix). Sharing it means the two
     * cannot disagree about what "unsendable" means for a given type.
     *
     * Returns `undefined` when the configured params are fine.
     */
    unsendableWhen?: (params: Record<string, unknown>) => {
        code: string;
        message: string;
        fixHint: string;
    } | undefined;
    /**
     * Set for a RELATION type (ADR-0028 in calendry-solver): this type's
     * operands are an ordered, tenant-chosen set of Offerings. `params` is
     * always `[]` for these, and the set itself (`ConstraintRelationMember`)
     * is what a form has to collect instead.
     *
     * `minMembers` is the smallest set the type means anything for: 2 for
     * every relation shipped so far, since a relation about one Offering
     * alone is not a relation. NO DEFAULT ROW: `defaultConstraintTypes()`
     * excludes every type carrying this, because there is no membership a
     * seed could choose on a tenant's behalf: "the first constraint whose
     * operands are chosen by the tenant in the constraint itself" (ADR-0028).
     */
    relation?: { minMembers: number };
    /**
     * Set when a newer type supersedes this one.
     *
     * The entry STAYS in the catalogue. Removing it would make every existing
     * row of that type unrenderable, and `type` is `createOnly`, so a tenant
     * could not edit their way to the replacement either, so they would be left
     * with a rule the UI cannot show and cannot fix. The builder hides these
     * from the "add a rule" picker while continuing to render the ones already
     * configured.
     */
    deprecatedBy?: string;
}

/**
 * Weekday numbers a `weekdays` param holds, sorted and cleaned.
 *
 * Lives here, not in `server/utils/solverInput.ts`, because `unsendableWhen`
 * below needs it and this file is loaded client-side too (see the file
 * header); `solverInput.ts` imports `node:crypto` and cannot be.
 */
export function parseWeekdayList(value: unknown): number[] {
    return Array.isArray(value)
        ? [...new Set(value.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 7))]
            .sort((a, b) => a - b)
        : [];
}

/**
 * A comma-separated list of 1-BASED block positions, as the wire's 0-based
 * indices: the same conversion `minimize_block_usage` does, and for the same
 * reason: a human counts blocks from one and the grid counts from zero.
 *
 * Unparseable and out-of-range entries are dropped rather than rejected. The
 * field is free text and a stale position is already inert solver-side, so
 * failing a whole run over one stray character is the harsher answer to the
 * same input.
 */
export function parseBlockPositions(value: unknown): number[] {
    return [...new Set(
        String(value ?? '')
            .split(',')
            .map((part) => Number(part.trim()))
            .filter((n) => Number.isInteger(n) && n >= 1)
            .map((n) => n - 1),
    )].sort((a, b) => a - b);
}

export const CONSTRAINT_TYPES: ConstraintTypeDef[] = [
    // ---- Structural, evaluated here -----------------------------------------
    {
        key: 'no_double_booking_room',
        category: 'structure',
        wireField: 'roomDoubleBooking',
        label: 'No double-booked rooms',
        description: 'A room cannot host two sessions that overlap in the same week.',
        evaluator: 'app',
        severity: 'HARD',
        params: [],
    },
    {
        key: 'no_double_booking_lecturer',
        category: 'structure',
        wireField: 'lecturerDoubleBooking',
        label: 'No double-booked people',
        description: 'Nobody can be assigned to two sessions that overlap.',
        evaluator: 'app',
        severity: 'HARD',
        params: [],
    },
    {
        key: 'no_double_booking_group',
        category: 'structure',
        wireField: 'groupDoubleBooking',
        label: 'No double-booked groups',
        description:
            'A group cannot have two overlapping sessions. Propagates through nesting: '
            + 'a cohort lecture blocks its seminars, and a seminar blocks its cohort.',
        evaluator: 'app',
        severity: 'HARD',
        params: [],
    },

    {
        key: 'no_double_booking_person',
        category: 'structure',
        wireField: 'personDoubleBooking',
        label: 'No double-booked attendees',
        description:
            'Nobody attends two overlapping sessions. Catches what the group rule '
            + 'structurally cannot: a person in two groups unrelated in the nesting '
            + 'tree, both scheduled at once.',
        evaluator: 'app',
        severity: 'HARD',
        params: [],
    },

    // ---- Structural, evaluated here, PER SESSION (no counterpart) ----------
    {
        key: 'no_session_spanning_break',
        category: 'structure',
        label: 'Report sessions spanning a break',
        description:
            'A session that starts before a named break and ends after it is drawn '
            + 'honestly on the grid and is entirely LEGAL: this only makes the fact '
            + 'queryable, so it can be listed, counted and reviewed rather than living '
            + 'only in the chip somebody happens to be looking at.',
        evaluator: 'app',
        severity: 'SOFT',
        /*
         * UNCALIBRATED, like `REPAIR_MOVEMENT_WEIGHT`: chosen to be visible in
         * a SOFT summary next to this tenant's other soft rules, not measured
         * against them. Meaningful even with no solver objective behind this
         * type: `refreshViolations` sets `penalty: weight` for every SOFT
         * violation regardless of which evaluator found it, and the review
         * screen sums penalties per type, the same mechanism a solver-priced
         * SOFT rule uses.
         *
         * NO WIRE FIELD, and that is not a gap to close casually: this is the
         * REPORTING half only (issue #27). The solver AVOIDING this shape is a
         * different, unbuilt card (issue #26) that needs the grid's break
         * structure on the wire at all, which today it deliberately is not
         * (CLAUDE.md, "TimeGrid breaks"). Enabling this type has no effect on
         * what the solver places; only on what a manual edit is reported as.
         */
        defaultWeight: 5,
        params: [],
    },
    {
        key: 'no_unplaced_session',
        category: 'structure',
        label: 'Every session must be placed',
        description:
            'A Session an Offering still owes must sit somewhere on the grid. Flags one '
            + 'cancelled to the spare bank that has not been re-placed or '
            + 'removed: a hole in the timetable, not a preference.',
        evaluator: 'app',
        /*
         * HARD, unlike its per-session sibling above: an unplaced Session is
         * teaching that is not happening, not a preference about where it
         * happens. Still enabled by default like every structural/per-session
         * type (`defaultConstraintRow`); it can never make a term infeasible,
         * since it reports a state that already exists rather than creating one.
         *
         * PRODUCED ONLY BY `bank.post.ts`, the sole route that sets a Session's
         * placement fields to NULL: it writes this violation directly rather
         * than through `refreshViolations()`: see that route's file comment
         * for why `refreshViolations()` never runs against a banked Session.
         * `refreshViolations()`'s per-session pass still knows this type, so
         * `move.post.ts` re-placing the Session (the only restore path) clears
         * the row the same way it clears any other structural violation.
         */
        severity: 'HARD',
        params: [],
    },

    {
        key: 'no_session_outside_allowed_room',
        category: 'structure',
        label: 'Sessions must use a room the offering allows',
        description:
            'An offering can restrict which rooms may host it: a room PIN ("only these '
            + 'two lecture halls") and an online mode (forbidden, allowed, or online '
            + 'only). The solver honours both; a person dragging a session on the grid '
            + 'can break either. This reports it (warn, never block) so the breach is '
            + 'listed and counted rather than living only in whoever happened to be '
            + 'looking.',
        evaluator: 'app',
        /*
         * HARD, like `no_unplaced_session` and unlike `no_session_spanning_break`:
         * a room outside the allow-list is not a preference the tenant expressed
         * about where teaching happens, it is teaching happening somewhere the
         * Offering says it cannot. The solver treats the same restriction as an
         * absolute eligibility filter (`individually_eligible` in `convert.rs`),
         * so a SOFT reading here would have the two halves of the product
         * disagreeing about what the tenant asked for.
         *
         * NO WIRE FIELD, deliberately, and this is not the `no_session_spanning_break`
         * situation where the solver side is simply unbuilt. The restriction ALREADY
         * crosses the wire, as `Offering.allowed_room_ids` and `Offering.allow_online`
         * — Offering DATA, not tenant policy — so a constraint carrying it again
         * would be the same requirement twice, from two sources that can drift.
         * This type exists only for the half the solver cannot see: a manual edit.
         */
        severity: 'HARD',
        params: [],
    },

    // ---- Structural, evaluated here, RELATION-BASED (ADR-0028) --------------
    {
        key: 'different_time',
        category: 'structure',
        label: 'Different time',
        description:
            'Named offerings must never be scheduled at overlapping times, even '
            + 'though they share no room, lecturer or group: the case an elective '
            + 'combination is, where the students taking both are not a modelled '
            + 'cohort.',
        evaluator: 'app',
        severity: 'HARD',
        /*
         * NO `params`: its one configurable fact is WHICH Offerings relate,
         * which is `ConstraintRelationMember`, not a scalar the params form can
         * render. NO `wireField` either: it is sent, just not through
         * `ConstraintConfig`: see `assembleSolverInput`'s relation carve-out.
         */
        params: [],
        relation: { minMembers: 2 },
    },

    /*
     * SOLVER-EVALUATED RELATIONS (issues #54, #37): the same `relation` shape
     * as `different_time`, sent through the same `OfferingRelation` carve-out,
     * evaluated only at generation time. All HARD but PRICED at the solver's
     * hard penalty rather than filtered (solver 037502c, 7919b15): a full
     * week's set cannot be compared against a half-built week mid-search, so
     * a run can SUCCEED while reporting a mismatch, the warn-and-allow stance.
     *
     * PER WEEK, BEST EFFORT, for the three "same" kinds: in each week where
     * two or more members have a placed Session their sets must match; a week
     * where only one member meets imposes nothing. None requires equal
     * frequency. That sidesteps "one meets twice a week, the other three
     * times" without a shared meeting-pattern object.
     */
    {
        key: 'same_time',
        category: 'structure',
        label: 'Same time',
        description:
            'Named offerings meet at the same weekday-and-block slots in every week where '
            + 'two or more of them meet: two sections of one course taught in parallel. '
            + 'A week where only one of them meets is not compared.',
        evaluator: 'solver',
        severity: 'HARD',
        params: [],
        relation: { minMembers: 2 },
    },

    {
        key: 'same_days',
        category: 'structure',
        label: 'Same days',
        description:
            'Named offerings meet on the same weekdays in every week where two or more '
            + 'of them meet, whatever the time of day: a lecture and its lab on the same '
            + 'days so a commuting cohort travels once.',
        evaluator: 'solver',
        severity: 'HARD',
        params: [],
        relation: { minMembers: 2 },
    },

    {
        key: 'same_start',
        category: 'structure',
        label: 'Same start time',
        description:
            'Named offerings start in the same block of the day in every week where two '
            + 'or more of them meet, whatever the weekday: a course whose two weekly '
            + 'sessions always begin at 10:00.',
        evaluator: 'solver',
        severity: 'HARD',
        params: [],
        relation: { minMembers: 2 },
    },

    {
        key: 'precedence',
        category: 'structure',
        gridRelative: true,
        label: 'One offering before the next',
        description:
            'The named offerings form a chain IN THE ORDER LISTED: every session of an '
            + 'earlier one ends before any session of the next begins, across the whole '
            + 'term. A lab that follows its lecture, a tutorial after the material it '
            + 'reviews. The only relation whose member order matters.',
        evaluator: 'solver',
        /*
         * TERM-WIDE, ALL PAIRS, not "same week": a per-week pairing says
         * nothing about a lab in week 2 preceding a lecture in week 3. Both
         * narrower readings are reachable through the two parameters. A member
         * with no Session imposes nothing on its boundaries. HARD but priced,
         * like the three above (solver ADR-0028, "Precedence landed").
         */
        severity: 'HARD',
        params: [{
            key: 'minGapMinutes',
            label: 'Minimum gap, in minutes',
            type: 'number',
            min: 0,
            required: true,
            default: 0,
            help: 'Wall-clock time between the predecessor\u2019s last session ending and '
                + 'the successor\u2019s first beginning, through the time grid. 0 keeps the '
                + 'order but allows back-to-back; 1440 is \u201Cat least a day later\u201D.',
        }, {
            key: 'maxDaysBetween',
            label: 'At most this many days apart',
            type: 'number',
            min: 0,
            required: true,
            default: 0,
            help: 'Calendar days from the predecessor\u2019s last session to the successor\u2019s '
                + 'first. 0 means no ceiling; 7 means \u201Cwithin a week of the lecture\u201D. '
                + 'Calendar days, so Friday to Monday is three.',
        }, {
            key: 'minDaysBetween',
            label: 'At least this many days apart',
            type: 'number',
            min: 0,
            required: true,
            default: 0,
            help: 'The floor on the same boundary, in the same calendar days: 1 means \u201Cnot '
                + 'before the next day\u201D, 2 \u201Cat least two days after\u201D. 0 keeps only the '
                + 'ordering. A day floor, not the minute gap above: minutes would stretch '
                + 'across every weekend and closure week.',
        }],
        relation: { minMembers: 2 },
    },

    // ---- Hard, solver-owned --------------------------------------------------
    {
        key: 'exact_frequency_per_offering',
        category: 'structure',
        defaultEnabled: true,
        wireField: 'exactFrequency',
        label: 'Exact session count per offering',
        description: 'Each offering gets exactly the number of sessions it declares: no more, no fewer.',
        evaluator: 'solver',
        severity: 'HARD',
        params: [],
    },
    {
        key: 'lecturer_veto',
        category: 'availability',
        defaultEnabled: true,
        wireField: 'lecturerVeto',
        label: 'Lecturer unavailability',
        description: 'Days or blocks an individual has blocked out.',
        evaluator: 'solver',
        severity: 'HARD',
        params: [],
    },
    {
        key: 'group_veto',
        category: 'availability',
        defaultEnabled: true,
        wireField: 'groupVeto',
        label: 'Honour group availability windows',
        description:
            'A group is only scheduled inside the dates it is available in a term: '
            + 'for a cohort that runs the first half of a term, or joins late. '
            + 'Groups with no window set are available all term.',
        evaluator: 'solver',
        /*
         * Same architecture as `lecturer_veto`, which this is a twin of one
         * entity across: the WINDOWS live on the Group
         * (`group_term_availability`) and this row is the tenant-level switch.
         * Hence `params: []`: there is nothing to configure that is not either
         * enablement or somebody's own stated window.
         *
         * HARD, like its twin: an absent cohort cannot attend, so a Session
         * placed outside its window is not an expensive choice but a wrong one.
         * A tenant who wants "prefer to avoid" wants a different, soft rule.
         */
        severity: 'HARD',
        params: [],
    },
    {
        key: 'online_onsite_same_day_exclusion',
        category: 'online',
        defaultEnabled: true,
        wireField: 'onlineOnsiteSameDay',
        /*
         * SOFT since the reclassification, and the label moved with it: the solver
         * used to eliminate a mixing placement and now prices one, so "No mixing…"
         * would be the control asserting the opposite of the behaviour.
         *
         * The KEY must stay unchanged: `type` is createOnly, so renaming it would
         * orphan every stored row rather than migrate it.
         */
        label: 'Minimize online/on-site switching in a day',
        description: 'Prefer not to ask a group to be on campus and online on the same day.',
        evaluator: 'solver',
        severity: 'SOFT',
        /*
         * Sits above the block-placement preferences (3–5) and below exam weeks
         * (8): switching delivery mode mid-day is a real cost to a cohort, but
         * it is not the thing a term is planned around.
         *
         * NOT OPTIONAL. `defaultConstraintRow` throws for a SOFT type with no
         * `defaultWeight`, rather than seeding 0, which the solver reads as
         * "count it, do not steer" and would look like a deliberate choice.
         * Pinned by tests/constraint-catalogue.test.ts.
         */
        defaultWeight: 5,
        params: [],
    },
    {
        key: 'max_online_ratio_per_group',
        category: 'online',
        defaultEnabled: true,
        wireField: 'maxOnlineShare',
        label: 'Cap online share per group',
        description: 'At most this share of a group\'s sessions may be online across the term.',
        evaluator: 'solver',
        severity: 'HARD',
        params: [{
            key: 'maxRatio',
            label: 'Maximum online share',
            type: 'percent',
            min: 0,
            max: 100,
            required: true,
            default: 30,
            help: 'Was hardcoded at 30% in the prototype; it is a parameter here.',
        }, {
            key: 'window',
            label: 'Measured over',
            type: 'select',
            required: true,
            default: 'SHARE_WINDOW_PER_TERM',
            options: [
                { value: 'SHARE_WINDOW_PER_TERM', label: 'The whole term' },
                { value: 'SHARE_WINDOW_PER_WEEK', label: 'Each week' },
            ],
            help: 'A 30% cap per term and per week are very different rules; the solver needs to know which.',
        }],
    },

    // ---- Soft, solver-owned --------------------------------------------------
    {
        key: 'minimize_first_block',
        category: 'days',
        gridRelative: true,
        wireField: 'minimizeFirstBlock',
        label: 'Avoid the first block',
        description: 'Prefer not to schedule in the earliest block of the day.',
        evaluator: 'solver',
        severity: 'SOFT',
        defaultWeight: 5,
        params: [],
        // Superseded by `minimize_block_usage`. Kept so tenants who already
        // configured it keep working: a catalogue entry that disappears turns
        // an existing row into an unrenderable one, and `type` is createOnly so
        // it could not be edited to the replacement either.
        deprecatedBy: 'minimize_block_usage',
    },
    {
        key: 'minimize_last_block',
        category: 'days',
        wireField: 'minimizeLastBlock',
        label: 'Avoid the last block',
        description: 'Prefer not to schedule in the latest block of the day.',
        evaluator: 'solver',
        severity: 'SOFT',
        defaultWeight: 5,
        params: [],
        deprecatedBy: 'minimize_block_usage',
    },
    {
        key: 'minimize_block_usage',
        category: 'days',
        /*
         * NOT `defaultEnabled: true`, unlike most solver-owned SOFT types.
         *
         * This type has no default SELECTION: `blocks`/`first`/`last` carry no
         * `default`, so a seeded row starts with `params: {}`, and the
         * `unsendableWhen` check below says exactly that configuration cannot
         * be sent. Seeded enabled, it failed `INVALID_ARGUMENT` on the FIRST
         * run of every tenant provisioned before this fix, 68ms after the row
         * was created, with nothing before the solver call able to see it
         * coming: `GET /api/solver/preflight` and this route's own pre-flight
         * check now catch it, but a rule that can never be sent without the
         * tenant choosing something first should not start switched on.
         */
        gridRelative: true,
        wireField: 'minimizeBlockUsage',
        label: 'Avoid particular blocks',
        description:
            'Prefer not to schedule in the chosen blocks of the day. Replaces the separate '
            + '"avoid the first block" and "avoid the last block" rules, doing for the block '
            + 'axis what "avoid particular days" did for the day axis.',
        evaluator: 'solver',
        severity: 'SOFT',
        defaultWeight: 5,
        params: [
            {
                key: 'blocks',
                label: 'Block positions to avoid',
                type: 'text',
                required: false,
                help: 'Comma-separated positions, counting the first block of the day as 1. '
                    + 'A position past the end of the day is ignored rather than an error, '
                    + 'so shrinking a grid never invalidates a rule.',
            },
            {
                // First and last are FLAGS, not positions, and that is the whole
                // reason this type has both. "Block 6" is absolute: extend the
                // day from 6 blocks to 8 and it still means block 6, now
                // mid-afternoon, though nobody edited the rule. "The last block"
                // follows the grid. Offering only positions would silently lose
                // an intent the two replaced rules could express.
                key: 'first',
                label: 'Also avoid the first block, whichever it is',
                type: 'boolean',
                required: false,
            },
            {
                key: 'last',
                label: 'Also avoid the last block, whichever it is',
                type: 'boolean',
                required: false,
            },
        ],
        /*
         * The real production failure this exists for: `MinimizeBlockUsage
         * selects no blocks - set at least one index, or first/last`, straight
         * from the solver, because none of the three params is individually
         * `required` and all three were left unset.
         */
        unsendableWhen: (params) => (
            parseBlockPositions(params.blocks).length > 0 || params.first === true || params.last === true
                ? undefined
                : {
                    code: 'EMPTY_BLOCK_SELECTION',
                    message: 'No block positions are set to avoid, and neither "avoid the first block" nor '
                        + '"avoid the last block" is turned on, so this rule has nothing to steer away from.',
                    fixHint: 'Open Settings → Constraints → "Avoid particular blocks" and either enter block '
                        + 'positions to avoid, or turn on "avoid the first block" / "avoid the last block".',
                }
        ),
    },
    {
        key: 'minimize_specifc_day',
        category: 'days',
        /*
         * NOT `defaultEnabled: true`, for the same reason as `minimize_block_usage`
         * just above. `days` is `required` with deliberately no default (see the
         * param below), so a seeded-enabled row starts with `params: {}` and fails
         * `missingConstraintParams`/`validateConstraint` on the very first solver
         * run: "'Avoid particular days' is missing required value(s): Days to
         * avoid." A rule that can never be sent without the tenant choosing
         * something first should not start switched on.
         */
        wireField: 'minimizeDayUsage',
        label: 'Avoid particular days',
        description:
            'Prefer not to schedule on the chosen weekdays. Generalizes the prototype\'s '
            + 'hardcoded "minimize Saturday": with tenant-configured active days, Saturday '
            + 'is not structurally special.',
        evaluator: 'solver',
        severity: 'SOFT',
        defaultWeight: 5,
        params: [{
            key: 'days',
            label: 'Days to avoid',
            type: 'weekdays',
            required: true,
            // DELIBERATELY NO DEFAULT. Defaulting to [6,7] would reintroduce the
            // hardcoded-Saturday assumption TAXONOMY.md §7 forbids: a tenant may
            // not teach Saturday at all, or may want a different day
            // deprioritized. Unset means the constraint is skipped, not guessed.
            help: 'No default: which days are undesirable is an institutional decision, not an assumption.',
        }],
    },
    {
        key: 'minimize_high_ranking_rooms',
        category: 'rooms',
        /*
         * NOT `defaultEnabled: true`. `rankThreshold` below is `required` with
         * deliberately no default ("premium" is per-institution), so a
         * seeded-enabled row would start `params: {}` and fail
         * `validateConstraint` on the very first solver run — the same shape
         * as `minimize_block_usage` and `minimize_specifc_day` above, caught
         * here by `provisionTenant.ts`'s boot-time assertion before it ever
         * reached a real tenant.
         */
        wireField: 'minimizeRoomRank',
        /*
         * Named for the AXIS, not for one direction along it.
         *
         * This was "Spare the best rooms", which is only half of what the rule
         * can now express: `invert` steers placement toward the premium rooms
         * instead. A label accurate for one setting of a control the same rule
         * offers is the mislabelled-constraint problem in miniature, and the key
         * is `createOnly`, so a row saved under a wrong name cannot be renamed
         * by changing its type.
         */
        label: 'Steer room choice by rank',
        description:
            'Bias the solver toward one end of your room ranking. The threshold marks '
            + 'the boundary; the direction decides which side of it is discouraged.',
        evaluator: 'solver',
        severity: 'SOFT',
        defaultWeight: 3,
        params: [{
            key: 'rankThreshold',
            label: 'Rank boundary',
            type: 'number',
            min: 0,
            required: true,
            help: 'Room.ranking is ordered HIGHER = more premium. No default: "premium" is per-institution.',
        }, {
            key: 'invert',
            label: 'Prefer the best rooms instead of sparing them',
            type: 'boolean',
            required: false,
            /*
             * DEFAULTS TO TRUE, expressed ONCE here rather than as a catalogue
             * default of false with a provisioning override: two defaults for one
             * field agree until something distinguishes them, and then the form
             * prefills one thing while provisioning writes another.
             *
             * EXISTING tenants are untouched: their stored params carry no
             * `invert` key, which reads as false. This governs new rows only.
             */
            default: true,
            help: 'Off: discourage rooms AT OR ABOVE the boundary, keeping premium rooms free. '
                + 'On: discourage rooms AT OR BELOW it, so lessons fill the better rooms first.',
        }],
    },
    {
        key: 'minimize_exam_week_sessions',
        category: 'exams',
        defaultEnabled: true,
        wireField: 'minimizeExamWeek',
        /*
         * Named for the AXIS, not for one direction along it, the same
         * correction `minimize_high_ranking_rooms` already carries, and for the
         * same reason: `key` is `createOnly`, so a row saved under a label that
         * describes only one setting of its own control cannot be renamed by
         * changing its type.
         */
        label: 'Steer sessions relative to exam periods',
        description:
            'Bias the solver toward or away from exam periods, resolved against the '
            + 'academic calendar rather than assuming the last few weeks. Scope the rule '
            + 'to a session kind to steer only those.',
        evaluator: 'solver',
        severity: 'SOFT',
        defaultWeight: 8,
        params: [{
            key: 'invert',
            label: 'Pull sessions INTO the exam period instead of away from it',
            type: 'boolean',
            required: false,
            /*
             * FALSE, unlike `minimize_high_ranking_rooms`'s `invert`, which
             * defaults to true. Not an inconsistency: that rule's two directions
             * are both ordinary choices, while this one's inverted direction is
             * for exam-kind sessions specifically. A new rule created without
             * thinking about direction should keep exam weeks clear, which is
             * what this type has always done.
             *
             * EXISTING rows are untouched either way: their stored params carry
             * no `invert` key, which `buildVariant` reads as false.
             */
            default: false,
            help: 'Off: discourage scheduling during exam periods, keeping them clear. '
                + 'On: discourage scheduling OUTSIDE them, so the sessions this rule '
                + 'applies to are drawn in. Turning this on usually means scoping the '
                + 'rule to your exam session kind; unscoped, it pulls everything in.',
        }],
    },
    {
        key: 'compactness',
        category: 'days',
        defaultEnabled: true,
        gridRelative: true,
        wireField: 'compactness',
        label: 'Keep the day compact',
        description:
            'Discourage idle gaps between the first and last session of a day. A 09:00 '
            + 'lecture and a 17:00 seminar with nothing between is a bad day this is the '
            + 'only rule that can see.',
        evaluator: 'solver',
        severity: 'SOFT',
        defaultWeight: 5,
        params: [{
            key: 'scope',
            label: 'Whose day',
            type: 'select',
            required: true,
            /*
             * BOTH is the default because the two axes are different sets, not
             * two views of one: a placement usually sits in a Group's day AND in
             * several People's, and a rule that counted only one would leave the
             * other's gaps invisible while looking configured.
             */
            default: 'BOTH',
            options: [
                { value: 'BOTH', label: 'Groups and people' },
                { value: 'GROUP', label: 'Groups only' },
                { value: 'PERSON', label: 'People only' },
            ],
            help: 'A group\'s day and a person\'s day are different sets: a lecturer teaching '
                + 'three cohorts has gaps none of those cohorts can see.',
        }],
    },
    {
        key: 'minimize_online_sessions',
        category: 'online',
        defaultEnabled: true,
        wireField: 'minimizeOnline',
        label: 'Prefer on-site',
        description: 'Prefer on-site delivery where either would satisfy the offering.',
        evaluator: 'solver',
        severity: 'SOFT',
        defaultWeight: 3,
        params: [],
    },
    {
        key: 'person_preference_fit',
        category: 'availability',
        defaultEnabled: true,
        /*
         * CROSSES THE WIRE, and this line had to land in the same change as the
         * solver's evaluator, never before it.
         *
         * The proto has carried the field since 0.7.0, but until
         * `calendry-solver` 41f6227 its `convert.rs` answered this variant with
         * `Status::unimplemented`. That is a StartRun FAILURE, not a skipped
         * rule, so naming the field early would have taken a tenant who enabled
         * this from "the rule quietly does nothing" to "every solve fails
         * outright", which is strictly worse than the state it replaced.
         * `per-person-preferences-design.md` § "Where `wireField` gets flipped"
         * has the three-row table.
         *
         * ONE COUPLING SURVIVES, and it is why `buildVariant` must keep
         * returning `{}` for this key: the solver REFUSES a non-empty `roles`
         * rather than approximating it, because empty means "lecturers only"
         * and widening the counted set would let a 200-student cohort's
         * aggregate preference outweigh the person teaching. An empty variant is
         * therefore not laziness; it is the only accepted value, and sending a
         * role would fail the run. See solver ADR-0026.
         */
        wireField: 'personPreferenceFit',
        label: 'Honour personal preferences',
        description:
            'Prefer the days and blocks a lecturer has said they would rather teach. '
            + 'Only lecturers\' preferences count, and a breach is never a defect: this '
            + 'competes with the other soft rules on weight alone.',
        evaluator: 'solver',
        /*
         * Same architecture as `lecturer_veto`, one severity down: the VALUES
         * live on the Person (`person_preference`), and this row is the
         * tenant-level switch plus how much the tenant cares. Hence `params:
         * []`: there is nothing to configure here that is not either the
         * weight or somebody's own stated preference.
         */
        severity: 'SOFT',
        defaultWeight: 5,
        params: [],
    },
    {
        key: 'group_size_fits_room',
        category: 'rooms',
        defaultEnabled: true,
        wireField: 'groupSizeFitsRoom',
        label: 'Rooms must fit the groups actually attending',
        description:
            'Checks the room against the real size of the groups in the session, not just '
            + 'the minimum capacity recorded on the offering. Catches a room that fits the '
            + 'number somebody typed but not the cohort that turns up.',
        evaluator: 'solver',
        /*
         * HARD, and validation-shaped rather than a preference. It compares two
         * facts the wire already carries, `Group.size` against
         * `Room.capacity`, so a breach is a defect in the data or the
         * placement, never a trade-off worth weighing.
         *
         * It exists BECAUSE `Offering.min_capacity` is derived: `deriveCapacity`
         * falls back to an estimate and reports when it could not establish one
         * at all. This is the cross-check for when that derivation was wrong.
         */
        severity: 'HARD',
        params: [],
    },

    {
        key: 'minimize_specialized_room_use',
        category: 'rooms',
        wireField: 'minimizeSpecializedRoomUse',
        label: 'Keep specialized rooms free',
        description:
            'Discourages placing a session in a room marked \u201Cspecialized\u201D (a lab, '
            + 'a computer room, a workshop) when the offering requires none of that '
            + 'room\u2019s equipment, so the room stays free for the teaching that needs '
            + 'it. Room eligibility is a superset filter, so without this an ordinary '
            + 'lecture can take the lab.',
        evaluator: 'solver',
        /*
         * SOFT: an ordinary lecture in the lab is a bad use of a scarce room,
         * not an invalid timetable, and on a tight week it may be the only
         * placement left. Reads `Room.isSpecialized` (issue #121); a tenant
         * that marks no room pays nothing.
         */
        severity: 'SOFT',
        defaultWeight: 5,
        params: [],
    },

    {
        key: 'room_consistency',
        category: 'rooms',
        defaultEnabled: true,
        wireField: 'roomConsistency',
        label: 'Keep an offering in the same room',
        description:
            'A course\u2019s weekly sessions should reuse one room rather than bouncing '
            + 'around the building. Every session sitting somewhere other than the '
            + 'offering\u2019s usual room is charged.',
        evaluator: 'solver',
        /*
         * The Room half of `LecturerConsistency`, and buildable where that one
         * is not: Room assignment is already a search variable, while lecturer
         * assignment is gated behind unimplemented pool selection.
         *
         * "Usual" is the MODAL room among the offering's currently placed
         * sessions, recomputed as placements change rather than fixed to
         * whichever session landed first, so the rule cannot be satisfied by
         * accident of ordering.
         */
        severity: 'SOFT',
        defaultWeight: 3,
        params: [],
    },

    {
        key: 'minimize_weekday_imbalance',
        category: 'days',
        defaultEnabled: true,
        wireField: 'minimizeWeekdayImbalance',
        label: 'Spread a group\u2019s week evenly',
        description:
            'Discourage a class having five sessions on Monday and one on Friday. '
            + 'Measured across the teaching days this institution actually uses, not an '
            + 'assumed Monday-to-Friday.',
        evaluator: 'solver',
        /*
         * NO PARAMETERS, and the proto reserved field 1 rather than inventing
         * one: the variance is read straight off `TimeGrid.active_days`, so
         * there is nothing for a tenant to state that the grid does not already
         * say. Adding a knob later is an ordinary field addition.
         *
         * Distinct from `minimize_specifc_day`, which targets NAMED weekdays
         * regardless of what else that group has that week. This is a property
         * of the whole week.
         */
        severity: 'SOFT',
        defaultWeight: 3,
        params: [],
    },

    {
        key: 'max_concurrent_online_sessions',
        category: 'online',
        // NOT `defaultEnabled: true`: `maxConcurrent` below is `required` with
        // deliberately no default (a licence figure, not a preference), the
        // same seeded-broken shape as `minimize_high_ranking_rooms` above.
        wireField: 'maxConcurrentOnlineSessions',
        label: 'Cap online sessions running at once',
        description:
            'A tenant-wide limit on how many sessions may be online in the same slot \u2014 '
            + 'a platform seat count, not a room. Independent of group and of session kind.',
        evaluator: 'solver',
        /*
         * HARD, and genuinely enforceable as one unlike `max_online_ratio_per_group`.
         * The count at a single slot is fully known while placing, with no
         * moving denominator, so the solver filters on it in `is_free` rather
         * than pricing it, which is what ADR-0025 records as the reason the
         * share cap could NOT be a filter.
         *
         * The cap lives on the rule, not on a Room: a virtual Room has no
         * capacity concept (solver ADR-0022), and this models a platform-wide
         * licence limit rather than any one room's property.
         */
        severity: 'HARD',
        params: [{
            key: 'maxConcurrent',
            label: 'Maximum at the same time',
            type: 'number',
            min: 1,
            required: true,
            help: 'How many online sessions your platform can genuinely host at once. '
                + 'No default: this is a licence figure, not a preference.',
        }],
    },

    {
        key: 'room_turnaround_buffer',
        category: 'rooms',
        gridRelative: true,
        wireField: 'roomTurnaroundBuffer',
        label: 'Leave a gap between bookings of one room',
        description:
            'A room needing reset between uses \u2014 a lab clearing equipment, a hall '
            + 'being re-laid \u2014 should not be booked back to back. Measured in blocks, '
            + 'and never across a week boundary.',
        evaluator: 'solver',
        /*
         * SOFT even though it reads like a rule. A tenant enabling this without
         * a genuine cleanup need makes the instance needlessly harder to solve,
         * which SOFT absorbs and HARD would turn into unplaceable sessions.
         *
         * Genuinely a new shape: pairwise like the four double-booking types,
         * but keyed by a configurable DISTANCE rather than exact-slot overlap.
         */
        severity: 'SOFT',
        defaultWeight: 5,
        params: [{
            key: 'bufferBlocks',
            label: 'Blocks to leave free',
            type: 'number',
            min: 1,
            required: true,
            default: 1,
            help: 'One block is the usual answer. This is in BLOCKS, not minutes \u2014 how '
                + 'long a block is comes from your time grid.',
        }],
    },

    {
        key: 'minimize_room_churn',
        category: 'rooms',
        wireField: 'minimizeRoomChurn',
        label: 'Give a group a home room',
        description:
            'Cap how many different rooms a class uses across a week. Mostly one room, '
            + 'with a special-purpose room as the exception \u2014 the school model rather '
            + 'than the university one.',
        evaluator: 'solver',
        /*
         * A plain distinct COUNT across the week, not weighted by how often the
         * group returns to its most-used room. That is the difference from
         * `room_consistency`, which is per-offering across the term.
         *
         * Also distinct from `minimize_location_change`, which is about
         * building-hopping WITHIN a day: a group can keep to one building all
         * week and still use six rooms in it.
         */
        severity: 'SOFT',
        defaultWeight: 3,
        params: [{
            key: 'maxRoomsPerWeek',
            label: 'Rooms a group may use in a week',
            type: 'number',
            min: 1,
            required: true,
            default: 2,
            help: 'Past this, each extra room is charged. 2 allows a home room plus one '
                + 'specialist room; raise it for a university-style timetable.',
        }],
    },

    {
        key: 'minimize_capacity_waste',
        category: 'rooms',
        defaultEnabled: true,
        wireField: 'minimizeCapacityWaste',
        label: 'Reward a good room-size fit',
        description:
            'Discourage putting a seminar of twelve into a 400-seat hall. Room eligibility '
            + 'only asks whether a room is big ENOUGH; this asks whether it is the right '
            + 'size.',
        evaluator: 'solver',
        /*
         * GRADED BY RATIO, not a flat charge past a line: the penalty grows with
         * how far past the threshold a room is, so a 400-seat hall for twelve
         * costs more than a 60-seat one. A flat charge would make those two
         * choices identical to the search.
         *
         * The threshold is a RATIO of the offering's required capacity, not a
         * seat count, so one setting works for a tenant whose rooms run from 12
         * to 400.
         */
        severity: 'SOFT',
        defaultWeight: 3,
        params: [{
            key: 'wasteRatioThreshold',
            label: 'Tolerated size ratio',
            type: 'number',
            min: 1,
            required: true,
            default: 2,
            help: '2 means a room up to twice the size needed is fine and anything larger '
                + 'is charged, more the larger it gets. 1 charges any room bigger than '
                + 'strictly necessary.',
        }],
    },

    {
        key: 'max_weekly_teaching_load',
        category: 'workload',
        // NOT `defaultEnabled: true`: `maxPerWeek` below is `required` with
        // deliberately no default (a contractual figure, not a guess), the
        // same seeded-broken shape as `minimize_high_ranking_rooms` above.
        gridRelative: true,
        wireField: 'maxWeeklyTeachingLoad',
        label: 'Cap a lecturer\u2019s teaching per week',
        description:
            'How much one person may teach in a week. Answers a question neither existing '
            + 'lecturer rule does: unavailability blocks specific TIMES, and nothing caps '
            + 'the total.',
        evaluator: 'solver',
        /*
         * SOFT, and for the reason ADR-0025 records rather than as a softening.
         * A hard cap on a count that only becomes fully known as placements
         * accumulate is the dead-end-construction problem `MaxOnlineShare` ran
         * into: the search can paint itself into a corner it cannot leave.
         *
         * A contract limit is still expressible: set the weight high enough to
         * dominate, and stays recoverable rather than making the term
         * infeasible.
         */
        severity: 'SOFT',
        defaultWeight: 8,
        params: [{
            key: 'maxPerWeek',
            label: 'Maximum per week',
            type: 'number',
            min: 1,
            required: true,
            help: 'No default: a teaching load is a contractual figure, not something to '
                + 'guess on an institution\u2019s behalf.',
        }, {
            key: 'countBlocks',
            label: 'Count blocks rather than sessions',
            type: 'boolean',
            required: false,
            default: false,
            /*
             * FALSE is today's only reading, and the honest one for a tenant
             * who has not thought about it: "sessions" is what a person
             * counting their own week says. A double-length lecture counting as
             * two is a deliberate choice, not a default.
             */
            help: 'Off \u2014 a double-length lecture counts once. On \u2014 it counts twice, '
                + 'which is the right reading when the limit is about hours taught.',
        }],
    },

    {
        key: 'max_consecutive_blocks',
        category: 'days',
        gridRelative: true,
        wireField: 'maxConsecutiveBlocks',
        label: 'Cap teaching without a break',
        description:
            'How many blocks in a row a class or a person may be scheduled with no gap. '
            + 'The mirror of \u201CKeep the day compact\u201D, which removes gaps \u2014 these two '
            + 'pull in opposite directions on purpose.',
        evaluator: 'solver',
        /*
         * DELIBERATELY ENABLE-BOTH-ABLE. Compactness alone would happily pack a
         * group into six unbroken blocks, which is a perfect score and a bad
         * day. This is the counterweight, and a tenant is meant to run both at
         * different weights rather than choose between them.
         */
        severity: 'SOFT',
        defaultWeight: 5,
        params: [{
            key: 'scope',
            label: 'Whose day',
            type: 'select',
            required: true,
            default: 'BOTH',
            options: [
                { value: 'BOTH', label: 'Groups and people' },
                { value: 'GROUP', label: 'Groups only' },
                { value: 'PERSON', label: 'People only' },
            ],
            help: 'A group\u2019s day and a person\u2019s day are different sets \u2014 a lecturer '
                + 'teaching three cohorts has a day none of those cohorts can see.',
        }, {
            key: 'maxConsecutive',
            label: 'Blocks in a row before it counts',
            type: 'number',
            min: 1,
            required: true,
            default: 4,
            help: 'Each block past this is charged. In BLOCKS \u2014 how long a block is '
                + 'comes from your time grid.',
        }],
    },

    {
        key: 'max_daily_span',
        category: 'days',
        gridRelative: true,
        wireField: 'maxDailySpan',
        label: 'Cap how long a day runs',
        description:
            'From the first session to the last, however much of it is teaching. A day '
            + 'with one session at 09:00 and one at 17:00 is a long day even though it '
            + 'is barely any teaching.',
        evaluator: 'solver',
        /*
         * NONE OF THE THREE DAY RULES SUBSUMES THE OTHERS, which is why all
         * three exist:
         *
         *   compactness            the GAPS inside the span
         *   max_consecutive_blocks the DENSITY of an unbroken run
         *   this                   the SPAN itself, first slot to last
         *
         * A day can have no gaps and low density and still run from eight to
         * six.
         */
        severity: 'SOFT',
        defaultWeight: 5,
        params: [{
            key: 'scope',
            label: 'Whose day',
            type: 'select',
            required: true,
            default: 'BOTH',
            options: [
                { value: 'BOTH', label: 'Groups and people' },
                { value: 'GROUP', label: 'Groups only' },
                { value: 'PERSON', label: 'People only' },
            ],
            help: 'A group\u2019s day and a person\u2019s day are different sets \u2014 a lecturer '
                + 'teaching three cohorts has a day none of those cohorts can see.',
        }, {
            key: 'maxSpanBlocks',
            label: 'Blocks from first to last',
            type: 'number',
            min: 1,
            required: true,
            default: 8,
            help: 'Counts every block between the first and last session, teaching or not. '
                + 'Each block past this is charged.',
        }],
    },

    {
        key: 'max_days',
        category: 'days',
        wireField: 'maxDays',
        label: 'Cap the days used per week',
        description:
            'Never more than this many different weekdays carry teaching for a group or '
            + 'a person in one week. The HARD counterpart of “Prefer fewer teaching '
            + 'days”: a weight can be outvoted, a cap cannot. Built for the part-time '
            + 'lecturer contracted for two days a week.',
        evaluator: 'solver',
        /*
         * HARD, priced at the solver's hard penalty rather than used as a
         * construction filter (calendry-solver fcd1c48, the same stance as
         * MaxOnlineShare): a run can SUCCEED while reporting the breach, so a
         * cap that makes an otherwise-feasible term infeasible warns rather
         * than dead-ends. The UI copy above must keep saying "cap", not
         * "prefer": the whole point of the type (issue #56) is that it is not
         * interchangeable with the soft rule next to it.
         */
        severity: 'HARD',
        params: [{
            key: 'scope',
            label: 'Whose week',
            type: 'select',
            required: true,
            default: 'PERSON',
            options: [
                { value: 'BOTH', label: 'Groups and people' },
                { value: 'GROUP', label: 'Groups only' },
                { value: 'PERSON', label: 'People only' },
            ],
            help: 'A group\u2019s week and a person\u2019s week are different sets \u2014 a lecturer '
                + 'teaching three cohorts has a week none of those cohorts can see.',
        }, {
            key: 'maxDays',
            label: 'Weekdays at most',
            type: 'number',
            min: 1,
            max: 7,
            required: true,
            default: 2,
            help: 'Distinct weekdays with at least one session, counted per week. Each week '
                + 'over the cap is a hard breach.',
        }],
    },

    {
        key: 'max_consecutive_days',
        category: 'days',
        wireField: 'maxConsecutiveDays',
        label: 'Cap consecutive teaching days',
        description:
            'Never more than this many teaching days in a row for a group or a person in '
            + 'one week: a stretch of four days followed by one off, never five straight. '
            + 'A cap, not a preference.',
        evaluator: 'solver',
        // Same HARD-but-priced stance as max_days above; both share the
        // solver's distinct-days accumulator, one counting days, the other
        // the longest run.
        severity: 'HARD',
        params: [{
            key: 'scope',
            label: 'Whose week',
            type: 'select',
            required: true,
            default: 'PERSON',
            options: [
                { value: 'BOTH', label: 'Groups and people' },
                { value: 'GROUP', label: 'Groups only' },
                { value: 'PERSON', label: 'People only' },
            ],
            help: 'A group\u2019s week and a person\u2019s week are different sets \u2014 a lecturer '
                + 'teaching three cohorts has a week none of those cohorts can see.',
        }, {
            key: 'maxConsecutiveDays',
            label: 'Teaching days in a row at most',
            type: 'number',
            min: 1,
            max: 7,
            required: true,
            default: 4,
            help: 'The longest run of consecutive weekdays with teaching, counted per week. '
                + 'Only the grid\u2019s active days count as consecutive.',
        }],
    },

    {
        key: 'daybreak',
        category: 'days',
        gridRelative: true,
        wireField: 'daybreak',
        label: 'Overnight rest between teaching days',
        description:
            'A minimum gap between the last session of one teaching day and the first '
            + 'of the next, for a group or a person. Every other day rule stops at '
            + 'midnight: without this, finishing at 21:00 and starting at 08:00 is a '
            + 'valid timetable.',
        evaluator: 'solver',
        /*
         * HARD, priced at the hard penalty (calendry-solver 3516493), the same
         * stance as the day caps above. WALL-CLOCK, not blocks: the gap is
         * resolved through the TimeGrid (last block's end, next day's first
         * block's start), so a grid's breaks shift the boundary and a block
         * count would give a different answer per grid. Consecutive TEACHING
         * days only, as the grid's active days define them: Friday evening to
         * Monday morning is never compared. Charged once per violated pair.
         */
        severity: 'HARD',
        params: [{
            key: 'scope',
            label: 'Whose night',
            type: 'select',
            required: true,
            default: 'BOTH',
            options: [
                { value: 'BOTH', label: 'Groups and people' },
                { value: 'GROUP', label: 'Groups only' },
                { value: 'PERSON', label: 'People only' },
            ],
            help: 'A group\u2019s day and a person\u2019s day are different sets \u2014 a lecturer '
                + 'teaching three cohorts has evenings none of those cohorts can see.',
        }, {
            key: 'minRestMinutes',
            label: 'Minimum rest, in minutes',
            type: 'number',
            min: 0,
            required: true,
            default: 660,
            help: 'From the end of the last block of one teaching day to the start of the '
                + 'first block of the next, by the clock. 660 is eleven hours, the common '
                + 'working-time floor.',
        }],
    },

    {
        key: 'minimize_break_spanning',
        category: 'days',
        gridRelative: true,
        wireField: 'minimizeBreakSpanning',
        label: 'Avoid sessions that run through a break',
        description:
            'Discourages a multi-block session from starting before a break and '
            + 'finishing after it, so teaching does not straddle the lunch hour. Soft: a '
            + 'three-hour lab through a short coffee break is ordinary, and the weight says '
            + 'how hard to steer.',
        evaluator: 'solver',
        /*
         * REVERSES a recorded decision, deliberately (issue #26; DECISIONS.md
         * § "A Session that spans a break"): such placements stay LEGAL and
         * are drawn honestly, and manual edits may still produce them, but
         * the solver now sees the grid's real gaps and prices spanning one.
         *
         * WEIGHTING WARNING, carried from the card: on a grid with
         * `breakMinutes > 0` EVERY consecutive block pair is separated, so
         * every multi-block Session spans a gap and this charges every one of
         * them. It exists for the long lunch break, not the five-minute
         * changeover; a tenant whose grid has a uniform gap and no named break
         * should leave it off, or accept that it prices duration.
         */
        severity: 'SOFT',
        defaultWeight: 3,
        params: [],
    },

    {
        key: 'travel_time_between_rooms',
        category: 'rooms',
        gridRelative: true,
        wireField: 'travelTimeBetweenRooms',
        label: 'Travel time between locations',
        description:
            'Requires a gap when a group\u2019s or a person\u2019s consecutive sessions on one '
            + 'day are in rooms at different locations: another building, another campus. '
            + 'Without it two rooms ten minutes apart can be booked back to back and the '
            + 'timetable is valid and physically impossible.',
        evaluator: 'solver',
        /*
         * READS `Room.location`, the free-text building/campus field the Room
         * form already has, NOT a new column: the solver chose to reuse the
         * field `MinimizeLocationChange` reads rather than introduce a second
         * one for the identical concept (calendry-solver, `TravelTimeInstance`).
         * An EMPTY location is "unconfigured" and counts as the SAME location as
         * every other empty one, so a single-building tenant that never filled
         * the field pays nothing. SOFT and priced like `room_turnaround_buffer`:
         * a minimum-gap requirement, wall-clock through the grid.
         */
        severity: 'SOFT',
        defaultWeight: 5,
        params: [{
            key: 'scope',
            label: 'Whose day',
            type: 'select',
            required: true,
            default: 'BOTH',
            options: [
                { value: 'BOTH', label: 'Groups and people' },
                { value: 'GROUP', label: 'Groups only' },
                { value: 'PERSON', label: 'People only' },
            ],
            help: 'A group\u2019s day and a person\u2019s day are different sets \u2014 a lecturer '
                + 'teaching three cohorts has a day none of those cohorts can see.',
        }, {
            key: 'minMinutesBetweenSites',
            label: 'Minimum gap between locations, in minutes',
            type: 'number',
            min: 1,
            required: true,
            default: 15,
            help: 'Wall-clock time from the end of one session to the start of the next when '
                + 'their rooms\u2019 locations differ, through the time grid. Locations are the '
                + 'room\u2019s \u201CLocation\u201D field; rooms with no location count as one place.',
        }],
    },

    {
        key: 'minimize_location_change',
        category: 'rooms',
        defaultEnabled: true,
        wireField: 'minimizeLocationChange',
        label: 'Keep a day on one site',
        description:
            'Discourage a day that crosses buildings. Uses each room\u2019s Location field, '
            + 'so it is only as good as those values \u2014 rooms whose location is blank are '
            + 'not counted.',
        evaluator: 'solver',
        /*
         * THE HELP TEXT CARRIES A DATA WARNING deliberately. `Room.location` is
         * opaque free text and the solver imposes no format, so "Building A"
         * and "Bldg A" are two locations and a day using both looks like
         * cross-campus travel. That is a tenant-data problem this rule cannot
         * detect, and the only honest place to say so is where somebody enables
         * it.
         *
         * Distinct from `minimize_room_churn`, which counts distinct ROOMS
         * across a week: a group can change room every block and never leave
         * the building.
         */
        severity: 'SOFT',
        defaultWeight: 5,
        params: [{
            key: 'scope',
            label: 'Whose day',
            type: 'select',
            required: true,
            default: 'BOTH',
            options: [
                { value: 'BOTH', label: 'Groups and people' },
                { value: 'GROUP', label: 'Groups only' },
                { value: 'PERSON', label: 'People only' },
            ],
            help: 'A group\u2019s day and a person\u2019s day are different sets \u2014 a lecturer '
                + 'teaching three cohorts has a day none of those cohorts can see.',
        }, {
            key: 'maxLocationsPerDay',
            label: 'Sites allowed in one day',
            type: 'number',
            min: 1,
            required: true,
            default: 1,
            help: '1 means any second building is charged. Raise it if two sites in a day '
                + 'is normal here. Rooms with no location set are ignored.',
        }],
    },

    {
        key: 'exam_spacing_same_day',
        category: 'exams',
        defaultEnabled: true,
        appliesToKindType: 'EXAM',
        wireField: 'examSpacingSameDay',
        label: 'No two exams for a group on one day',
        description:
            'Discourage a class sitting two exams on the same day. Scope this rule to '
            + 'your exam session kind \u2014 unscoped it treats every session as an exam.',
        evaluator: 'solver',
        /*
         * WHICH SESSIONS COUNT AS EXAMS IS `applies_to_kinds`, not a field here.
         * That is the same scoping mechanism every kind-scoped type already
         * uses, and CLAUDE.md forbids hardcoding a kind called "exam": the
         * vocabulary is the tenant's.
         *
         * Narrower than `minimize_exam_week_sessions`, which is about the exam
         * PERIOD as a whole. This is about exams that already fall inside it not
         * landing on one day.
         */
        severity: 'SOFT',
        defaultWeight: 8,
        params: [],
    },

    {
        key: 'exam_spacing_window',
        category: 'exams',
        defaultEnabled: true,
        appliesToKindType: 'EXAM',
        wireField: 'examSpacingWindow',
        label: 'Clear days between a group\u2019s exams',
        description:
            'Discourage a class sitting two exams within a few days of each other. The '
            + 'generalisation of the same-day rule, for institutions that want revision '
            + 'time between papers.',
        evaluator: 'solver',
        /*
         * A SEPARATE TYPE rather than a parameter on the same-day rule, which is
         * the proto's own choice and worth keeping visible here: a tenant
         * wanting only "not the same day" pays no window-tracking cost, and a
         * tenant enabling both at once is a legitimate combination rather than
         * a conflict.
         *
         * `minDaysBetween: 1` asks exactly what the same-day rule asks. Stated
         * in the help so nobody enables both to mean one thing.
         */
        severity: 'SOFT',
        defaultWeight: 5,
        params: [{
            key: 'minDaysBetween',
            label: 'Days that must separate two exams',
            type: 'number',
            min: 1,
            required: true,
            default: 2,
            help: '1 says the same thing as the same-day rule. 2 leaves one clear day '
                + 'between papers. Scope this to your exam session kind.',
        }],
    },

    {
        key: 'protected_block',
        category: 'availability',
        gridRelative: true,
        wireField: 'protectedBlock',
        label: 'Reserve a slot institution-wide',
        description:
            'Lunch, assembly, a staff meeting \u2014 a time nothing may be scheduled into, '
            + 'for everyone at once. Scope it to a session kind if only some kinds should '
            + 'be kept out.',
        evaluator: 'solver',
        /*
         * THE FIRST HARD TYPE WHOSE VALUES ARE PURE TENANT POLICY carried on the
         * constraint itself. `lecturer_veto` and `group_veto` look similar and
         * are not: their windows live on the Person or Group and the rule only
         * switches enforcement on. There is no entity to hang "lunch" on.
         *
         * Monotone-safe like the four structural types: a protected slot is
         * never freed by placing something elsewhere, so the solver enforces it
         * in `is_free` rather than pricing it, and HARD is honest here in a way
         * it is not for `max_weekly_teaching_load`.
         *
         * ONE RECURRING WINDOW, not the wire's full list. `BlockedWindow` also
         * carries `weeks`, for a one-off reservation in named weeks only; this
         * form sends none, which the proto reads as every week. That covers
         * lunch and assembly, which is what the rule is for, and a one-off
         * closure is `calendar_period` work rather than a second control here.
         */
        severity: 'HARD',
        params: [{
            key: 'days',
            label: 'Days',
            type: 'weekdays',
            required: false,
            help: 'Leave every day unticked to reserve the slot on all teaching days.',
        }, {
            key: 'blocks',
            label: 'Blocks',
            type: 'text',
            required: false,
            help: 'Block positions, comma separated, counting from 1 \u2014 e.g. 4 for the '
                + 'lunch block. Leave empty to reserve the WHOLE of the chosen days.',
        }],
        /*
         * `BlockedWindow` follows `Unavailability`'s convention: an empty axis
         * means EVERY value on that axis. Leaving `blocks` empty legitimately
         * means "reserve the whole day" (see its `help` text above), so only
         * BOTH axes empty is the misconfiguration: that reserves the entire
         * timetable as a HARD rule, not nothing, which is not a smaller
         * version of "protect a slot", it is a different and far more drastic
         * rule nobody asked for.
         */
        unsendableWhen: (params) => (
            parseWeekdayList(params.days).length > 0 || parseBlockPositions(params.blocks).length > 0
                ? undefined
                : {
                    code: 'EMPTY_PROTECTED_WINDOW',
                    message: 'No days and no blocks are set. An empty selection on both axes reserves the '
                        + 'ENTIRE timetable as protected, not nothing, which the solver cannot place anything '
                        + 'against.',
                    fixHint: 'Open Settings \u2192 Constraints \u2192 "Reserve a slot institution-wide" and select at '
                        + 'least one day or one block position.',
                }
        ),
    },

    {
        key: 'distributed_pattern_adherence',
        category: 'days',
        defaultEnabled: true,
        wireField: 'distributedPatternAdherence',
        label: 'Hold a weekly slot for spread-out courses',
        description:
            'Keep an offering marked \u201CSpread across the term\u201D in ONE weekly slot \u2014 '
            + 'Mondays at 10, every week \u2014 rather than letting each week land wherever '
            + 'it fits. Offerings not marked that way are untouched.',
        evaluator: 'solver',
        /*
         * WHICH OFFERINGS THIS PRICES IS NOT CONFIGURED HERE. It reads
         * `Offering.scheduling_pattern` per offering, so an offering nobody has
         * classified is untouched, which is EVERY offering until somebody sets
         * the field, and is why the assembly report counts them.
         *
         * That is the `lecturer_veto` shape this codebase already paid for: a
         * rule enabled by default, fed an empty list, looking healthy and unable
         * to fire. Here it is opt-in and reported rather than silent.
         *
         * Cost is the number of DISTINCT weekly slots used minus one, so it is
         * zero for a genuinely fixed slot and grows per extra slot regardless of
         * how many sessions land in each.
         */
        severity: 'SOFT',
        defaultWeight: 8,
        params: [],
    },

    {
        key: 'block_pattern_adherence',
        category: 'days',
        defaultEnabled: true,
        wireField: 'blockPatternAdherence',
        label: 'Keep intensive courses in one window',
        description:
            'Keep an offering marked \u201CConcentrated into a window\u201D inside a short run of '
            + 'weeks rather than trickling across the term. Offerings not marked that way '
            + 'are untouched.',
        evaluator: 'solver',
        /*
         * The mirror of `distributed_pattern_adherence`, and the two are not
         * alternatives: each only prices offerings carrying its own pattern, so
         * a tenant running both kinds of course enables both rules. An offering
         * left unclassified is untouched by either.
         *
         * Cost is the idle WEEKS between the offering's first and last placed
         * session, the same gap-counting shape as `compactness`, at week
         * granularity and keyed by offering.
         */
        severity: 'SOFT',
        defaultWeight: 8,
        params: [],
    },

    {
        key: 'lecturer_consistency',
        category: 'workload',
        defaultEnabled: true,
        wireField: 'lecturerConsistency',
        label: 'Keep an offering’s lecturer stable',
        description:
            'Once a lecturer holds one session of a recurring offering, they should hold '
            + 'the rest of it too, rather than switching week to week.',
        evaluator: 'solver',
        /*
         * The Lecturer half of `room_consistency`, buildable now that pool
         * selection (issue #61) and the evaluator itself both exist. Aggregate
         * over an entire Offering's Sessions across the whole term, priced
         * against `max(0, distinct_lecturers - required_lecturer_count)`; it
         * only ever fires for an Offering with a genuine lecturer POOL
         * (candidates > required), so an Offering with one fixed lecturer is
         * never charged for having exactly that one.
         */
        severity: 'SOFT',
        defaultWeight: 5,
        params: [],
    },

    {
        key: 'minimize_offering_day_split',
        category: 'days',
        wireField: 'minimizeOfferingDaySplit',
        label: 'Keep an offering’s day together',
        description:
            'Discourage a class’s sessions for one offering landing in two separate runs '
            + 'on the same day, with unrelated teaching wedged between them.',
        evaluator: 'solver',
        /*
         * NOT the same question `compactness` asks. A day packed solid with
         * OTHER offerings between two runs of this one has zero gaps and still
         * splits it: this counts non-contiguous runs of the SAME offering,
         * minus one, so a single run (including a lone session) costs nothing.
         */
        severity: 'SOFT',
        defaultWeight: 5,
        params: [],
    },

    {
        key: 'max_offering_sessions_per_day',
        category: 'days',
        // NOT `defaultEnabled: true`: `maxPerDay` below is `required` with
        // deliberately no default (a scheduling-policy figure, not a guess),
        // the same seeded-broken shape as `minimize_high_ranking_rooms` above.
        wireField: 'maxOfferingSessionsPerDay',
        label: 'Cap an offering’s sessions per day',
        description:
            '“Maths, 4x a week” means four different days unless a tenant says '
            + 'otherwise: caps how many of one offering’s sessions may land on the '
            + 'same day.',
        evaluator: 'solver',
        /*
         * A raw SESSION count, not blocks; not `gridRelative`, unlike its
         * per-Offering sibling below. Distinct from `max_daily_session_count`,
         * which caps a Group's or Person's WHOLE day across every offering.
         */
        severity: 'SOFT',
        defaultWeight: 5,
        params: [{
            key: 'maxPerDay',
            label: 'Sessions of this offering allowed per day',
            type: 'number',
            min: 1,
            required: true,
            help: 'No default: how many repeats of one offering belong on a single day is a '
                + 'scheduling-policy figure, not something to guess on a tenant’s behalf.',
        }],
    },

    {
        key: 'max_consecutive_offering_blocks',
        category: 'days',
        // NOT `defaultEnabled: true`: `maxConsecutive` below is `required`
        // with deliberately no default, the same seeded-broken shape as
        // `minimize_high_ranking_rooms` above.
        gridRelative: true,
        wireField: 'maxConsecutiveOfferingBlocks',
        label: 'Cap an offering’s blocks in a row',
        description:
            'Caps how many blocks of ONE offering may run back to back in a day: a triple '
            + 'lecture with no break, say.',
        evaluator: 'solver',
        /*
         * The Offering-scoped sibling of `max_consecutive_blocks`, which caps a
         * GROUP's or PERSON's unbroken run across every offering at once. This
         * one is about a single offering monopolising the day, so it carries no
         * scope selector: there is only one axis, the offering itself.
         */
        severity: 'SOFT',
        defaultWeight: 5,
        params: [{
            key: 'maxConsecutive',
            label: 'Blocks in a row before it counts',
            type: 'number',
            min: 1,
            required: true,
            help: 'No default, for the same reason the sessions-per-day cap above has none. '
                + 'In BLOCKS: how long a block is comes from your time grid.',
        }],
    },

    {
        key: 'max_daily_session_count',
        category: 'days',
        wireField: 'maxDailySessionCount',
        label: 'Cap sessions per day',
        description:
            'Caps a raw session COUNT per day for a group and/or a person: the volume '
            + 'sibling of “Cap how long a day runs” (elapsed time) and “Cap teaching '
            + 'without a break” (continuity). A day can satisfy both of those and still be '
            + 'overloaded, e.g. six sessions split three plus a gap plus three.',
        evaluator: 'solver',
        /*
         * A raw COUNT, not blocks; not `gridRelative`. Priced once the cap is
         * exceeded rather than refused, the same reasoning `max_weekly_teaching_load`
         * and ADR-0025 give: a hard cap on a count only fully known as
         * placements accumulate risks the same dead-end-construction problem.
         */
        severity: 'SOFT',
        defaultWeight: 5,
        params: [{
            key: 'scope',
            label: 'Whose day',
            type: 'select',
            required: true,
            default: 'BOTH',
            options: [
                { value: 'BOTH', label: 'Groups and people' },
                { value: 'GROUP', label: 'Groups only' },
                { value: 'PERSON', label: 'People only' },
            ],
            help: 'A group’s day and a person’s day are different sets: a lecturer '
                + 'teaching three cohorts has a day none of those cohorts can see.',
        }, {
            key: 'maxPerDay',
            label: 'Sessions allowed per day',
            type: 'number',
            min: 1,
            required: true,
            help: 'No default: a daily session cap is a scheduling-policy figure, not '
                + 'something to guess on a tenant’s behalf.',
        }],
    },

];

export function findConstraintType(key: string | undefined): ConstraintTypeDef | undefined {
    return CONSTRAINT_TYPES.find((type) => type.key === key);
}

/**
 * A constraint type as a human label, whichever of its three names arrives.
 *
 * The review screen renders two violation breakdowns side by side, keyed
 * differently: this app's evaluator by `detail.reason` (room_double_booked), the
 * catalogue by `key` (no_double_booking_room), the solver by proto constraint
 * (RoomDoubleBooking). Rendered raw, one panel showed a wire enum.
 *
 * The solver's names are DERIVED from `wireField` (`maxOnlineShare` →
 * `MaxOnlineShare`) rather than listed again, so a new type gets its label the
 * moment it gets a wire field.
 *
 * UNKNOWN KEYS ARE SPACED, NOT NAMED: a token this catalogue does not know
 * renders as itself, readably, never as a guessed label.
 */
const CONSTRAINT_LABEL_INDEX: Record<string, string> = (() => {
    const index: Record<string, string> = {};

    for (const type of CONSTRAINT_TYPES) {
        index[type.key] = type.label;

        if (type.wireField) {
            index[type.wireField.charAt(0).toUpperCase() + type.wireField.slice(1)] = type.label;
        }
    }

    /**
     * The app evaluator's own `reason` strings, which are not catalogue keys:
     * `violations.ts` writes them as the shape of the breach it found, one
     * reason covering two catalogue types (lecturer and attendee double-booking
     * both report `person_double_booked`). Mapped explicitly for that reason:
     * deriving them would have to pick one of the two types and would be wrong
     * half the time.
     */
    index.room_double_booked = 'Room double-booked';
    index.person_double_booked = 'Person double-booked';
    index.group_double_booked = 'Group double-booked';
    index.unknown = 'Reason not recorded';

    return index;
})();

export function constraintTypeLabel(type: string): string {
    const known = CONSTRAINT_LABEL_INDEX[type];

    if (known) {
        return known;
    }

    // Readable, and visibly not a label this catalogue vouches for.
    return type
        .replace(/[_-]+/g, ' ')
        .replace(/([a-z\d])([A-Z])/g, '$1 $2')
        .trim();
}

export const CONSTRAINT_TYPE_KEYS = CONSTRAINT_TYPES.map((type) => type.key);

/**
 * Guard against the drift this file exists to prevent: every type the evaluator
 * claims must be described here, and vice versa.
 *
 * Exported rather than run at import time so it can be asserted from a test or
 * a boot check without a module side effect. Returns the discrepancies instead
 * of a boolean, because "something is wrong" is not an actionable report.
 */
export function constraintCatalogueDrift(): { missingFromCatalogue: string[]; missingFromEvaluators: string[] } {
    const declared = new Set(CONSTRAINT_TYPE_KEYS);
    const evaluated = [
        ...STRUCTURAL_CONSTRAINT_TYPES, ...PER_SESSION_CONSTRAINT_TYPES,
        ...RELATION_CONSTRAINT_TYPES, ...SOLVER_RELATION_CONSTRAINT_TYPES,
        ...SOLVER_OWNED_CONSTRAINT_TYPES,
    ];

    return {
        missingFromCatalogue: evaluated.filter((key) => !declared.has(key)),
        missingFromEvaluators: CONSTRAINT_TYPE_KEYS.filter((key) => !evaluated.includes(key as never)),
    };
}

/**
 * Params a type requires but this constraint row does not supply.
 *
 * Drives skip-and-report: a constraint missing a required parameter is NOT sent
 * with an invented default. A default here would be a rule the tenant never
 * chose, enforced by a solver, reported to nobody: the exact shape of failure
 * this codebase keeps designing against.
 *
 * `0` and `false` are legitimate values, so emptiness is tested explicitly
 * rather than by falsiness: `rankThreshold: 0` means "penalize every room",
 * which is a real policy and must not read as unset.
 */
export function missingConstraintParams(
    type: ConstraintTypeDef,
    params: Record<string, unknown> | null | undefined,
): string[] {
    const supplied = params ?? {};

    return type.params
        .filter((param) => param.required)
        .filter((param) => {
            const value = supplied[param.key];

            if (value === undefined || value === null || value === '') {
                return true;
            }

            // An empty weekday list is "avoid no days", indistinguishable from
            // not having answered, and meaningless as a constraint either way.
            return param.type === 'weekdays' && Array.isArray(value) && value.length === 0;
        })
        .map((param) => param.key);
}

/**
 * One reason an ENABLED constraint cannot be sent to the solver as it is
 * currently configured, aimed at a person rather than at a log.
 *
 * `code` is stable and machine-matchable (e.g. for a test); `message` and
 * `fixHint` are prose, never solver jargon, and always name the specific
 * constraint via `constraintName`, never "a constraint" or "your rules".
 */
export interface ConstraintIssue {
    constraintId: string;
    constraintName: string;
    constraintType: string;
    severity: 'HARD' | 'SOFT';
    code: string;
    message: string;
    fixHint: string;
}

/**
 * Would this constraint, as stored, make a solver run fail or be silently
 * dropped — checked BEFORE spending a gRPC round-trip and a `solver_run` row
 * on it, not after.
 *
 * DELIBERATELY NARROWER than `toWireConstraint`'s skip logic. Most of what
 * that function skips is ordinary NARROWING a tenant chose on purpose (a rule
 * scoped to a different TimeGrid, an offering-scoped rule the wire cannot
 * express): skipping those is the correct, silent behaviour and this function
 * says nothing about them. What it catches is the other kind: a configuration
 * that cannot function AT ALL, which used to reach the solver and come back
 * as an opaque `INVALID_ARGUMENT` 68ms after the run started, indistinguishable
 * from a broken button. Every check here mirrors one `toWireConstraint` also
 * makes (`missingConstraintParams`, `unsendableWhen`), so the two can never
 * disagree about what "cannot be sent" means; this only adds WHEN the check
 * runs and WHO it is shown to.
 *
 * Default to "no params required": ~24 of 32 currently-enabled catalogue types
 * take no params at all and are legitimately parameterless
 * (`no_double_booking_room`, `group_veto`, `exact_frequency_per_offering`, …).
 * A type only appears here when the catalogue itself says it needs something,
 * never by guessing from its shape.
 */
export function validateConstraint(row: {
    id: string;
    name: string;
    type: string;
    /** The row's OWN stored severity; falls back to it only when the catalogue leaves severity open. */
    severity?: string | null;
    params?: unknown;
}): ConstraintIssue[] {
    const type = findConstraintType(row.type);

    if (!type) {
        return [{
            constraintId: row.id,
            constraintName: row.name,
            constraintType: row.type,
            severity: row.severity === 'SOFT' ? 'SOFT' : 'HARD',
            code: 'UNKNOWN_TYPE',
            message: `'${row.name}' has type '${row.type}', which is not in the constraint catalogue `
                + '(shared/constraintTypes.ts). It cannot be evaluated or sent to the solver.',
            fixHint: 'Delete this rule, or recreate it as a type this version of the app knows about.',
        }];
    }

    const severity: 'HARD' | 'SOFT' = type.severity ?? (row.severity === 'SOFT' ? 'SOFT' : 'HARD');
    const params = (row.params && typeof row.params === 'object' ? row.params : {}) as Record<string, unknown>;
    const issues: ConstraintIssue[] = [];

    const missing = missingConstraintParams(type, params);

    if (missing.length) {
        const labels = missing.map((key) => type.params.find((p) => p.key === key)?.label ?? key);

        issues.push({
            constraintId: row.id,
            constraintName: row.name,
            constraintType: type.key,
            severity,
            code: 'MISSING_REQUIRED_PARAM',
            message: `'${row.name}' is missing required value(s): ${labels.join(', ')}.`,
            fixHint: `Open Settings → Constraints → '${row.name}' and set: ${labels.join(', ')}.`,
        });
    }

    const unsendable = type.unsendableWhen?.(params);

    if (unsendable) {
        issues.push({
            constraintId: row.id,
            constraintName: row.name,
            constraintType: type.key,
            severity,
            code: unsendable.code,
            message: `'${row.name}': ${unsendable.message}`,
            fixHint: unsendable.fixHint,
        });
    }

    return issues;
}

/**
 * Does this row's stored severity contradict the catalogue?
 *
 * The catalogue pins severity per type because the severity IS the meaning, but
 * the generic CRUD API accepts whatever it is given, so a row can exist saying
 * `no_double_booking_room` is SOFT. The wire has no severity field at all (the
 * TYPE determines hard/soft), so such a row is sent as its true severity and any
 * weight is ignored. Reported rather than silently normalised.
 */
export function severityMismatch(
    type: ConstraintTypeDef,
    storedSeverity: string,
): { expected: string; stored: string } | null {
    if (!type.severity || type.severity === storedSeverity) {
        return null;
    }

    return { expected: type.severity, stored: storedSeverity };
}

/** One thing wrong with a proposed constraint row, named by the field it is about. */
export interface ConstraintShapeProblem {
    /*
     * `scopes` is a real form control on the builder (the kind checkboxes) even
     * though it is a child collection rather than a column, so an issue about it
     * lands on something the user can see, unlike `params`, which is why the
     * `paramKey` escape below exists.
     */
    field: 'type' | 'severity' | 'weight' | 'params' | 'scopes' | 'members';
    /**
     * Which PARAMETER, when `field` is `'params'`.
     *
     * Carried separately so a call site can put the issue on the offending
     * CONTROL. `params` is a single `custom` column that the rule builder renders
     * as many controls, so an issue reported against `'params'` itself sets
     * `fieldErrors.params` on a field nothing displays: the save fails, the
     * banner says "some fields need attention", and nothing is marked. That is
     * the least diagnosable outcome a form has, and it is the reason this exists
     * rather than the field name alone.
     */
    paramKey?: string;
    message: string;
}

/**
 * A parameter value as a number, by the SAME coercion the wire mapper uses.
 *
 * `buildVariant` reads these with `Number(...)`, so a numeric STRING is a value
 * that works end to end today. Rejecting one here would be exactly the
 * builder-stricter-than-API divergence that produced the weight gap: the
 * validator would refuse a configuration the solver accepts. What is rejected is
 * what `Number()` cannot turn into a usable figure: `NaN` and the infinities.
 *
 * `null` is returned for "not a number", never for a legitimate 0.
 */
function numericParamValue(value: unknown): number | null {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null;
    }

    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value);

        return Number.isFinite(parsed) ? parsed : null;
    }

    return null;
}

/**
 * Is this value one the catalogue's declaration for `param` allows?
 *
 * DRIVEN ENTIRELY BY THE DECLARATION (`type`, `min`, `max`, `options`), so a
 * parameter added to the catalogue is validated the moment it is declared, with
 * no second list to keep in step. That is the same reason `wireField` is data
 * rather than a switch in the mapper.
 *
 * Each branch below closes a way a stored value reaches the solver as something
 * other than what it says, all of them observed in `buildVariant`:
 *
 * - `weekdays` is cast `as number[]` and immediately `.map`ped. A non-array
 *   there does not disable the rule, it THROWS during assembly and fails the
 *   whole run, every other constraint included.
 * - `number`/`percent` go through `Number()`, so `"abc"` becomes `NaN`, encodes
 *   as a NaN double, and every comparison against it is false. The rule is
 *   silently inert, which looks identical to a rule that is being satisfied.
 * - `boolean` goes through `Boolean()`, where the STRING `"false"` is `true`.
 *   A stored `"false"` therefore means its own opposite.
 * - `select` is compared against one literal (`params.window ===
 *   'SHARE_WINDOW_PER_WEEK' ? 2 : 1`), so any typo silently selects the other
 *   branch: a guard that cannot distinguish "per term" from "matched nothing".
 */
function paramProblem(param: ConstraintParamDef, value: unknown): string | null {
    switch (param.type) {
        case 'number':
        case 'percent': {
            const parsed = numericParamValue(value);

            if (parsed === null) {
                return `'${param.label}' must be a number.`;
            }

            if (param.min !== undefined && parsed < param.min) {
                return `'${param.label}' must be at least ${param.min}.`;
            }

            if (param.max !== undefined && parsed > param.max) {
                return `'${param.label}' must be at most ${param.max}.`;
            }

            return null;
        }

        case 'boolean':
            // A real boolean, not anything truthy: `Boolean('false')` is `true`.
            return typeof value === 'boolean'
                ? null
                : `'${param.label}' must be true or false.`;

        case 'text':
            // A number is fine (the mapper stringifies), but an object becomes
            // the literal '[object Object]' and is parsed as zero positions.
            return typeof value === 'string' || typeof value === 'number'
                ? null
                : `'${param.label}' must be text.`;

        case 'select': {
            const allowed = (param.options ?? []).map((option) => option.value);

            return allowed.includes(String(value))
                ? null
                : `'${param.label}' must be one of: ${allowed.join(', ')}.`;
        }

        case 'weekdays': {
            if (!Array.isArray(value)) {
                return `'${param.label}' must be a list of weekdays.`;
            }

            const rejected = value.filter((day) => {
                const parsed = numericParamValue(day);

                return parsed === null || !Number.isInteger(parsed) || parsed < 1 || parsed > 7;
            });

            return rejected.length
                ? `'${param.label}' takes ISO weekdays 1-7 (1 = Monday). `
                    + `Not a weekday: ${rejected.map((day) => JSON.stringify(day)).join(', ')}.`
                : null;
        }
    }
}

/**
 * Write-boundary validation for a constraint row: the rules the catalogue knows
 * and the generic CRUD schema cannot express.
 *
 * One function for all of them, because severity-contradicts-the-catalogue,
 * weight-is-negative and a-parameter-is-not-what-it-claims are checked from two
 * places with different information: three rules times two call sites is six
 * chances to drift.
 *
 * ABSENT MEANS UNCHECKED, deliberately: validating the MERGED row on update would
 * make an existing bad row UNEDITABLE, refusing the very person trying to disable
 * it. Checking only what is being changed means a legacy row can always be
 * repaired while no new bad value gets in.
 *
 * `null` weight is NOT absent; it is the explicit "this is HARD" value, and the
 * HARD ⇄ NULL pairing is the database CHECK's job.
 */
export function validateConstraintShape(input: {
    /** The row's type. On update this is the STORED value; `type` is create-only. */
    type: string | undefined;
    severity?: string | null;
    weight?: number | null;
    /**
     * The row's parameters, as the generic schema accepts them: arbitrary JSON.
     *
     * Whole-object, never a patch: `params` is written wholesale by the rule
     * builder, so validating what arrives IS validating the resulting row for
     * every key the catalogue declares.
     */
    params?: Record<string, unknown> | null;
    /**
     * How many kind scopes the write carries. `undefined` means the write does
     * not touch scopes at all, which is not the same as zero.
     */
    scopeCount?: number;
    /**
     * How many `ConstraintRelationMember` rows the write carries. `undefined`
     * means the write does not touch members at all, same absent-vs-zero
     * distinction as `scopeCount`, and for the same reason: a legacy row
     * missing this must stay editable for fields it is not touching.
     */
    memberCount?: number;
}): ConstraintShapeProblem[] {
    const problems: ConstraintShapeProblem[] = [];
    const type = findConstraintType(input.type);

    if (input.type !== undefined && !type) {
        problems.push({
            field: 'type',
            message: `Unknown constraint type '${input.type}'. Expected one of: ${CONSTRAINT_TYPE_KEYS.join(', ')}.`,
        });
    }

    /**
     * A DERIVED TYPE CANNOT BE SCOPED BY HAND, and storing a scope it ignores is
     * worse than refusing one.
     *
     * `toWireConstraint` reads `appliesToKindType` and never looks at
     * `ConstraintScope` for these, so a stored scope would sit in the database
     * looking like configuration, show in any list that renders scopes, and
     * change nothing. That is the shape this file already refuses in three other
     * places: a setting that cannot fail and cannot act.
     *
     * Refused rather than dropped on save, because dropping is the same silence
     * one step earlier: the tenant would see their choice vanish with no reason
     * given.
     */
    if (type?.appliesToKindType && (input.scopeCount ?? 0) > 0) {
        problems.push({
            field: 'scopes',
            message: `'${type.key}' is not scoped by hand: it applies to every session kind `
                + `whose type is ${type.appliesToKindType}. Change a session kind's type `
                + 'instead, and the rule follows it.',
        });
    }

    /**
     * A RELATION TYPE IS NOT KIND-SCOPED EITHER, and for the same reason as
     * above: `assembleSolverInput` never calls `toWireConstraint` for these
     * (see its relation carve-out), so a stored `ConstraintScope` row would
     * sit in the database looking like configuration and change nothing. The
     * rule's whole scope IS its named Offerings.
     */
    if (type?.relation && (input.scopeCount ?? 0) > 0) {
        problems.push({
            field: 'scopes',
            message: `'${type.key}' is not scoped by session kind: it relates the specific `
                + 'offerings named below, and applies to their sessions regardless of kind.',
        });
    }

    /**
     * A RELATION TYPE'S OPERANDS ARE ITS WHOLE CONFIGURATION: there is no
     * default to fall back to (`defaultConstraintTypes()` excludes these), so
     * naming fewer than `minMembers` Offerings is not a smaller version of the
     * rule, it is a rule that names no relationship at all.
     *
     * `undefined` skips this, same as every other field here: a write that
     * does not touch `members` must not fail because of what a DIFFERENT edit
     * (renaming, disabling) leaves alone.
     */
    if (type?.relation && input.memberCount !== undefined && input.memberCount < type.relation.minMembers) {
        problems.push({
            field: 'members',
            message: `'${type.key}' needs at least ${type.relation.minMembers} offerings named: `
                + `it relates them to each other, and ${input.memberCount} names no relationship.`,
        });
    }

    /**
     * The catalogue pins severity per type because the severity IS the meaning
     * (TAXONOMY.md §7); a double-booked room is not a preference. `null` means
     * the tenant genuinely chooses, and then anything is fine.
     *
     * Shares `severityMismatch()` with `assembleSolverInput`'s reporting, so the
     * guard at the write boundary and the safety net at solve time cannot
     * disagree about what a mismatch is.
     */
    if (type && input.severity !== undefined && input.severity !== null) {
        const mismatch = severityMismatch(type, input.severity);

        if (mismatch) {
            problems.push({
                field: 'severity',
                message: `'${type.key}' is always ${mismatch.expected}; it cannot be stored as ${mismatch.stored}. `
                    + `${type.label}: ${type.description}`,
            });
        }
    }

    /**
     * `>= 0`, matching calendry-solver's own check (convert.rs::soft_instance)
     * rather than the builder's input attribute. ZERO IS LEGAL and means
     * "evaluate this and report the count, but do not steer the search"; a
     * floor of 1 would reject a configuration the solver accepts, which is the
     * builder-stricter-than-API divergence that produced this gap.
     *
     * Negative is refused for two reasons. Every soft type declares "minimize",
     * so a negative weight inverts a rule into a maximize it never declared;
     * and because the solver derives `hard_penalty = sum(weights) * placements
     * + 1`, a negative weight erodes the margin that keeps hard constraints
     * dominant for EVERY rule in the tenant, not just this one.
     */
    if (input.weight !== undefined && input.weight !== null && input.weight < 0) {
        problems.push({
            field: 'weight',
            message: 'Penalty weight cannot be negative. Weights are relative to your other enabled '
                + 'soft rules, and a negative one would invert this rule into a preference FOR what it '
                + 'is meant to avoid. Use 0 to evaluate and report the rule without steering the schedule.',
        });
    }

    /**
     * PARAMETERS, each against its own catalogue declaration.
     *
     * TWO THINGS THIS DELIBERATELY DOES NOT DO, and both are the difference
     * between closing a gap and breaking the screen that repairs one.
     *
     * It does not check REQUIREDNESS. `missingConstraintParams()` asks that
     * question at SOLVE time, where the answer is a reported skip for one rule
     * rather than a refused save, and a rule someone is still configuring, or
     * has deliberately left disabled, must stay saveable. Duplicating it here
     * would mean a half-filled draft could not be written down, and the two
     * copies could disagree about what "set" means (an empty weekday list is
     * the case that already differs).
     *
     * It does not reject UNKNOWN keys. The builder spreads the stored object on
     * every edit, so a key left behind by a parameter the catalogue no longer
     * declares travels with the row, and refusing it would make exactly the
     * legacy rows that need repairing unrepairable, which is the trap the note
     * above this function is about. A stale key is inert: `buildVariant` reads
     * by name. A MISTYPED key is not silent either, because the parameter it
     * should have been is then unset, and every parameter the mapper reads
     * unsafely is `required`, so `missingConstraintParams` names it and the
     * rule is skipped with a reason rather than sent as nonsense.
     */
    if (type && input.params !== undefined && input.params !== null) {
        for (const param of type.params) {
            const value = input.params[param.key];

            // UNSET, not invalid: see above. `''` counts as unset because that
            // is what a cleared control sends, and it is what
            // `missingConstraintParams` already treats as unanswered.
            if (value === undefined || value === null || value === '') {
                continue;
            }

            const message = paramProblem(param, value);

            if (message) {
                problems.push({ field: 'params', paramKey: param.key, message });
            }
        }
    }

    return problems;
}

/**
 * The catalogue types a tenant should hold a DEFAULT row for.
 *
 * DEPRECATED TYPES ARE EXCLUDED, and that is the whole reason this is a
 * function rather than `CONSTRAINT_TYPES` itself. A deprecated entry stays in
 * the catalogue so existing rows of that type remain renderable (see
 * `deprecatedBy`), but seeding a fresh default row for one would resurrect it
 * as a first-class option in a UI whose entire premise is "every row here is a
 * rule you can use". `minimize_first_block` and `minimize_last_block` are both
 * superseded by `minimize_block_usage`.
 *
 * RELATION TYPES ARE EXCLUDED TOO, for a different reason: there is no
 * membership a seed could choose on a tenant's behalf. Every other type here
 * means something with zero configuration beyond severity/weight; a
 * `different_time` row with no `ConstraintRelationMember` rows names no
 * relationship at all (ADR-0028 in calendry-solver: "the first constraint
 * whose operands are chosen by the tenant in the constraint itself").
 */
export function defaultConstraintTypes(): ConstraintTypeDef[] {
    return CONSTRAINT_TYPES.filter((type) => !type.deprecatedBy && !type.relation);
}

/**
 * The row a tenant's default for `type` should be created with.
 *
 * STRUCTURAL AND PER-SESSION RULES ARE ALWAYS ENABLED: those are evaluated by
 * THIS app and produce the double-booking warnings a user expects without
 * configuring anything. Every other type is enabled by default only when its
 * catalogue entry says `defaultEnabled: true`, a per-type opt-in, tuned to
 * match what a real tenant (`test`) actually runs, not a blanket flip. A type
 * with no opinion here stays OFF: `backfill:constraints --all-missing` seeds
 * missing rows for EXISTING tenants too, so a brand-new solver-steering type
 * with no explicit `defaultEnabled` must never come back on for everyone the
 * moment it is backfilled.
 *
 * A disabled row is not a dormant rule; it is a rule the tenant can see and
 * switch on.
 */
export function defaultConstraintRow(type: ConstraintTypeDef): {
    type: string;
    name: string;
    severity: 'HARD' | 'SOFT';
    weight: number | null;
    isEnabled: boolean;
    isDefault: true;
    params: Record<string, number | string | boolean>;
} {
    // `severity: null` means the tenant chooses; HARD is the safe reading,
    // since a rule that turns out to be a preference is a weaker claim than one
    // that turns out to be a defect.
    const severity = type.severity ?? 'HARD';

    if (severity === 'SOFT' && type.defaultWeight === undefined) {
        // Loud rather than a silent 0: a SOFT type with no default weight would
        // otherwise be seeded at "evaluate but do not steer", which reads as a
        // deliberate choice and is actually a missing catalogue entry.
        throw new Error(`Constraint type '${type.key}' is SOFT but declares no defaultWeight.`);
    }

    return {
        type: type.key,
        name: type.label,
        severity,
        weight: severity === 'SOFT' ? type.defaultWeight! : null,
        /*
         * PER_SESSION types are ALSO enabled by default alongside the
         * pairwise structural ones: both are purely informational reports a
         * tenant benefits from seeing from day one, neither can make a term
         * infeasible, and both are enabled the same way every existing
         * structural default row already is.
         */
        isEnabled: STRUCTURAL_CONSTRAINT_TYPES.includes(type.key as never)
            || PER_SESSION_CONSTRAINT_TYPES.includes(type.key as never)
            || type.defaultEnabled === true,
        isDefault: true,
        params: Object.fromEntries(
            type.params
                .filter((param): param is typeof param & { default: number | string | boolean } => (
                    param.default !== undefined
                ))
                .map((param) => [param.key, param.default]),
        ),
    };
}
