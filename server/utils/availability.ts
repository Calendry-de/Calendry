import { z } from 'zod';
import type { Tx } from './tenantDb';
import {
    WEIGHT_MULTIPLIER_MAX,
    WEIGHT_MULTIPLIER_MIN,
    isTotalBlackout,
    resolveHolidayWeeks,
    validateWindow,
} from '../../shared/availability';
import type { HolidayResolution, TermWindow, UnavailabilityWindow } from '../../shared/availability';
import { isoDate, isoWeekday, overlaps, weekCountOf } from '../../shared/academicCalendar';

/**
 * Reading and writing person availability.
 *
 * THE SOLVER READ PATH LIVES HERE AND NOWHERE ELSE: `approvedBlackoutsFor` is the
 * only function turning rows into wire blackouts, so there is exactly one place the
 * `status = APPROVED` filter can be wrong. A PENDING window reaching the wire would
 * apply a HARD constraint nobody approved, and announce itself only as unplaced
 * Sessions.
 */

/** One veto row as the app reads it back. */
export interface UnavailabilityRow {
    id: string;
    personId: string;
    days: number[];
    blocks: number[];
    weeks: number[];
    reason: string | null;
    status: 'PENDING' | 'APPROVED' | 'REJECTED';
    decisionNote: string | null;
    decidedAt: Date | null;
}

/**
 * APPROVED windows for the given people, in the term being solved. The ONLY read
 * path for solver input — the two filters are the whole safety property, and both
 * were added because their absence was demonstrated:
 *
 *   status  a PENDING window applies a HARD rule nobody approved
 *   term    `weeks` counts ONE term's calendar; a stored `weeks:[2]` reached both
 *           demo terms, where week 2 begins thirteen months apart
 *
 * `termId IS NULL` means every term — what a recurring weekly pattern means.
 */
export async function approvedBlackoutsFor(
    tx: Tx,
    personIds: readonly string[],
    termId: string,
): Promise<Map<string, UnavailabilityWindow[]>> {
    const byPerson = new Map<string, UnavailabilityWindow[]>();

    if (personIds.length === 0) {
        return byPerson;
    }

    const rows = await tx.personUnavailability.findMany({
        where: {
            personId: { in: [...personIds] },
            status: 'APPROVED',
            OR: [{ termId: null }, { termId }],
        },
        select: { personId: true, days: true, blocks: true, weeks: true },
        orderBy: { createdAt: 'asc' },
    });

    for (const row of rows) {
        const windows = byPerson.get(row.personId) ?? [];

        windows.push({ days: row.days, blocks: row.blocks, weeks: row.weeks });
        byPerson.set(row.personId, windows);
    }

    return byPerson;
}

/**
 * The grid limits a window is validated against.
 *
 * `blocksPerDay` is the MAXIMUM across the tenant's grids — a veto is not
 * term-scoped, so it must stay expressible under every grid the tenant has.
 * `defaultGrid` is what the "you have blocked N of M" summary counts against,
 * because a summary needs ONE grid to be a number at all, and the default is the
 * one the tenant's Terms use unless they say otherwise.
 */
export interface GridLimits {
    blocksPerDay: number;
    /**
     * The whole grid shape, not just its dimensions.
     *
     * `blockTime()` needs the lengths, the start clock and the break overrides
     * to name a block, and the pages in this area must not fetch
     * `/api/time-grids` for them — that needs `time_grid.read`, which nobody
     * holding only `availability.manage_own` has, and one refused fetch in a
     * reference wave renders every control on the page over empty data.
     */
    defaultGrid: {
        id: string;
        name: string;
        blocksPerDay: number;
        activeDays: number[];
        blockLengthMinutes: number;
        startHour: number;
        startMinute: number;
        breakMinutes: number;
        breaks: { afterBlockIndex: number; durationMinutes: number; label: string; dayOfWeek: number | null }[];
    } | null;
}

/**
 * Stated preferences for the given people — the ONLY read path into
 * `person_preference` for solver input, mirroring `approvedBlackoutsFor`.
 *
 * No status filter, because preferences have no state machine: a preference is
 * SOFT, so an unreviewed one shifts a weighted term rather than refusing a
 * placement, and there is nothing for an approver to protect (design record §3).
 * That asymmetry with unavailability is deliberate and is the reason this is a
 * separate function rather than a parameter on that one.
 *
 * `weightMultiplier` travels. It is per-Person data and cannot be pre-resolved
 * into `ConstraintConfig.weight`: that carries one scalar per constraint row and
 * `ConstraintScope` has no person axis, so collapsing several lecturers'
 * multipliers into it would be the silent widening the offering-scope skip
 * exists to prevent.
 *
 * `roomFeatures` are resolved to Equipment KEYS here, not ids. The wire matches
 * them against `Room.feature_tags`, which is the same vocabulary by key — the
 * id is this app's internal handle and means nothing to the solver.
 */
