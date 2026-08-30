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
 * App-decided, but PER SESSION rather than pairwise — a fact about one
 * placement and the TimeGrid it sits in, needing no counterpart Session to
 * compare against.
 *
 * A SEPARATE LIST FROM `STRUCTURAL_CONSTRAINT_TYPES`, not a fifth member of it,
 * because that list drives `describeCollision`'s dispatch, whose switch is
 * exhaustive over pairs — `(a, b)` — and has nowhere to put a check that only
 * ever looks at one Session. Folding this in would mean either a dead case
 * that never fires from the pairwise loop, or bending the pairwise loop to
 * also iterate seeds alone; `server/utils/violations.ts` runs this list as its
 * own pass instead.
 */
export const PER_SESSION_CONSTRAINT_TYPES = [
    'no_session_spanning_break',
] as const;

export type PerSessionConstraintType = (typeof PER_SESSION_CONSTRAINT_TYPES)[number];

/**
 * Types owned by the solver service (TAXONOMY.md §7) — evaluated at generation
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
] as const;

export type SolverOwnedConstraintType = (typeof SOLVER_OWNED_CONSTRAINT_TYPES)[number];

/** Who decides whether a constraint is breached. */
export type ConstraintEvaluator =
    /** This application, synchronously, on every manual edit. */
    | 'app'
    /**
     * The Rust solver service, at generation time — as opposed to `'app'`, which
     * evaluates synchronously on every manual edit.
     *
     * This said "Not implemented — configurable but inert", which had been stale
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
    | 'compactness';

export interface ConstraintTypeDef {
    key: string;
    /**
     * Which `ConstraintConfig` field this becomes on the wire.
     *
     * OPTIONAL for one situation: a catalogue entry landing before the proto field
     * that carries it. Naming a field that does not exist would not fail —
     * `toWireConstraint` casts and ts-proto writes only fields it knows — so the
     * constraint would be dropped from the request with nothing reporting it.
     * A type with no `wireField` is SKIPPED and named in the assembly report.
     *
     * NO TYPE USES THIS TODAY — `person_preference_fit` was the last one, and it
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
     * A SOFT weight is RELATIVE and unbounded above — see the note on
     * `RESOURCES.constraints.weight`.
     */
    severity: 'HARD' | 'SOFT' | null;
    /**
     * Derive `applies_to_kinds` from the tenant's Session kinds CLASSIFIED this
     * way, instead of from the rule's own `ConstraintScope` rows.
     *
     * For a rule that is only meaningful about one class of session. "No two
     * exams for a group in a day" is not a rule a tenant should be able to aim
     * at lectures by accident, and under manual scoping the accident had a
     * particularly bad shape: `applies_to_kinds` EMPTY MEANS EVERY KIND on the
     * wire, so forgetting to scope such a rule did not disable it — it widened
     * it to every session in the institution, live, on the next solve.
     *
     * A DECLARATION, NOT A DEFAULT. `toWireConstraint` ignores `ConstraintScope`
     * entirely for these types, the write boundary refuses to store one, and the
     * builder shows no kind picker. Two sources for one answer is what let two
     * exam rules disagree about which kind was the exam kind.
     *
     * AN EMPTY DERIVED SET IS A SKIP, NEVER AN EMPTY LIST — see
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
     * type and NULL means every grid, which is right for most of them — "no
     * double-booking" means the same thing on any grid. This marks the ones
     * where a gap, a block count or a span is being compared against numbers
     * only one grid produces: a 45-minute grid's "three consecutive blocks" is
     * 135 minutes and a 60-minute grid's is 180.
     *
     * The builder surfaces the grid selector for these when the tenant has more
     * than one grid, and says nothing when it has one — a filter exists when it
     * has more than one option, never because a flag is set.
     */
    gridRelative?: boolean;
    /**
     * Weight a tenant's DEFAULT row is seeded with. Required for every SOFT
     * type and meaningless for HARD ones, because `constraint_weight_matches_severity`
     * demands SOFT rows carry a weight even while disabled — so "seed it
     * disabled with no weight" is not a representable state.
     *
     * These are a coherent RELATIVE scale, not calibrated magnitudes: only
     * ratios between enabled soft rules mean anything to the solver. A tenant
     * is expected to retune them; the point is that toggling a rule on does not
     * present an empty required input.
     */
    defaultWeight?: number;
    params: ConstraintParamDef[];
    /**
     * Set when a newer type supersedes this one.
     *
     * The entry STAYS in the catalogue. Removing it would make every existing
     * row of that type unrenderable, and `type` is `createOnly`, so a tenant
     * could not edit their way to the replacement either — they would be left
     * with a rule the UI cannot show and cannot fix. The builder hides these
     * from the "add a rule" picker while continuing to render the ones already
     * configured.
     */
    deprecatedBy?: string;
}

