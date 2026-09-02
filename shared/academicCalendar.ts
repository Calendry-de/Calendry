/**
 * Week classification: the one definition of what kind of week a week is.
 *
 * In `shared/` because the solver's calendar and the calendar-period editor's
 * preview must not drift: a preview disagreeing with the wire would state the
 * opposite of the truth while looking authoritative.
 *
 * A preview is needed because the mapping is genuinely not obvious: an exam period
 * of 2027-09-27 → 2027-10-18 marks FOUR weeks EXAM, not three, since the rule is
 * "touches" and the week beginning 10-18 counts on its Monday alone.
 *
 * THE PRECEDENCE RULE (policy, not derivation):
 *   EXAM     if any exam period TOUCHES the week
 *   BREAK    if a break period covers the ENTIRE week
 *   HOLIDAY  if a holiday period covers the ENTIRE week
 *   TEACHING otherwise
 *
 * The asymmetry is deliberate: an exam anywhere in a week makes the whole week
 * unattractive for teaching, while a two-day break does not stop the other three
 * days. Holidays not swallowing a whole week are emitted as individual dates.
 *
 * A VISIBILITY and PREFERENCE model, not a hard rule:
 * `minimize_exam_week_sessions` is SOFT.
 */

/** Kinds of academic-calendar period, mirroring the `CalendarPeriodKind` enum. */
export type PeriodKind = 'HOLIDAY' | 'BREAK' | 'EXAM';

/** Wire `WeekKind` values; the generated proto enum is numeric. */
export const WEEK_KIND = { UNSPECIFIED: 0, TEACHING: 1, EXAM: 2, BREAK: 3, HOLIDAY: 4 } as const;

export type WeekKindName = 'UNSPECIFIED' | 'TEACHING' | 'EXAM' | 'BREAK' | 'HOLIDAY';

/** Numeric wire value → name, for anything that has to show a human the kind. */
export const WEEK_KIND_NAME: Record<number, WeekKindName> = {
    0: 'UNSPECIFIED', 1: 'TEACHING', 2: 'EXAM', 3: 'BREAK', 4: 'HOLIDAY',
};

export interface CalendarPeriodLike {
    kind: PeriodKind;
    startDate: Date;
    endDate: Date;
}

export interface ClassifiedWeek {
    /** 0-based, Monday-anchored. `termWeek` in the database is this plus one. */
    index: number;
    /** That week's Monday, ISO-8601 (YYYY-MM-DD). */
    startDate: string;
    /** A `WEEK_KIND` value. */
    kind: number;
}

const MS_PER_DAY = 86_400_000;

/** ISO weekday, 1 = Monday … 7 = Sunday, from a UTC-anchored date. */
export function isoWeekday(date: Date): number {
    return ((date.getUTCDay() + 6) % 7) + 1;
}

/** UTC midnight of the Monday on or before `date`. */
export function mondayOf(date: Date): Date {
    const utcMidnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());

    return new Date(utcMidnight - (isoWeekday(new Date(utcMidnight)) - 1) * MS_PER_DAY);
}

/** ISO-8601 date (YYYY-MM-DD) of a UTC-anchored date. */
export function isoDate(date: Date): string {
    return date.toISOString().slice(0, 10);
}

/**
 * The calendar date a `(termWeek, dayOfWeek)` slot falls on. ONE definition of an
 * arithmetic that existed three times, including in SQL in
 * `calendry_internal.federation_room_occupancy()`.
 *
 * UTC-ANCHORED: a slot's date is a calendar fact about the TENANT's timetable,
 * never a moment shifted by whoever is looking at it. A viewer's locale changes how
 * it is written, never which date it is.
 *
 * `termWeek` is 1-based, `dayOfWeek` an ISO weekday (1 = Monday).
 */
export function slotDate(termStart: Date, termWeek: number, dayOfWeek: number): Date {
    return addDays(mondayOf(termStart), (termWeek - 1) * 7 + (dayOfWeek - 1));
}

export function addDays(date: Date, days: number): Date {
    return new Date(date.getTime() + days * MS_PER_DAY);
}

/** Inclusive-range overlap on date-only values. */
export function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
    return aStart.getTime() <= bEnd.getTime() && bStart.getTime() <= aEnd.getTime();
}

