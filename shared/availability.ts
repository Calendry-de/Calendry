import { addDays, isoDate, mondayOf, weekCountOf, weekIndexOf } from './academicCalendar';

/**
 * Declared unavailability and soft preferences: one definition, read by the
 * API's write boundary, by `assembleSolverInput`'s report and by the
 * self-service page's "you have blocked N of M" note.
 */

/**
 * One unavailability window, `calendry.solver.v1.Unavailability` verbatim.
 *
 * EMPTY MEANS EVERY VALUE ON THAT AXIS: `{days:[5]}` is every Friday, all three
 * empty is "never available". `PersonPreference` below INVERTS this, where empty
 * means "no preference"; the two sit next to each other meaning opposite things.
 */
export interface UnavailabilityWindow {
    days: number[];
    blocks: number[];
    weeks: number[];
}

/** ISO weekday numbers, 1 = Monday. */
export const ISO_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

export interface BlockedSlotSummary {
    /** Distinct (day, block) pairs of the grid this person has blocked. */
    blocked: number;
    /** `blocksPerDay × activeDays`: the whole weekly index space. */
    total: number;
    /**
     * Excluded from the count and reported instead: a week-scoped absence is not
     * a standing block, and counting it against the weekly grid would inflate a
     * number nobody could reconcile with what they entered.
     */
    weekScopedWindows: number;
}

/**
 * Blanket vetoes only. Counted as distinct (day, block) pairs, not summed per
 * window: two windows may overlap, and "blocked 14 of 40" has to mean fourteen
 * slots rather than fourteen claims.
 */
export function blockedSlotSummary(
    windows: readonly UnavailabilityWindow[],
    activeDays: readonly number[],
    blocksPerDay: number,
): BlockedSlotSummary {
    const total = activeDays.length * blocksPerDay;
    const allBlocks = Array.from({ length: blocksPerDay }, (_, index) => index);
    const blocked = new Set<string>();

    let weekScopedWindows = 0;

    for (const window of windows) {
        if (window.weeks.length > 0) {
            weekScopedWindows++;

            continue;
        }

        // An empty `days` expands to the grid's ACTIVE days, not all seven: a
        // Saturday veto in a Mon–Fri tenant blocks nothing that exists.
        // grid's ACTIVE days rather than to all seven: a Saturday veto in a
        // Monday-to-Friday tenant blocks nothing that exists.
        const days = window.days.length ? window.days.filter((day) => activeDays.includes(day)) : activeDays;
        const blocks = window.blocks.length
            ? window.blocks.filter((block) => block >= 0 && block < blocksPerDay)
            : allBlocks;

        for (const day of days) {
            for (const block of blocks) {
                blocked.add(`${day}:${block}`);
            }
        }
    }

    return { blocked: blocked.size, total, weekScopedWindows };
}

/**
 * Fraction of the weekly grid above which a solve REPORTS a person's veto load.
 * The threshold decides only WHETHER to mention it; both numbers travel, so
 * 20-of-40 and 39-of-40 both surface as obviously different problems.
 */
export const HEAVY_VETO_RATIO = 0.5;

export interface WindowProblem {
    field: 'days' | 'blocks' | 'weeks';
    message: string;
}

/**
 * Write-boundary validation for one window.
 *
 * `blocksPerDay` is the MAXIMUM across the tenant's TimeGrids: a veto is not
 * term-scoped, so validating against one grid would reject a window meaningful
 * under another. Days are checked against 1..7, not the ACTIVE days: "never
 * available on Saturdays" is legitimate to record before Saturday is activated,
 * and it counts as zero in `blockedSlotSummary`.
 */
export function validateWindow(
    window: UnavailabilityWindow,
    limits: { blocksPerDay: number; weeksInTerm?: number },
): WindowProblem[] {
    const problems: WindowProblem[] = [];

    if (window.days.some((day) => !Number.isInteger(day) || day < 1 || day > 7)) {
        problems.push({ field: 'days', message: 'Days must be ISO weekday numbers, 1 (Monday) to 7 (Sunday).' });
    }

    if (window.blocks.some((block) => !Number.isInteger(block) || block < 0 || block >= limits.blocksPerDay)) {
        problems.push({
            field: 'blocks',
            message: `Blocks must be between 0 and ${limits.blocksPerDay - 1}; the largest time grid in this tenant has ${limits.blocksPerDay} blocks per day.`,
        });
    }

    if (window.weeks.some((week) => !Number.isInteger(week) || week < 0)) {
        problems.push({ field: 'weeks', message: 'Weeks must be non-negative week indices.' });
    }

    return problems;
}

