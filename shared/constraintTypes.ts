/**
 * The constraint-type library (TAXONOMY.md §7).
 *
 * WHY `shared/` AND NOT server/utils OR app/utils
 * -----------------------------------------------
 * Two consumers need the same list and must not drift:
 *
 *   server/utils/violations.ts   decides which types it can evaluate
 *   the rule builder UI          decides which types a tenant may configure
 *
 * If the UI's list ever gained a type the evaluator does not know, a tenant
 * could configure a rule that is silently never checked — a constraint that
 * exists, is enabled, shows no violations, and means nothing. Reading one
 * declaration from both sides makes that unrepresentable rather than merely
 * unlikely. `violations.ts` re-exports the two key lists so nothing else had to
 * change.
 *
 * NOT A DSL, BY DESIGN
 * --------------------
 * TAXONOMY.md §2: constraints are "predefined constraint types + parameters,
 * not a free-form expression DSL". A type here declares its parameters; the
 * builder renders exactly those. Adding a constraint type is a code change,
 * because a type with no evaluator is a promise nothing keeps.
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
 * Types owned by the solver service (TAXONOMY.md §7), which does not exist yet.
 * Listed so the boundary is explicit and a missing check is visibly deferred
 * rather than forgotten.
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
] as const;

export type SolverOwnedConstraintType = (typeof SOLVER_OWNED_CONSTRAINT_TYPES)[number];

/** Who decides whether a constraint is breached. */
export type ConstraintEvaluator =
    /** This application, synchronously, on every manual edit. */
    | 'app'
    /** The Rust solver service. Not implemented — configurable but inert. */
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
    | 'minimizeBlockUsage';

export interface ConstraintTypeDef {
    key: string;
    /** Which `ConstraintConfig` field this becomes on the wire. */
    wireField: WireConstraintField;
    label: string;
    /** One sentence, in the tenant's language rather than the schema's. */
    description: string;
    evaluator: ConstraintEvaluator;
    /**
     * HARD when a breach is a defect, SOFT when it is a preference with a
     * penalty weight. `null` means the tenant chooses.
     *
     * Fixed for most types because the severity IS the meaning: a room being
     * double-booked is not a preference, and "minimize Saturday" is not a
     * defect. The database CHECK enforces the HARD⇄no-weight, SOFT⇄weight
     * pairing regardless of what the UI offers.
     *
     * On the SOFT side, note that the weight a tenant attaches is RELATIVE and
     * has no absolute scale — the solver derives its hard-violation penalty as
     * `sum(all soft weights) * placements + 1`, so only ratios between enabled
     * soft rules carry meaning, and no magnitude lets a soft rule outrank a
     * hard one. Deliberately unbounded above; see the long note on
     * `RESOURCES.constraints.weight` in server/utils/resources.ts.
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
        key: 'online_onsite_same_day_exclusion',
        wireField: 'onlineOnsiteSameDay',
        label: 'No mixing online and on-site in a day',
        description: 'A group is not asked to be on campus and online on the same day.',
        evaluator: 'solver',
        severity: 'HARD',
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
        label: 'Spare the best rooms',
        description: 'Prefer lower-ranked rooms, keeping premium ones free.',
        evaluator: 'solver',
        severity: 'SOFT',
        defaultWeight: 3,
        params: [{
            key: 'rankThreshold',
            label: 'Penalize rooms ranked at or above',
            type: 'number',
            min: 0,
            required: true,
            help: 'Room.ranking is ordered HIGHER = more premium. No default: "premium" is per-institution.',
        }],
    },
    {
        key: 'minimize_exam_week_sessions',
        wireField: 'minimizeExamWeek',
        label: 'Keep exam weeks clear',
        description:
            'Prefer not to schedule during exam periods. Resolves against the academic '
            + 'calendar rather than assuming the last few weeks.',
        evaluator: 'solver',
        severity: 'SOFT',
        defaultWeight: 8,
        params: [],
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
];

export function findConstraintType(key: string | undefined): ConstraintTypeDef | undefined {
    return CONSTRAINT_TYPES.find((type) => type.key === key);
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
    field: 'type' | 'severity' | 'weight';
    message: string;
}

/**
 * Write-boundary validation for a constraint row: the two rules the catalogue
 * knows and the generic CRUD schema cannot express by itself.
 *
 * WHY ONE FUNCTION FOR TWO RULES
 * ------------------------------
 * Severity-contradicts-the-catalogue and weight-is-negative are the same
 * category of gap — the rule builder honours a constraint the API does not — and
 * they are checked from two different places (a zod refinement on create, the
 * `beforeUpdate` hook on update, which have different information available).
 * Two rules times two call sites is four chances to drift; one function called
 * twice is none.
 *
 * ABSENT MEANS UNCHECKED, AND THAT IS THE POINT
 * ---------------------------------------------
 * `severity` and `weight` are only examined when they are `undefined`-free, so a
 * caller passes exactly the fields it is actually setting. On create that is
 * everything; on update it is whatever the PATCH contains.
 *
 * That asymmetry is deliberate and load-bearing. Validating the MERGED row on
 * update would make an existing bad row **uneditable** — someone trying to
 * disable the very row the guard is protecting them from would be refused by
 * the guard. That is not hypothetical: CLAUDE.md records a mislabelled
 * constraint that "could never be corrected by editing — only deleted and
 * recreated", because `type` is create-only. Checking only what is being
 * changed means a legacy row can always be renamed, disabled, or repaired,
 * while no new bad value gets in.
 *
 * `null` weight is NOT absent: it is the explicit "this is HARD, it has no
 * weight" value, and passes because the HARD ⇄ NULL pairing is the database
 * CHECK's job, not this function's.
 */
export function validateConstraintShape(input: {
    /** The row's type. On update this is the STORED value — `type` is create-only. */
    type: string | undefined;
    severity?: string | null;
    weight?: number | null;
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
 * ENABLED-BY-DEFAULT IS LIMITED TO THE STRUCTURAL RULES, deliberately:
 *
 *  - the four structural types are evaluated by THIS app
 *    (`refreshViolations`), and they are what produces the double-booking
 *    warnings a user expects to see without configuring anything. Three of them
 *    were already enabled by `provision-tenant.ts`, so this is parity plus
 *    `no_double_booking_person`, which had been unreachable.
 *  - the other nine steer the SOLVER. Enabling them on upgrade would silently
 *    change the timetable every existing tenant gets from their next run, which
 *    is not a change a backfill script is entitled to make on their behalf.
 *
 * A disabled row is not a dormant rule — it is a rule the tenant can see and
 * switch on. That distinction is the point of the whole default-row model.
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