export function covers(outerStart: Date, outerEnd: Date, innerStart: Date, innerEnd: Date): boolean {
    return outerStart.getTime() <= innerStart.getTime() && outerEnd.getTime() >= innerEnd.getTime();
}

/**
 * How many Monday-anchored weeks a term spans.
 *
 * Week 0 begins at the Monday on or before `termStart`, so the first week may
 * contain days before the term itself. That is correct rather than sloppy: the
 * week index has to be derivable from any date by the same rule, or
 * `reference_slot` and a Session's stored week would disagree.
 */
export function weekCountOf(termStart: Date, termEnd: Date): number {
    return weekIndexOf(termStart, termEnd) + 1;
}

/**
 * Which week of a term a DATE falls in, 0-based, Monday-anchored. The inverse of
 * `slotDate`, anchored the same way `weekCountOf` counts, so a date's index and the
 * term's total agree by construction.
 *
 * NEGATIVE before that Monday and deliberately not clamped: the occupancy mapper
 * filters it out, `computeReferenceSlot` clamps it to 0, and a helper picking one
 * would impose it on the other.
 */
export function weekIndexOf(termStart: Date, date: Date): number {
    const first = mondayOf(termStart).getTime();
    const target = mondayOf(date).getTime();

    return Math.floor((target - first) / (7 * MS_PER_DAY));
}

/** Where a date falls relative to a Term. See `termPosition`. */
export type TermPhase = 'BEFORE' | 'DURING' | 'AFTER';

export interface TermPosition {
    phase: TermPhase;
    /**
     * 1-based term week of the date, CLAMPED into the term: week 1 before it
     * begins, the last week after it ends. Read it only alongside `phase`,
     * which is what says whether the number describes now or a boundary.
     */
    week: number;
    totalWeeks: number;
}

/**
 * Which week of a term a date is in, and whether the term is running at all.
 *
 * MONDAY-ANCHORED, NOT DATE-COMPARED, and that is the whole decision in here.
 * A term beginning Thursday 2026-10-01 has its week 1 start on Monday
 * 09-28, because `weekIndexOf` anchors every week to the Monday on or before
 * `termStart` (the rule that lets a date's index and a Session's stored
 * `termWeek` agree by construction). So on Wednesday 09-30 this reports
 * `DURING`, week 1, even though the term's own start date is tomorrow.
 *
 * That is deliberate: `/schedule`'s Today button resolves today the same way
 * (`weekIndexOf` + clamp, in `jumpToToday`), so it already draws that Wednesday
 * inside week 1 with a live now-indicator. Comparing dates here instead would
 * make the dashboard say "the term has not started" about a week the schedule
 * is already showing you, which is two definitions of "now" rather than one.
 *
 * `date` must be TENANT-LOCAL (`localNow(now, tenant.timezone).date`), never a
 * raw `new Date()`: CLAUDE.md's timezone rule is that grid resolution is always
 * tenant-local and a viewer's own zone is display-only.
 */
export function termPosition(termStart: Date, termEnd: Date, date: Date): TermPosition {
    const totalWeeks = weekCountOf(termStart, termEnd);
    const index = weekIndexOf(termStart, date);

    if (index < 0) {
        return { phase: 'BEFORE', week: 1, totalWeeks };
    }

    if (index >= totalWeeks) {
        return { phase: 'AFTER', week: totalWeeks, totalWeeks };
    }

    return { phase: 'DURING', week: index + 1, totalWeeks };
}

/**
 * Classify every week of a term.
 *
 * The single implementation behind both `buildAcademicCalendar` (what the
 * solver is told) and the calendar-period editor's preview (what the tenant is
 * shown). Kept free of proto types so the client can call it.
 */
export function classifyWeeks(
    termStart: Date,
    termEnd: Date,
    periods: CalendarPeriodLike[],
): ClassifiedWeek[] {
    const firstMonday = mondayOf(termStart);
    const exams = periods.filter((p) => p.kind === 'EXAM');
    const breaks = periods.filter((p) => p.kind === 'BREAK');
    const holidays = periods.filter((p) => p.kind === 'HOLIDAY');

    const weeks: ClassifiedWeek[] = [];

    for (let index = 0; index < weekCountOf(termStart, termEnd); index += 1) {
        const weekStart = addDays(firstMonday, index * 7);
        const weekEnd = addDays(weekStart, 6);

        let kind: number = WEEK_KIND.TEACHING;

        // TOUCHES for exams, COVERS for the other two; see the precedence note
        // at the top of this file.
        if (exams.some((p) => overlaps(p.startDate, p.endDate, weekStart, weekEnd))) {
            kind = WEEK_KIND.EXAM;
        } else if (breaks.some((p) => covers(p.startDate, p.endDate, weekStart, weekEnd))) {
            kind = WEEK_KIND.BREAK;
        } else if (holidays.some((p) => covers(p.startDate, p.endDate, weekStart, weekEnd))) {
            kind = WEEK_KIND.HOLIDAY;
        }

        weeks.push({ index, startDate: isoDate(weekStart), kind });
    }

    return weeks;
}