/**
 * A window naming nothing on any axis means "never available, ever". Legal to
 * store and to send, but almost always a mis-click and the most destructive thing
 * a veto can say, so the API and the form both refuse it rather than routing it
 * through approval.
 */
export function isTotalBlackout(window: UnavailabilityWindow): boolean {
    return window.days.length === 0 && window.blocks.length === 0 && window.weeks.length === 0;
}

/**
 * A Person's soft scheduling preferences. EMPTY MEANS NO PREFERENCE: the
 * opposite of `UnavailabilityWindow`. An absent row and a row of two empty arrays
 * are the same state, which is why the write path deletes rather than storing the
 * second representation.
 *
 * SOLVER-EFFECTIVE since 2026-08-27: these cross as `Person.preferred` (proto
 * 0.7.0) and the solver prices `person_preference_fit` against them. This line
 * said "no wire field exists for these", which stopped being true when the field
 * shipped; the write boundary's own asymmetry is the part still worth knowing:
 * it validates against the tenant's WIDEST grid, so a stored value can name a
 * slot the solved Term has not got, and `assembleSolverInput` narrows and counts
 * the drop rather than sending an impossible slot.
 */
/** A term, as the availability screens need it to resolve and preview dates. */
export interface TermWindow {
    id: string;
    name: string;
    startDate: string;
    endDate: string;
    weekCount: number;
}

/**
 * Declared ONCE because three places need the same two numbers: the zod schema on
 * the administrator write path, the control that edits the value, and the database
 * CHECK (which cannot import this, so the migration restates the range).
 *
 * A multiplier, not an absolute weight: an absolute override rots when the
 * tenant default changes.
 */
export const WEIGHT_MULTIPLIER_MIN = 0.5;
export const WEIGHT_MULTIPLIER_MAX = 2;

/**
 * How an override reads in a summary line, or `null` when there is nothing to
 * say because the person is on the tenant default.
 *
 * In `shared/` rather than beside the other label helpers in `app/utils/` for a
 * plain reason: those import `~/composables/schedule`, which only resolves
 * inside Nuxt, so anything there is unreachable from a unit test. The rule
 * itself, default says nothing, an override names its factor, is worth
 * testing directly.
 */
export function describeWeightMultiplier(value: number | null | undefined): string | null {
    return value == null ? null : `counts ${value}×`;
}

/** True when a multiplier is a legal override. `null` is legal: it means "default". */
export function isWeightMultiplierInRange(value: number | null): boolean {
    return value === null
        || (Number.isFinite(value) && value >= WEIGHT_MULTIPLIER_MIN && value <= WEIGHT_MULTIPLIER_MAX);
}

export interface PersonPreferences {
    preferredDays: number[];
    preferredBlocks: number[];
    /**
     * Equipment IDS, not keys. Ids are this app's vocabulary for a reference;
     * the assembly resolves them to `equipment.key` at the wire, which is the
     * vocabulary `Room.feature_tags` speaks.
     */
    preferredRoomFeatureIds: string[];
    /**
     * Administrator-set multiplier on the tenant-wide preference weight.
     * `null`/absent means "use the tenant default". Optional here because
     * `preferencesAreEmpty` and the self-service page only ever deal in the
     * axes; the weight is not part of what makes a preference exist.
     */
    weightMultiplier?: number | null;
}

/**
 * Whether a preference says nothing at all, and so should be a DELETED row
 * rather than a stored empty one: an absent row is the single representation
 * of "no opinion".
 *
 * ROOM FEATURES COUNT. A person who clears both time axes but still prefers a
 * lab has stated something, and testing days and blocks alone would delete
 * their row on the next save: the preference would vanish from the wire with no
 * error, since an absent `Person.preferred` is a legitimate state.
 */