export interface StatedPreference {
    days: number[];
    blocks: number[];
    weightMultiplier: number | null;
    roomFeatures: string[];
}

export async function statedPreferencesFor(
    tx: Tx,
    personIds: string[],
): Promise<Map<string, StatedPreference>> {
    const out = new Map<string, StatedPreference>();

    if (personIds.length === 0) {
        return out;
    }

    const rows = await tx.personPreference.findMany({
        where: { personId: { in: personIds } },
        select: {
            personId: true,
            preferredDays: true,
            preferredBlocks: true,
            weightMultiplier: true,
            roomFeatures: { select: { equipment: { select: { key: true } } } },
        },
    });

    for (const row of rows) {
        out.set(row.personId, {
            days: row.preferredDays,
            blocks: row.preferredBlocks,
            weightMultiplier: row.weightMultiplier,
            /*
             * SORTED, because nothing else orders them and `hashInput` is taken
             * over the encoded bytes: two assemblies of one unchanged tenant
             * must produce the same hash, or the idempotency key stops
             * identifying the problem and every retry launches a fresh run.
             */
            roomFeatures: row.roomFeatures.map((link) => link.equipment.key).sort(),
        });
    }

    return out;
}

export async function tenantGridLimits(tx: Tx, tenantId: string): Promise<GridLimits> {
    const grids = await tx.timeGrid.findMany({
        where: { tenantId },
        select: {
            id: true,
            name: true,
            blocksPerDay: true,
            activeDays: true,
            isDefault: true,
            blockLengthMinutes: true,
            startHour: true,
            startMinute: true,
            breakMinutes: true,
            breaks: {
                select: { afterBlockIndex: true, durationMinutes: true, label: true, dayOfWeek: true },
            },
        },
        orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });

    const defaultGrid = grids.find((grid) => grid.isDefault) ?? grids[0] ?? null;

    return {
        // A tenant with NO grid at all gets 0, which makes every block index
        // invalid and every submission fail with a message naming the real
        // cause. Falling back to some arbitrary number would accept indices that
        // resolve to nothing.
        blocksPerDay: grids.reduce((max, grid) => Math.max(max, grid.blocksPerDay), 0),
        defaultGrid: defaultGrid
            ? {
                id: defaultGrid.id,
                name: defaultGrid.name,
                blocksPerDay: defaultGrid.blocksPerDay,
                activeDays: defaultGrid.activeDays,
                blockLengthMinutes: defaultGrid.blockLengthMinutes,
                startHour: defaultGrid.startHour,
                startMinute: defaultGrid.startMinute,
                breakMinutes: defaultGrid.breakMinutes,
                breaks: defaultGrid.breaks,
            }
            : null,
    };
}

/**
 * The tenant's terms, ordered, with their week counts.
 *
 * Travels with every availability response for the same reason the grid does: a
 * page that fetched `/api/terms` for it would need `term.read`, which nobody
 * holding only `availability.manage_own` has, and one refused fetch in a
 * reference wave empties every control on the page.
 */
export async function tenantTerms(tx: Tx, tenantId: string): Promise<TermWindow[]> {
    const rows = await tx.term.findMany({
        where: { tenantId },
        select: { id: true, name: true, startDate: true, endDate: true },
        orderBy: { startDate: 'asc' },
    });

    return rows.map((row) => ({
        id: row.id,
        name: row.name,
        startDate: isoDate(row.startDate),
        endDate: isoDate(row.endDate),
        weekCount: weekCountOf(row.startDate, row.endDate),
    }));
}

/**
 * Turn a picked date range into the term and week indices it blocks. THE TERM IS
 * DERIVED FROM THE DATES: a person booking leave knows the dates, and asking which
 * academic term contains them is asking them to do this lookup.
 *
 * Both refusals are deliberate, because both best guesses are silently wrong: no
 * term containing it would store an inert row, and one spanning two terms cannot be
 * expressed by one row without losing half the absence.
 */