/** A Group's availability window inside one Term. `null` on a side = open. */
export interface AvailabilityWindow {
    availableFrom: Date | null;
    availableTo: Date | null;
}

/**
 * The week indices a Group is NOT available: the complement of its window.
 *
 * THE ONE PLACE THE POLARITY FLIPS. A tenant states when a Group *is* around,
 * because that is the question an academic calendar answers ("this cohort runs
 * weeks 1-6"). The wire has exactly one way to say absence, `Unavailability`,
 * shared with `Person.blackouts`. Inverting in a single named function keeps
 * that flip auditable instead of leaving it inline at the assembly site, where a
 * future reader would have to infer the direction from a `!`.
 *
 * Week-granular, not day-granular, and that is a real narrowing worth stating:
 * `Unavailability.weeks` is an index into the Term's calendar weeks, so a window
 * ending mid-week frees the WHOLE of that week. Rounding the other way, dropping
 * a week the Group is present for part of, would refuse placements that are
 * legitimately fine, and this rule is HARD. So a partially-covered week counts as
 * available, deliberately: the same "touches the week" reading `EXAM` periods
 * use, for the same reason.
 *
 * A window with both sides open returns nothing, matching an absent row. The
 * database forbids that state (`group_term_availability_needs_a_bound`) so it
 * cannot arrive from storage, but the function is total rather than throwing:
 * "no constraint" is the honest answer to "no bounds", and it is what an absent
 * row already means.
 */
export function blackedOutWeeks(
    termStart: Date,
    termEnd: Date,
    window: AvailabilityWindow,
): number[] {
    const { availableFrom, availableTo } = window;

    if (!availableFrom && !availableTo) {
        return [];
    }

    const total = weekCountOf(termStart, termEnd);
    // A partially-covered week is AVAILABLE, so the available span is widened to
    // whole weeks before being inverted.
    const firstFree = availableFrom ? weekIndexOf(termStart, availableFrom) : 0;
    const lastFree = availableTo ? weekIndexOf(termStart, availableTo) : total - 1;
    const out: number[] = [];

    for (let index = 0; index < total; index += 1) {
        if (index < firstFree || index > lastFree) {
            out.push(index);
        }
    }

    return out;
}

/** An instant, resolved as the TENANT's calendar day and time. See `localNow`. */
export interface TenantLocalNow {
    /** UTC-midnight Date of the tenant's local calendar day. */
    date: Date;
    /** Minutes since local midnight. */
    minutes: number;
}

/**
 * An instant, expressed as the TENANT's calendar day and time.
 *
 * In `shared/`, not `server/utils/solverCalendar.ts` (which re-exports it),
 * because it now has TWO callers that must not disagree: `computeReferenceSlot`
 * server-side, and the schedule page's Today button / live now-indicator
 * client-side (CLAUDE.md, "Timezone is per-Person and display-only... All of
 * that is tenant-local time": the grid resolves "today" and "now" in
 * `Tenant.timezone`, never the viewer's own zone, so both sides need the exact
 * same function rather than two implementations that could quietly drift).
 *
 * Uses Intl rather than a date library: no new dependency, and it is the only
 * correct way to ask "what day is it in Europe/Berlin right now" without
 * reimplementing tzdata.
 */
export function localNow(now: Date, timeZone: string): TenantLocalNow {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    }).formatToParts(now);

    const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? '0');

    // `hour: '2-digit'` with hour12:false yields 24 for midnight in some ICU
    // versions rather than 0, which would put midnight at the END of the day.
    const hour = get('hour') % 24;

    return {
        date: new Date(Date.UTC(get('year'), get('month') - 1, get('day'))),
        minutes: hour * 60 + get('minute'),
    };
}
