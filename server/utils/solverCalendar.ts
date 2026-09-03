import type { AcademicCalendar, SlotRef, Week, TimeGrid as WireTimeGrid } from '@calendry-de/calendry-proto';
import type { BlockGrid } from '../../shared/timeGrid';
import { blockAtMinute } from '../../shared/timeGrid';
import {
    WEEK_KIND, addDays, classifyWeeks, isoDate, isoWeekday, localNow, mondayOf, overlaps, weekIndexOf,
} from '../../shared/academicCalendar';

/**
 * The grid and the academic calendar, and the one genuinely hard computation in the
 * integration: `reference_slot`. Everything the solver places is addressed as
 * (week, day, block) against the calendar built here, so an error makes every
 * placement wrong in a way that still looks like a valid timetable, hence pure
 * functions over primitives, testable without a database.
 *
 * ALL DATE ARITHMETIC IS UTC-ANCHORED: `@db.Date` columns come back as UTC-midnight
 * Dates, and local-zone day arithmetic shifts them either side of midnight. The
 * only place a real timezone is consulted is `localNow`, which uses the TENANT's
 * calendar day, never the requester's (TAXONOMY.md §8).
 */

/**
 * Date helpers and week classification now live in `shared/academicCalendar.ts`,
 * so the calendar-period editor's PREVIEW and the wire cannot disagree about
 * which weeks a period reclassifies. Re-exported here because several server
 * modules already import them from this file.
 */
export {
    isoDate, isoWeekday, localNow, mondayOf, weekCountOf, weekIndexOf,
} from '../../shared/academicCalendar';
export type { TenantLocalNow } from '../../shared/academicCalendar';

// ---------------------------------------------------------------------------
// TimeGrid
// ---------------------------------------------------------------------------

export interface AppTimeGrid extends BlockGrid {
    activeDays: number[];
}

export function toWireTimeGrid(grid: AppTimeGrid, institutionTimezone: string): WireTimeGrid {
    return {
        blocksPerDay: grid.blocksPerDay,
        blockLengthMinutes: grid.blockLengthMinutes,
        dayStartMinute: grid.startHour * 60 + grid.startMinute,
        activeDays: [...grid.activeDays].sort((a, b) => a - b),
        institutionTimezone,
        /*
         * THE REAL GAPS TRAVEL (issue #26, reversing "TimeGrid breaks never
         * reach the solver"; DECISIONS.md § "A Session that spans a break").
         *
         * The solver still reasons in block INDICES for adjacency and
         * conflict; these two fields feed exactly one evaluator,
         * `MinimizeBreakSpanning`, whose `GridTime::gap_minutes_within_span`
         * mirrors `gapsWithinSpan()` here, counting the unnamed default gap as
         * well as named breaks, so the two halves cannot drift on what "spans
         * a break" means. A grid with `breakMinutes = 0` and no overrides
         * serializes to the bytes the pre-0.15 message had.
         *
         * `dayOfWeek` is REAL FIELD PRESENCE on the wire: a day-specific row
         * beats the universal one at the same position and only there, which
         * is `gapAfter`'s own precedence. `null` (every day) becomes absent,
         * never 0, because 0 is not a weekday.
         */
        defaultGapMinutes: grid.breakMinutes,
        breaks: (grid.breaks ?? []).map((brk) => ({
            afterBlockIndex: brk.afterBlockIndex,
            durationMinutes: brk.durationMinutes,
            label: brk.label,
            ...(brk.dayOfWeek === null ? {} : { dayOfWeek: brk.dayOfWeek }),
        })),
    };
}

/**
 * Block index containing `minutesSinceMidnight`, or the count of blocks finished
 * when the time falls in a break or past the last block. The one calculation that
 * MUST include breaks: it converts a wall-clock instant into a grid index, and a
 * 15-minute gap really does shift when block 3 starts.
 *
 * Delegates to the shared walk that `blockTime()` uses; the two answer inverse
 * questions about one timeline and must never disagree.
 */
export function blockOfMinute(
    grid: AppTimeGrid,
    minutesSinceMidnight: number,
    dayOfWeek: number | null = null,
): number {
    return blockAtMinute(grid, minutesSinceMidnight, dayOfWeek);
}

// ---------------------------------------------------------------------------
// Academic calendar
// ---------------------------------------------------------------------------

export type AppPeriodKind = 'HOLIDAY' | 'BREAK' | 'EXAM';

export interface AppCalendarPeriod {
    kind: AppPeriodKind;
    startDate: Date;
    endDate: Date;
}


/**
 * Weeks are MONDAY-ANCHORED, per the proto's `start_date`. A term rarely starts on
 * a Monday, so week 0 begins at the Monday on or before `term.startDate` and the
 * first week may contain days before the term. That is correct, because the week index has
 * to be derivable from any date by the same rule or `reference_slot` and Session
 * weeks would disagree.
 *
 * WEEK-KIND PRECEDENCE (policy, not derivation):
 *   EXAM     if any exam period touches the week
 *   BREAK    if a break period covers the ENTIRE week
 *   HOLIDAY  if a holiday period covers the ENTIRE week
 *   TEACHING otherwise
 *
 * Holidays that do not swallow a whole week are emitted as individual dates. A week
 * already marked HOLIDAY does not also list its days.
 */
