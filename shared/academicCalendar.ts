/**
 * Week classification: the one definition of what kind of week a week is.
 *
 * In `shared/` because the solver's calendar and the calendar-period editor's
 * preview must not drift — a preview disagreeing with the wire would state the
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
 * A VISIBILITY and PREFERENCE model, not a hard rule —
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
 * Which week of a term a DATE falls in — 0-based, Monday-anchored. The inverse of
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

        // TOUCHES for exams, COVERS for the other two — see the precedence note
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
