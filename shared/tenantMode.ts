/**
 * Tenant mode (issue #8): a default-behaviour bias between "school" and
 * "university" framing, never a fork of the taxonomy.
 *
 * TAXONOMY.md's entity model does not branch on this — an Offering is the
 * same row shape either way. What changes is presentation only: which
 * Offering-form fields lead and which constraint types the catalogue
 * suggests first. A school's "Maths, 4 lessons a week, Mr Schmidt" and a
 * university's "an offering with a required session count and a lecturer
 * pool" describe the SAME stored fields (title, frequency, a required role);
 * the difference is which of them a form puts in front of you first.
 *
 * The classification lists below are a product-taste call, kept conservative
 * and reversible: nothing here removes a field or a rule from either mode,
 * and both are always fully reachable. See the callers for exactly what
 * "de-emphasised" and "suggested later" mean in each surface.
 */

export const TENANT_MODES = ['UNIVERSITY', 'SCHOOL'] as const;

export type TenantMode = (typeof TENANT_MODES)[number];

/** What every tenant before this field existed already behaved as. */
export const DEFAULT_TENANT_MODE: TenantMode = 'UNIVERSITY';

export function isTenantMode(value: unknown): value is TenantMode {
    return typeof value === 'string' && (TENANT_MODES as readonly string[]).includes(value);
}

/**
 * Offering fields a school does not lead with.
 *
 * A school names a concrete shape — a subject, a weekly count, a named
 * teacher assigned directly on the `lecturers` relation — rather than the
 * more abstract university vocabulary these fields carry: a course CODE
 * distinct from its title, a scheduling PATTERN chosen instead of assumed
 * weekly, a required ROLE used to filter a pool of possible lecturers rather
 * than naming one, a required ROOM CAPACITY/COUNT reasoned about explicitly,
 * and ONLINE delivery, which a single-building school rarely has at all.
 *
 * `title`, `kindId`, `frequency` and `durationBlocks` stay primary in both
 * modes — they are exactly "Maths, 4 lessons a week" either way.
 */
const SCHOOL_DEEMPHASISED_OFFERING_FIELDS: ReadonlySet<string> = new Set([
    'code',
    'schedulingPattern',
    'requiredRoleId',
    'requiredCapacity',
    'requiredRoomCount',
    'allowOnline',
]);

export function offeringFieldsToDeemphasize(mode: TenantMode): ReadonlySet<string> {
    return mode === 'SCHOOL' ? SCHOOL_DEEMPHASISED_OFFERING_FIELDS : new Set();
}

/**
 * Constraint types whose value is concentrated in large, multi-building,
 * partly-online institutions: a big room inventory worth ranking and
 * economising on, and hybrid/online delivery worth weighing at all. A
 * school's single building and all-in-person model make these switches a
 * tenant can still enable, but not ones worth suggesting first.
 *
 * Basis for the split, stated so it can be argued with: everything NOT
 * listed here — the double-booking guards, exact frequency, vetoes,
 * block/day/compactness preferences, lecturer-preference fit, room-fits-
 * group-size — is exactly as relevant to a single-building school timetable
 * as to a university one, so it is never de-suggested.
 */
const UNIVERSITY_ORIENTED_CONSTRAINT_TYPES: ReadonlySet<string> = new Set([
    // Hybrid/online delivery: schools overwhelmingly do not schedule
    // virtual rooms at all, unlike a university with remote cohorts.
    'online_onsite_same_day_exclusion',
    'max_online_ratio_per_group',
    'minimize_online_sessions',
    'max_concurrent_online_sessions',
    // Large, ranked room inventories and cross-campus room churn are a
    // multi-building-campus concern; a school's one building has little of
    // either to optimise.
    'minimize_high_ranking_rooms',
    'minimize_room_churn',
    'minimize_capacity_waste',
    'room_turnaround_buffer',
    'room_consistency',
]);

export function isConstraintTypeSuggested(typeKey: string, mode: TenantMode): boolean {
    return mode !== 'SCHOOL' || !UNIVERSITY_ORIENTED_CONSTRAINT_TYPES.has(typeKey);
}
