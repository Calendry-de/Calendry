import { addDays, isoDate, mondayOf, weekCountOf, weekIndexOf } from './academicCalendar';

/**
 * Declared unavailability and soft preferences — the rules both sides share.
 *
 * One definition, read by the API's write boundary, by `assembleSolverInput`'s
 * report and by the self-service page's "you have blocked N of M" note. Same
 * discipline as `shared/timeGrid.ts` and `shared/groupCapacity.ts`: a page that
 * computed its own version of this would eventually disagree with the number
 * the solve report prints, while looking authoritative.
 */

/**
 * One unavailability window, in the wire's own shape.
 *
 * EMPTY MEANS EVERY VALUE ON THAT AXIS — `{days:[5]}` is every Friday,
 * `{blocks:[0]}` is every first block, and all three empty is "never
 * available". This is `calendry.solver.v1.Unavailability` verbatim.
 *
 * `PersonPreference` below INVERTS the convention: there an empty array means
 * "no preference". The two live next to each other and mean opposite things by
 * emptiness, which is exactly the sort of thing that gets misread, so both say
 * so wherever they are declared.
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
    /** `blocksPerDay × activeDays` — the whole weekly index space. */
    total: number;
    /**
     * Windows excluded from the count because they name specific weeks.
     *
     * Reported rather than folded in: a week-scoped absence ("away at a
     * conference in week 7") is not a standing block, and counting it against
     * the weekly grid would inflate the number in a way nobody could reconcile
     * with what they entered. Saying how many were set aside keeps the summary
     * honest instead of merely smaller.
     */
    weekScopedWindows: number;
}

/**
 * How much of the weekly grid a person's BLANKET vetoes remove.
 *
 * Blanket only — see `weekScopedWindows`. Counted as distinct (day, block)
 * pairs rather than summed per window, because two windows may overlap and
 * "blocked 14 of 40" has to mean fourteen slots, not fourteen claims.
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

        // Empty = every value on that axis, so an empty `days` expands to the
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
 *
 * A threshold decides only WHETHER to mention it, never severity — both numbers
 * travel, so 20-of-40 and 39-of-40 both surface and are obviously different
 * problems. Same reasoning as `ENROLMENT_COMPLETE_RATIO`: flag everything and
 * the report becomes noise people learn to skip.
 *
 * Half the week is not a magic number. It is the point past which "this person
 * is mostly unavailable" is worth an administrator's attention even though the
 * timetable may still be perfectly feasible.
 */
export const HEAVY_VETO_RATIO = 0.5;

export interface WindowProblem {
    field: 'days' | 'blocks' | 'weeks';
    message: string;
}

/**
 * Write-boundary validation for one window.
 *
 * `blocksPerDay` is the MAXIMUM across the tenant's TimeGrids, not the default
 * grid's. A veto is not term-scoped, so it has to stay expressible for every
 * grid the tenant has; validating against one of them would reject a window
 * that is perfectly meaningful under another.
 *
 * Days are checked against 1..7 rather than against the grid's ACTIVE days.
 * "I am never available on Saturdays" is a legitimate thing to record in a
 * Monday-to-Friday tenant — it blocks nothing today and starts meaning
 * something the moment Saturday is activated. It contributes nothing to
 * `blockedSlotSummary`, which is the honest treatment: stored, and counted as
 * zero.
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
            message: `Blocks must be between 0 and ${limits.blocksPerDay - 1} — the largest time grid in this tenant has ${limits.blocksPerDay} blocks per day.`,
        });
    }

    if (window.weeks.some((week) => !Number.isInteger(week) || week < 0)) {
        problems.push({ field: 'weeks', message: 'Weeks must be non-negative week indices.' });
    }

    return problems;
}

/**
 * A window naming nothing on any axis means "never available, ever".
 *
 * Legal to store and legal to send — the solver reads it exactly that way — but
 * it is almost always a mis-click, and it is the single most destructive thing
 * a veto can say. So the API refuses it and the form refuses to submit it,
 * rather than routing it through approval where somebody might wave it past.
 */
export function isTotalBlackout(window: UnavailabilityWindow): boolean {
    return window.days.length === 0 && window.blocks.length === 0 && window.weeks.length === 0;
}

/**
 * A Person's soft scheduling preferences.
 *
 * EMPTY MEANS NO PREFERENCE on that axis — the opposite of
 * `UnavailabilityWindow` above. An absent row and a row holding two empty
 * arrays are the same state, which is why the write path deletes rather than
 * storing the second representation.
 *
 * STORED BUT NOT YET SOLVER-EFFECTIVE. No wire field exists for these; see the
 * `PersonPreference` model comment for why that is deliberate here and was a
 * bug for `lecturer_veto`.
 */
/** A term, as the availability screens need it to resolve and preview dates. */
export interface TermWindow {
    id: string;
    name: string;
    startDate: string;
    endDate: string;
    weekCount: number;
}

export interface PersonPreferences {
    preferredDays: number[];
    preferredBlocks: number[];
}

export function preferencesAreEmpty(preferences: PersonPreferences): boolean {
    return preferences.preferredDays.length === 0 && preferences.preferredBlocks.length === 0;
}

/**
 * One week a holiday range touches, with the dates it actually covers.
 *
 * The dates are what the form SHOWS. Week indices are meaningless to a person
 * picking "the 14th to the 18th", and the mapping from a date range to week
 * numbers is genuinely unpredictable — which is the same reason the calendar
 * period editor renders a week-reclassification preview rather than trusting
 * two dates to speak for themselves.
 */
export interface TouchedWeek {
    index: number;
    start: string;
    end: string;
    /** False when the range covers only part of this week — the over-block. */
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
 * A WEEK IS BLOCKED IF THE RANGE TOUCHES IT AT ALL — the same rule
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
 * is conjunctive within a row — `{days, blocks, weeks}` all AND together — so
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
        // inside the term — a range ending on Wednesday leaves Thu/Fri blocked
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
