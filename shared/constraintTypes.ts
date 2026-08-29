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
    const evaluated = [...STRUCTURAL_CONSTRAINT_TYPES, ...SOLVER_OWNED_CONSTRAINT_TYPES];

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
    field: 'type' | 'severity' | 'weight' | 'params';
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
        isEnabled: STRUCTURAL_CONSTRAINT_TYPES.includes(type.key as never),
        isDefault: true,
        params: Object.fromEntries(
            type.params
                .filter((param) => param.default !== undefined)
                .map((param) => [param.key, param.default]),
        ),
    };
}