export function resolveHolidayRange(
    terms: readonly TermWindow[],
    from: Date,
    to: Date,
): { term: TermWindow; resolution: HolidayResolution } {
    if (to.getTime() < from.getTime()) {
        throw createError({
            statusCode: 400,
            statusMessage: 'The end date is before the start date.',
            data: { field: 'endDate' },
        });
    }

    const overlapping = terms.filter((term) => overlaps(
        new Date(term.startDate),
        new Date(term.endDate),
        from,
        to,
    ));

    if (overlapping.length === 0) {
        const known = terms.length
            ? terms.map((term) => `${term.name} (${term.startDate} to ${term.endDate})`).join(', ')
            : 'none are configured';

        throw createError({
            statusCode: 422,
            statusMessage: `Those dates fall outside every term, so nothing would be blocked. Terms: ${known}.`,
            data: { field: 'startDate' },
        });
    }

    if (overlapping.length > 1) {
        throw createError({
            statusCode: 422,
            statusMessage: 'That range spans more than one term '
                + `(${overlapping.map((term) => term.name).join(', ')}). `
                + 'Enter one absence per term — a single entry counts the weeks of one term only.',
            data: { field: 'endDate' },
        });
    }

    const term = overlapping[0] as TermWindow;
    const resolution = resolveHolidayWeeks(new Date(term.startDate), new Date(term.endDate), from, to);

    if (resolution.weeks.length === 0) {
        throw createError({
            statusCode: 422,
            statusMessage: `Those dates resolve to no teaching week of ${term.name}.`,
            data: { field: 'startDate' },
        });
    }

    return { term, resolution };
}

/**
 * A single date, resolved to the ONE term it falls in, its week index, and its
 * ISO weekday — the day-level counterpart to `resolveHolidayRange` above,
 * which resolves a RANGE and deliberately blocks every day of every week it
 * touches. Reused rather than duplicated: `resolveHolidayRange(terms, d, d)`
 * already refuses a date outside every term and a date spanning more than one
 * (impossible for `from === to`, but the shared function does not know that,
 * so the same error paths apply for free).
 *
 * WHY THIS NEEDS A TERM AT ALL, when the recurring pattern next door writes
 * none. `termId IS NULL` means "every term", which is what a recurring pattern
 * means and is NOT what a specific date means — `weeks:[2]` reached both demo
 * terms once, thirteen months apart, before `approvedBlackoutsFor` scoped
 * reads by term. A date-derived window is unambiguously one term's week, so it
 * writes that term rather than leaving the field to mean "every term" by
 * omission.
 */
export function resolveVetoDate(
    terms: readonly TermWindow[],
    date: Date,
): { term: TermWindow; weeks: number[]; dayOfWeek: number } {
    const { term, resolution } = resolveHolidayRange(terms, date, date);

    return { term, weeks: resolution.weeks, dayOfWeek: isoWeekday(date) };
}

/**
 * Payload for one submitted window.
 *
 * Ranges are NOT checked here. `validateWindow` needs the tenant's grid, which a
 * synchronous zod refinement cannot read — the same split `constraintShapeRefinement`
 * and `constraintBeforeUpdate` already make for the same reason.
 */
export const windowSchema = z.object({
    days: z.array(z.number().int()).max(7).default([]),
    blocks: z.array(z.number().int()).max(64).default([]),
    weeks: z.array(z.number().int()).max(64).default([]),
    reason: z.string().trim().max(500).nullish(),
    /**
     * "I cannot teach THIS day" — a single calendar date, as `/schedule`'s
     * blocked-day button sends it (issue #2), rather than the recurring
     * pattern this route otherwise writes.
     *
     * MUTUALLY EXCLUSIVE WITH `days`/`weeks`, enforced below rather than by
     * the type: a caller naming both is ambiguous about which one wins, and
     * guessing is how a lecturer ends up blocking a different day than the one
     * they clicked.
     *
     * NOT a third route. The card is explicit that this must not grow its own
     * endpoint — it converges on the same `personUnavailability.create()`
     * this route already makes; only how `days`/`weeks`/`termId` are derived
     * differs.
     */
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date.').optional(),
});

/**
 * A date-range absence, as the form submits it.
 *
 * Dates in, weeks out — the caller never sends week indices. Letting a client
 * compute them would be a second implementation of `weekIndexOf`, which is the
 * arithmetic this project already had to unify once after two copies agreed
 * right up until they did not.
 */
export const holidaySchema = z.object({
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date.'),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date.'),
    reason: z.string().trim().max(500).nullish(),
});

export const preferencesSchema = z.object({
    preferredDays: z.array(z.number().int().min(1).max(7)).max(7).default([]),
    preferredBlocks: z.array(z.number().int().min(0)).max(64).default([]),
    /**
     * Equipment IDS. Capped like the other axes; a person preferring more than
     * 64 room types is expressing no preference at all.
     *
     * `.default([])` so a caller written before this axis existed keeps working
     * — but note that a PUT replaces the whole preference state, so an existing
     * UI that does not send this field CLEARS it. Both pages send all three.
     */
    preferredRoomFeatureIds: z.array(z.string().min(1)).max(64).default([]),
});