export function buildAcademicCalendar(
    termId: string,
    termStart: Date,
    termEnd: Date,
    periods: AppCalendarPeriod[],
): AcademicCalendar {
    /**
     * Week kinds come from `shared/academicCalendar.ts`, which the editor's
     * preview also calls. That is the whole point of the extraction: a preview
     * that disagreed with this would state the opposite of the truth while
     * looking authoritative.
     */
    const weeks = classifyWeeks(termStart, termEnd, periods);

    /**
     * Holidays that do NOT swallow a whole week are emitted as individual dates,
     * matching the proto's "single days that are holidays inside
     * otherwise-teaching weeks". A week already classified HOLIDAY does not also
     * list its days; that would be the same fact twice.
     */
    const holidays = periods.filter((p) => p.kind === 'HOLIDAY');
    const holidayDates: { date: string; label: string }[] = [];
    const firstMonday = mondayOf(termStart);

    for (const week of weeks) {
        if (week.kind === WEEK_KIND.HOLIDAY) {
            continue;
        }

        const weekStart = addDays(firstMonday, week.index * 7);
        const weekEnd = addDays(weekStart, 6);

        for (const period of holidays) {
            if (!overlaps(period.startDate, period.endDate, weekStart, weekEnd)) {
                continue;
            }

            for (let day = 0; day < 7; day += 1) {
                const date = addDays(weekStart, day);

                if (date >= period.startDate && date <= period.endDate) {
                    holidayDates.push({ date: isoDate(date), label: '' });
                }
            }
        }
    }

    /**
     * `ClassifiedWeek` -> the wire's `Week`, field by field.
     *
     * NOT A CAST, and that is the point. `classifyWeeks` answers a question
     * about DATES and knows nothing about the wire, so the two shapes are
     * related by a mapping rather than by an assertion — which is exactly why
     * proto v0.18.0's new `exam_group_ids` arrived as a compile error NAMING
     * the field instead of a message silently missing it. CLAUDE.md: never
     * assert a proto message's shape with `as`; construct checked and let
     * typecheck name the new field.
     *
     * EMPTY IS THE ANSWER, not a gap. The proto reads an empty
     * `exam_group_ids` as EVERY Group — a term-global exam period, which is
     * what every peer on an earlier schema sends and what this app's data
     * actually says: `calendar_period` carries no Group scoping at all, no
     * column and no join table, so there is no narrower set to send. Deriving
     * one would scope an institution's exam fortnight to an audience nobody
     * chose, the same class of mistake as sending an empty `allowed_room_ids`
     * for "must be online".
     */
    const wireWeeks: Week[] = weeks.map((week) => ({
        index: week.index,
        startDate: week.startDate,
        kind: week.kind,
        examGroupIds: [],
    }));

    return { termId, weeks: wireWeeks, holidays: holidayDates };
}

// ---------------------------------------------------------------------------
// reference_slot
// ---------------------------------------------------------------------------

/**
 * Thrown when "now" is past the end of the term.
 *
 * Every Session would be excluded as past, and the solver would return an empty
 * placement that is indistinguishable from a successful solve of an empty
 * problem. Refusing is the honest answer; the route turns this into a 422.
 */
export class TermEndedError extends Error {
    constructor(readonly termEnd: string) {
        super(`The term ended on ${termEnd}; every session is in the past and there is nothing to place.`);
        this.name = 'TermEndedError';
    }
}

/*
 * `TenantLocalNow`/`localNow` now live in `shared/academicCalendar.ts` (see
 * the re-export above): the schedule page's Today button and its live
 * now-indicator need the exact same tenant-local clock, client-side.
 */

/**
 * Maps "now" onto the tenant's academic calendar.
 *
 * Sessions starting strictly before this slot are excluded from recalculation.
 * This is a correctness rule, not a preference, so it decides what the solver is
 * allowed to move. It is computed ONCE per run and stored on `solver_run`,
 * because a value derived from the clock would otherwise make the "same input,
 * same seed" guarantee quietly false on a replay.
 */
export function computeReferenceSlot(options: {
    now: Date;
    timeZone: string;
    termStart: Date;
    termEnd: Date;
    grid: AppTimeGrid;
}): SlotRef {
    const { now, timeZone, termStart, termEnd, grid } = options;
    const local = localNow(now, timeZone);

    // After the term: refuse rather than return an empty timetable.
    if (local.date.getTime() > termEnd.getTime()) {
        throw new TermEndedError(isoDate(termEnd));
    }

    // Before the term: nothing is past. The earliest addressable slot is the
    // grid's first active day, NOT day 1, because a grid that does not teach Monday
    // would otherwise get a reference day it never schedules.
    if (local.date.getTime() < termStart.getTime()) {
        const firstActiveDay = [...grid.activeDays].sort((a, b) => a - b)[0] ?? 1;

        return { week: 0, day: firstActiveDay, block: 0 };
    }

    const week = weekIndexOf(termStart, local.date);

    const day = isoWeekday(local.date);

    return {
        week: Math.max(0, week),
        day,
        // The DAY is passed, not defaulted. A grid with a Friday-specific break
        // resolves a different block for the same wall-clock minute, and this
        // slot decides which Sessions the solver may move, so computing it
        // against the universal schedule would let a Friday afternoon class be
        // rescheduled after it had already run.
        block: blockOfMinute(grid, local.minutes, day),
    };
}