export const CONSTRAINT_TYPES: ConstraintTypeDef[] = [
    // ---- Structural, evaluated here -----------------------------------------
    {
        key: 'no_double_booking_room',
        wireField: 'roomDoubleBooking',
        label: 'No double-booked rooms',
        description: 'A room cannot host two sessions that overlap in the same week.',
        evaluator: 'app',
        severity: 'HARD',
        params: [],
    },
    {
        key: 'no_double_booking_lecturer',
        wireField: 'lecturerDoubleBooking',
        label: 'No double-booked people',
        description: 'Nobody can be assigned to two sessions that overlap.',
        evaluator: 'app',
        severity: 'HARD',
        params: [],
    },
    {
        key: 'no_double_booking_group',
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
        label: 'Report sessions spanning a break',
        description:
            'A session that starts before a named break and ends after it is drawn '
            + 'honestly on the grid and is entirely LEGAL — this only makes the fact '
            + 'queryable, so it can be listed, counted and reviewed rather than living '
            + 'only in the chip somebody happens to be looking at.',
        evaluator: 'app',
        severity: 'SOFT',
        /*
         * UNCALIBRATED, like `REPAIR_MOVEMENT_WEIGHT` — chosen to be visible in
         * a SOFT summary next to this tenant's other soft rules, not measured
         * against them. Meaningful even with no solver objective behind this
         * type: `refreshViolations` sets `penalty: weight` for every SOFT
         * violation regardless of which evaluator found it, and the review
         * screen sums penalties per type — the same mechanism a solver-priced
         * SOFT rule uses.
         *
         * NO WIRE FIELD, and that is not a gap to close casually: this is the
         * REPORTING half only (issue #27). The solver AVOIDING this shape is a
         * different, unbuilt card (issue #26) that needs the grid's break
         * structure on the wire at all, which today it deliberately is not
         * (CLAUDE.md, "TimeGrid breaks"). Enabling this type has no effect on
         * what the solver places — only on what a manual edit is reported as.
         */
        defaultWeight: 5,
        params: [],
    },

    // ---- Hard, solver-owned --------------------------------------------------
    {
        key: 'exact_frequency_per_offering',
        wireField: 'exactFrequency',
        label: 'Exact session count per offering',
        description: 'Each offering gets exactly the number of sessions it declares — no more, no fewer.',
        evaluator: 'solver',
        severity: 'HARD',
        params: [],
    },
    {
        key: 'lecturer_veto',
        wireField: 'lecturerVeto',
        label: 'Lecturer unavailability',
        description: 'Days or blocks an individual has blocked out.',
        evaluator: 'solver',
        severity: 'HARD',
        params: [],
    },
    {
        key: 'group_veto',
        wireField: 'groupVeto',
        label: 'Honour group availability windows',
        description:
            'A group is only scheduled inside the dates it is available in a term — '
            + 'for a cohort that runs the first half of a term, or joins late. '
            + 'Groups with no window set are available all term.',
        evaluator: 'solver',
        /*
         * Same architecture as `lecturer_veto`, which this is a twin of one
         * entity across: the WINDOWS live on the Group
         * (`group_term_availability`) and this row is the tenant-level switch.
         * Hence `params: []` — there is nothing to configure that is not either
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
         * `defaultWeight`, rather than seeding 0 — which the solver reads as
         * "count it, do not steer" and would look like a deliberate choice.
         * Pinned by tests/constraint-catalogue.test.ts.
         */
        defaultWeight: 5,
        params: [],
    },
    {
        key: 'max_online_ratio_per_group',
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
        gridRelative: true,
        wireField: 'minimizeFirstBlock',
        label: 'Avoid the first block',
        description: 'Prefer not to schedule in the earliest block of the day.',
        evaluator: 'solver',
        severity: 'SOFT',
        defaultWeight: 5,
        params: [],
        // Superseded by `minimize_block_usage`. Kept so tenants who already
        // configured it keep working — a catalogue entry that disappears turns
        // an existing row into an unrenderable one, and `type` is createOnly so
        // it could not be edited to the replacement either.
        deprecatedBy: 'minimize_block_usage',
    },
    {
        key: 'minimize_last_block',
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
    },
    {
        key: 'minimize_specifc_day',
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
            // hardcoded-Saturday assumption TAXONOMY.md §7 forbids — a tenant may
            // not teach Saturday at all, or may want a different day
            // deprioritized. Unset means the constraint is skipped, not guessed.
            help: 'No default: which days are undesirable is an institutional decision, not an assumption.',
        }],
    },
    {
        key: 'minimize_high_ranking_rooms',
        wireField: 'minimizeRoomRank',
        /*
         * Named for the AXIS, not for one direction along it.
         *
         * This was "Spare the best rooms", which is only half of what the rule
         * can now express — `invert` steers placement toward the premium rooms
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
             * default of false with a provisioning override — two defaults for one
             * field agree until something distinguishes them, and then the form
             * prefills one thing while provisioning writes another.
             *
             * EXISTING tenants are untouched: their stored params carry no
             * `invert` key, which reads as false. This governs new rows only.
             */
            default: true,
            help: 'Off — discourage rooms AT OR ABOVE the boundary, keeping premium rooms free. '
                + 'On — discourage rooms AT OR BELOW it, so lessons fill the better rooms first.',
        }],
    },
    {
        key: 'minimize_exam_week_sessions',
        wireField: 'minimizeExamWeek',
        /*
         * Named for the AXIS, not for one direction along it — the same
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
             * EXISTING rows are untouched either way — their stored params carry
             * no `invert` key, which `buildVariant` reads as false.
             */
            default: false,
            help: 'Off — discourage scheduling during exam periods, keeping them clear. '
                + 'On — discourage scheduling OUTSIDE them, so the sessions this rule '
                + 'applies to are drawn in. Turning this on usually means scoping the '
                + 'rule to your exam session kind; unscoped, it pulls everything in.',
        }],
    },
    {
        key: 'compactness',
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
            help: 'A group\'s day and a person\'s day are different sets — a lecturer teaching '
                + 'three cohorts has gaps none of those cohorts can see.',
        }],
    },
    {
        key: 'minimize_online_sessions',
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
        /*
         * CROSSES THE WIRE, and this line had to land in the same change as the
         * solver's evaluator — never before it.
         *
         * The proto has carried the field since 0.7.0, but until
         * `calendry-solver` 41f6227 its `convert.rs` answered this variant with
         * `Status::unimplemented`. That is a StartRun FAILURE, not a skipped
         * rule, so naming the field early would have taken a tenant who enabled
         * this from "the rule quietly does nothing" to "every solve fails
         * outright" — strictly worse than the state it replaced.
         * `per-person-preferences-design.md` § "Where `wireField` gets flipped"
         * has the three-row table.
         *
         * ONE COUPLING SURVIVES, and it is why `buildVariant` must keep
         * returning `{}` for this key: the solver REFUSES a non-empty `roles`
         * rather than approximating it, because empty means "lecturers only"
         * and widening the counted set would let a 200-student cohort's
         * aggregate preference outweigh the person teaching. An empty variant is
         * therefore not laziness — it is the only accepted value, and sending a
         * role would fail the run. See solver ADR-0026.
         */
        wireField: 'personPreferenceFit',
        label: 'Honour personal preferences',
        description:
            'Prefer the days and blocks a lecturer has said they would rather teach. '
            + 'Only lecturers\' preferences count, and a breach is never a defect — this '
            + 'competes with the other soft rules on weight alone.',
        evaluator: 'solver',
        /*
         * Same architecture as `lecturer_veto`, one severity down: the VALUES
         * live on the Person (`person_preference`), and this row is the
         * tenant-level switch plus how much the tenant cares. Hence `params:
         * []` — there is nothing to configure here that is not either the
         * weight or somebody's own stated preference.
         */
        severity: 'SOFT',
        defaultWeight: 5,
        params: [],
    },
    {
        key: 'group_size_fits_room',
        wireField: 'groupSizeFitsRoom',
        label: 'Rooms must fit the groups actually attending',
        description:
            'Checks the room against the real size of the groups in the session, not just '
            + 'the minimum capacity recorded on the offering. Catches a room that fits the '
            + 'number somebody typed but not the cohort that turns up.',
        evaluator: 'solver',
        /*
         * HARD, and validation-shaped rather than a preference. It compares two
         * facts the wire already carries — `Group.size` against
         * `Room.capacity` — so a breach is a defect in the data or the
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
        key: 'room_consistency',
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
         * whichever session landed first — so the rule cannot be satisfied by
         * accident of ordering.
         */
        severity: 'SOFT',
        defaultWeight: 3,
        params: [],
    },

    {
        key: 'minimize_weekday_imbalance',
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
         * than pricing it — which is what ADR-0025 records as the reason the
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
         * A contract limit is still expressible — set the weight high enough to
         * dominate — and stays recoverable rather than making the term
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
        key: 'minimize_location_change',
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
         * uses, and CLAUDE.md forbids hardcoding a kind called "exam" — the
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
         * Monotone-safe like the four structural types — a protected slot is
         * never freed by placing something elsewhere — so the solver enforces it
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
    },

    {
        key: 'distributed_pattern_adherence',
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
         * classified is untouched — which is EVERY offering until somebody sets
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
         * session — the same gap-counting shape as `compactness`, at week
         * granularity and keyed by offering.
         */
        severity: 'SOFT',
        defaultWeight: 8,
        params: [],
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
     * The app evaluator's own `reason` strings, which are not catalogue keys —
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
        ...STRUCTURAL_CONSTRAINT_TYPES, ...PER_SESSION_CONSTRAINT_TYPES, ...SOLVER_OWNED_CONSTRAINT_TYPES,
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
 * chose, enforced by a solver, reported to nobody — the exact shape of failure
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

            // An empty weekday list is "avoid no days" — indistinguishable from
            // not having answered, and meaningless as a constraint either way.
            return param.type === 'weekdays' && Array.isArray(value) && value.length === 0;
        })
        .map((param) => param.key);
}