export function preferencesAreEmpty(preferences: PersonPreferences): boolean {
    return preferences.preferredDays.length === 0
        && preferences.preferredBlocks.length === 0
        && preferences.preferredRoomFeatureIds.length === 0;
}

/**
 * One week a holiday range touches, with the dates it actually covers.
 *
 * The dates are what the form SHOWS. Week indices are meaningless to a person
 * picking "the 14th to the 18th", and the mapping from a date range to week
 * numbers is genuinely unpredictable, which is the same reason the calendar
 * period editor renders a week-reclassification preview rather than trusting
 * two dates to speak for themselves.
 */
export interface TouchedWeek {
    index: number;
    start: string;
    end: string;
    /** False when the range covers only part of this week: the over-block. */
    whole: boolean;
}

export interface HolidayResolution {
    weeks: number[];
    touched: TouchedWeek[];
    /** Weeks blocked in full despite the person being away for only part of them. */
    partial: TouchedWeek[];
}

/**
 * Which term weeks a date range blocks.
 *
 * A WEEK IS BLOCKED IF THE RANGE TOUCHES IT AT ALL: the same rule
 * `classifyWeeks` applies to EXAM periods, and deliberately NOT the "covers the
 * whole week" rule it applies to BREAK and HOLIDAY.
 *
 * That looks backwards at first glance, since this feature is literally called
 * a holiday. The distinction is what the two rules are FOR. A BREAK week is a
 * statement about the whole institution's calendar, so requiring full coverage
 * stops one bank holiday from cancelling a week of teaching for everybody. This
 * is a statement about one person's availability, and the two failure
 * directions are not symmetric:
 *
 *   over-block   the solver loses part of a week it could have used. Costly.
 *   under-block  somebody is scheduled to teach while demonstrably abroad.
 *
 * "Covers" would under-block every range that starts or ends mid-week, which is
 * most of them. For a hard constraint this project consistently takes the
 * fail-closed direction.
 *
 * THE PRECISE ALTERNATIVE WAS CONSIDERED AND COSTS MORE THAN IT SAVES. A window
 * is conjunctive within a row (`{days, blocks, weeks}` all AND together), so
 * "all of week 5, but only Wednesday onward in week 4" cannot be said in ONE
 * row. It needs up to three, and then a holiday is three rows in the approval
 * queue that can be approved separately: an administrator could approve
 * two-thirds of somebody's holiday. Grouping them back into one decision needs a
 * column and a concept this feature does not otherwise want.
 *
 * So the over-block is accepted, bounded (at most the two partial end weeks),
 * and SHOWN: `partial` is what the form reports before anything is submitted,
 * which turns an imprecise rule into an informed choice rather than a surprise.
 *
 * The arithmetic is IMPORTED, never reimplemented. `weekIndexOf` exists because
 * this same Monday-anchored calculation had been written twice and agreed until
 * it did not; an earlier draft of this function took the helpers as parameters,
 * which would have made a second implementation not merely possible but
 * invited.
 */
export function resolveHolidayWeeks(
    termStart: Date,
    termEnd: Date,
    from: Date,
    to: Date,
): HolidayResolution {
    const lastWeek = weekCountOf(termStart, termEnd) - 1;
    const firstTouched = Math.max(0, weekIndexOf(termStart, from));
    const lastTouched = Math.min(lastWeek, weekIndexOf(termStart, to));

    const weeks: number[] = [];
    const touched: TouchedWeek[] = [];
    const partial: TouchedWeek[] = [];

    for (let index = firstTouched; index <= lastTouched; index += 1) {
        const weekStart = addDays(mondayOf(termStart), index * 7);
        const weekEnd = addDays(weekStart, 6);
        // "Whole" means the ABSENCE covers the week, not that the week lies
        // inside the term; a range ending on Wednesday leaves Thu/Fri blocked
        // for nothing, and that is exactly what `partial` reports.
        const whole = from.getTime() <= weekStart.getTime() && to.getTime() >= weekEnd.getTime();

        const entry: TouchedWeek = {
            index,
            start: isoDate(weekStart),
            end: isoDate(weekEnd),
            whole,
        };

        weeks.push(index);
        touched.push(entry);

        if (!whole) {
            partial.push(entry);
        }
    }

    return { weeks, touched, partial };
}