/**
 * The ADMINISTRATOR preference payload. Identical to `preferencesSchema` plus
 * the weight override, which only this path accepts.
 *
 * `null` clears the override back to the tenant default; an absent key means the
 * same thing, because this is a PUT and replaces the whole preference state.
 * Once a UI exposes the control it must therefore send the current value on
 * every save, exactly as it already sends both axes.
 */
export const staffPreferencesSchema = preferencesSchema.extend({
    weightMultiplier: z.number()
        .min(WEIGHT_MULTIPLIER_MIN)
        .max(WEIGHT_MULTIPLIER_MAX)
        .nullable()
        .default(null),
});

/**
 * Replace a Person's preferred room types, having first checked every id is one
 * this tenant may actually reference.
 *
 * THE CHECK IS NOT REDUNDANT WITH THE FOREIGN KEY. Postgres runs referential
 * integrity as the referenced table's owner, so an FK check does NOT consult
 * row-level security — `equipment_id` pointing at another tenant's row would
 * satisfy the constraint and insert cleanly. RLS on `equipment` is what decides
 * what this tenant can see, and that has to be asked explicitly.
 *
 * It refuses by NAME rather than filtering the unknown ids out. A silently
 * narrowed save reports success for a preference that was not stored, which is
 * the failure mode this codebase treats as worse than an error.
 *
 * Shared by both write paths, unlike the self-service weight refusal: which
 * room types exist is the same question whoever is asking, so a divergence here
 * would be a bug rather than a policy.
 */
export async function replaceRoomFeaturePreferences(tx: Tx, options: {
    tenantId: string;
    personId: string;
    equipmentIds: string[];
}): Promise<void> {
    const { tenantId, personId } = options;
    const equipmentIds = [...new Set(options.equipmentIds)];

    await tx.personPreferenceRoomFeature.deleteMany({ where: { personId, tenantId } });

    if (equipmentIds.length === 0) {
        return;
    }

    // Federation-owned equipment is legitimately referenceable — the read policy
    // on `equipment` widens to the federation — so this must not filter on
    // `tenantId` itself. RLS already answers the question correctly.
    const visible = await tx.equipment.findMany({
        where: { id: { in: equipmentIds } },
        select: { id: true },
    });

    if (visible.length !== equipmentIds.length) {
        const found = new Set(visible.map((row) => row.id));

        throw createError({
            statusCode: 400,
            statusMessage: 'Unknown equipment: '
                + equipmentIds.filter((id) => !found.has(id)).join(', '),
            data: { field: 'preferredRoomFeatureIds' },
        });
    }

    await tx.personPreferenceRoomFeature.createMany({
        data: equipmentIds.map((equipmentId) => ({ personId, equipmentId, tenantId })),
    });
}

/**
 * Grid-aware refusal, shared by the self-service and administrator write paths
 * so the two cannot diverge on what a legal window is.
 *
 * Deduplicates and sorts as a side effect: `[5,5,1]` and `[1,5]` are the same
 * window, and storing both shapes would make two identical vetoes look
 * different in the review queue.
 */
export function normaliseWindow(
    input: { days: number[]; blocks: number[]; weeks: number[] },
    limits: GridLimits,
): UnavailabilityWindow {
    const window: UnavailabilityWindow = {
        days: [...new Set(input.days)].sort((a, b) => a - b),
        blocks: [...new Set(input.blocks)].sort((a, b) => a - b),
        weeks: [...new Set(input.weeks)].sort((a, b) => a - b),
    };

    const problems = validateWindow(window, { blocksPerDay: limits.blocksPerDay });

    if (problems.length) {
        throw createError({
            statusCode: 400,
            statusMessage: problems.map((problem) => problem.message).join(' '),
            data: { field: problems[0]?.field },
        });
    }

    /*
     * "Never available, on any day, in any week" is legal on the wire and the
     * solver honours it literally. It is also almost always a mis-click, and it
     * is the most destructive thing a veto can say — so it is refused at the
     * boundary rather than routed through approval where somebody might wave it
     * past in a list of twenty.
     */
    if (isTotalBlackout(window)) {
        throw createError({
            statusCode: 422,
            statusMessage: 'That window names no day, block or week, which means "never available at all". '
                + 'Pick at least one day, block or week.',
            data: { field: 'days' },
        });
    }

    return window;
}