/**
 * Does this row's stored severity contradict the catalogue?
 *
 * The catalogue pins severity per type because the severity IS the meaning, but
 * the generic CRUD API accepts whatever it is given — so a row can exist saying
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
     * lands on something the user can see — unlike `params`, which is why the
     * `paramKey` escape below exists.
     */
    field: 'type' | 'severity' | 'weight' | 'params' | 'scopes';
    /**
     * Which PARAMETER, when `field` is `'params'`.
     *
     * Carried separately so a call site can put the issue on the offending
     * CONTROL. `params` is a single `custom` column that the rule builder renders
     * as many controls, so an issue reported against `'params'` itself sets
     * `fieldErrors.params` on a field nothing displays — the save fails, the
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
 * builder-stricter-than-API divergence that produced the weight gap — the
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
 * DRIVEN ENTIRELY BY THE DECLARATION — `type`, `min`, `max`, `options` — so a
 * parameter added to the catalogue is validated the moment it is declared, with
 * no second list to keep in step. That is the same reason `wireField` is data
 * rather than a switch in the mapper.
 *
 * Each branch below closes a way a stored value reaches the solver as something
 * other than what it says, all of them observed in `buildVariant`:
 *
 * - `weekdays` is cast `as number[]` and immediately `.map`ped. A non-array
 *   there does not disable the rule, it THROWS during assembly and fails the
 *   whole run — every other constraint included.
 * - `number`/`percent` go through `Number()`, so `"abc"` becomes `NaN`, encodes
 *   as a NaN double, and every comparison against it is false. The rule is
 *   silently inert, which looks identical to a rule that is being satisfied.
 * - `boolean` goes through `Boolean()`, where the STRING `"false"` is `true`.
 *   A stored `"false"` therefore means its own opposite.
 * - `select` is compared against one literal (`params.window ===
 *   'SHARE_WINDOW_PER_WEEK' ? 2 : 1`), so any typo silently selects the other
 *   branch — a guard that cannot distinguish "per term" from "matched nothing".
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
            // A number is fine — the mapper stringifies — but an object becomes
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
 * places with different information — three rules times two call sites is six
 * chances to drift.
 *
 * ABSENT MEANS UNCHECKED, deliberately: validating the MERGED row on update would
 * make an existing bad row UNEDITABLE, refusing the very person trying to disable
 * it. Checking only what is being changed means a legacy row can always be
 * repaired while no new bad value gets in.
 *
 * `null` weight is NOT absent — it is the explicit "this is HARD" value, and the
 * HARD ⇄ NULL pairing is the database CHECK's job.
 */
export function validateConstraintShape(input: {
    /** The row's type. On update this is the STORED value — `type` is create-only. */
    type: string | undefined;
    severity?: string | null;
    weight?: number | null;
    /**
     * The row's parameters, as the generic schema accepts them: arbitrary JSON.
     *
     * Whole-object, never a patch — `params` is written wholesale by the rule
     * builder — so validating what arrives IS validating the resulting row for
     * every key the catalogue declares.
     */
    params?: Record<string, unknown> | null;
    /**
     * How many kind scopes the write carries. `undefined` means the write does
     * not touch scopes at all, which is not the same as zero.
     */
    scopeCount?: number;
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
     * places — a setting that cannot fail and cannot act.
     *
     * Refused rather than dropped on save, because dropping is the same silence
     * one step earlier: the tenant would see their choice vanish with no reason
     * given.
     */
    if (type?.appliesToKindType && (input.scopeCount ?? 0) > 0) {
        problems.push({
            field: 'scopes',
            message: `'${type.key}' is not scoped by hand — it applies to every session kind `
                + `whose type is ${type.appliesToKindType}. Change a session kind's type `
                + 'instead, and the rule follows it.',
        });
    }

    /**
     * The catalogue pins severity per type because the severity IS the meaning
     * (TAXONOMY.md §7) — a double-booked room is not a preference. `null` means
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
                    + `${type.label} — ${type.description}`,
            });
        }
    }

    /**
     * `>= 0`, matching calendry-solver's own check (convert.rs::soft_instance)
     * rather than the builder's input attribute. ZERO IS LEGAL and means
     * "evaluate this and report the count, but do not steer the search" — a
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
     * rather than a refused save — and a rule someone is still configuring, or
     * has deliberately left disabled, must stay saveable. Duplicating it here
     * would mean a half-filled draft could not be written down, and the two
     * copies could disagree about what "set" means (an empty weekday list is
     * the case that already differs).
     *
     * It does not reject UNKNOWN keys. The builder spreads the stored object on
     * every edit, so a key left behind by a parameter the catalogue no longer
     * declares travels with the row — and refusing it would make exactly the
     * legacy rows that need repairing unrepairable, which is the trap the note
     * above this function is about. A stale key is inert: `buildVariant` reads
     * by name. A MISTYPED key is not silent either, because the parameter it
     * should have been is then unset, and every parameter the mapper reads
     * unsafely is `required` — so `missingConstraintParams` names it and the
     * rule is skipped with a reason rather than sent as nonsense.
     */
    if (type && input.params !== undefined && input.params !== null) {
        for (const param of type.params) {
            const value = input.params[param.key];

            // UNSET, not invalid — see above. `''` counts as unset because that
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
 */
export function defaultConstraintTypes(): ConstraintTypeDef[] {
    return CONSTRAINT_TYPES.filter((type) => !type.deprecatedBy);
}

/**
 * The row a tenant's default for `type` should be created with.
 *
 * ENABLED-BY-DEFAULT IS LIMITED TO THE STRUCTURAL RULES: those are evaluated by
 * THIS app and produce the double-booking warnings a user expects without
 * configuring anything. The other nine steer the SOLVER, and enabling them on
 * upgrade would silently change the timetable every existing tenant gets from
 * their next run.
 *
 * A disabled row is not a dormant rule — it is a rule the tenant can see and
 * switch on.
 */
export function defaultConstraintRow(type: ConstraintTypeDef): {
    type: string;
    name: string;
    severity: 'HARD' | 'SOFT';
    weight: number | null;
    isEnabled: boolean;
    isDefault: true;
    params: Record<string, unknown>;
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
            || PER_SESSION_CONSTRAINT_TYPES.includes(type.key as never),
        isDefault: true,
        params: Object.fromEntries(
            type.params
                .filter((param) => param.default !== undefined)
                .map((param) => [param.key, param.default]),
        ),
    };
}
