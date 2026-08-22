import { describe, expect, it } from 'vitest';
import { WEEK_KIND, WEEK_KIND_NAME, classifyWeeks } from '../shared/academicCalendar';
import { buildAcademicCalendar } from '../server/utils/solverCalendar';

/**
 * Week classification, and the preview that has to agree with it.
 *
 * WHY THIS FEATURE EXISTS, recorded because the failure was invisible for
 * months: `calendar_period` had a table, a Prisma model, an RLS policy, a
 * mapper and a wire field — and no way to WRITE a row. So it was empty in every
 * tenant, no week was ever classified EXAM, and `minimize_exam_week_sessions`
 * sat enabled reporting zero violations while looking like it worked. Raising
 * its weight from 5 to 1000 multiplied zero by two hundred.
 *
 * The tests below pin the three things that make the feature honest: the
 * touch-vs-cover asymmetry, that an out-of-range period reclassifies nothing,
 * and that overlapping periods resolve by precedence rather than being refused.
 */
const d = (iso: string) => new Date(iso);
const TERM_START = d('2027-10-02');   // a Saturday
const TERM_END = d('2027-12-23');
const kindsOf = (weeks: { kind: number }[]) => weeks.map((w) => WEEK_KIND_NAME[w.kind]);

describe('the touch-vs-cover asymmetry', () => {
    it('gives an EXAM period every week it TOUCHES, including one it barely enters', () => {
        // The case that motivated the preview. This period ends ON the Monday of
        // week 3, so only one of that week's seven days falls inside it — and
        // the week is EXAM regardless. Nobody predicts that from two dates.
        const weeks = classifyWeeks(TERM_START, TERM_END, [
            { kind: 'EXAM', startDate: d('2027-09-27'), endDate: d('2027-10-18') },
        ]);

        expect(kindsOf(weeks).slice(0, 5))
            .toEqual(['EXAM', 'EXAM', 'EXAM', 'EXAM', 'TEACHING']);
    });

    it('gives a BREAK a week only when it COVERS the whole of it', () => {
        // Same dates, different kind, different answer — which is exactly why
        // the preview recomputes when `kind` changes.
        const weeks = classifyWeeks(TERM_START, TERM_END, [
            { kind: 'BREAK', startDate: d('2027-09-27'), endDate: d('2027-10-18') },
        ]);

        // Weeks 0-2 are fully covered; week 3 (Mon 18 Oct - Sun 24 Oct) is not.
        expect(kindsOf(weeks).slice(0, 5))
            .toEqual(['BREAK', 'BREAK', 'BREAK', 'TEACHING', 'TEACHING']);
    });

    it('gives a HOLIDAY the same whole-week rule as a BREAK', () => {
        const partial = classifyWeeks(TERM_START, TERM_END, [
            { kind: 'HOLIDAY', startDate: d('2027-10-06'), endDate: d('2027-10-07') },
        ]);

        // Two midweek days do not make a holiday week.
        expect(kindsOf(partial).slice(0, 3)).toEqual(['TEACHING', 'TEACHING', 'TEACHING']);
    });
});

describe('a period outside the term reclassifies nothing', () => {
    it('leaves every week TEACHING when the period is entirely before the term', () => {
        // This is the state the API now REFUSES to create — the test pins why:
        // the row would exist, read back correctly, appear in the list, and mean
        // absolutely nothing.
        const weeks = classifyWeeks(TERM_START, TERM_END, [
            { kind: 'EXAM', startDate: d('2027-06-01'), endDate: d('2027-06-30') },
        ]);

        expect(new Set(kindsOf(weeks))).toEqual(new Set(['TEACHING']));
    });

    it('leaves every week TEACHING when the period is entirely after the term', () => {
        const weeks = classifyWeeks(TERM_START, TERM_END, [
            { kind: 'EXAM', startDate: d('2028-02-01'), endDate: d('2028-02-28') },
        ]);

        expect(new Set(kindsOf(weeks))).toEqual(new Set(['TEACHING']));
    });

    it('DOES classify a period that only partially overlaps the term', () => {
        // The counter-example that keeps the rule honest: partial overlap is
        // allowed and meaningful, so the guard must reject only the fully
        // outside case. Without this, tightening the guard to "must be entirely
        // inside" would pass every test above.
        const weeks = classifyWeeks(TERM_START, TERM_END, [
            { kind: 'EXAM', startDate: d('2027-12-20'), endDate: d('2028-01-15') },
        ]);

        expect(kindsOf(weeks).at(-1)).toBe('EXAM');
    });
});

describe('overlapping periods are allowed and resolve by precedence', () => {
    const OVERLAPPING = [
        { kind: 'EXAM' as const, startDate: d('2027-11-01'), endDate: d('2027-11-14') },
        { kind: 'HOLIDAY' as const, startDate: d('2027-11-01'), endDate: d('2027-11-07') },
    ];

    it('lets EXAM win over a HOLIDAY covering the same week', () => {
        // A holiday inside an exam period is ordinary. Refusing overlaps would
        // contradict the precedence rule, which only HAS meaning because periods
        // can overlap.
        const weeks = classifyWeeks(TERM_START, TERM_END, OVERLAPPING);
        const index = weeks.findIndex((w) => w.startDate === '2027-11-01');

        expect(index).toBeGreaterThanOrEqual(0);
        expect(WEEK_KIND_NAME[weeks[index]!.kind]).toBe('EXAM');
    });

    it('is order-independent', () => {
        // Precedence must come from the RULE, not from array position.
        const forward = classifyWeeks(TERM_START, TERM_END, OVERLAPPING);
        const reversed = classifyWeeks(TERM_START, TERM_END, [...OVERLAPPING].reverse());

        expect(kindsOf(forward)).toEqual(kindsOf(reversed));
    });

    it('accepts two EXAM periods touching one week without double-counting', () => {
        const weeks = classifyWeeks(TERM_START, TERM_END, [
            { kind: 'EXAM', startDate: d('2027-11-01'), endDate: d('2027-11-03') },
            { kind: 'EXAM', startDate: d('2027-11-04'), endDate: d('2027-11-05') },
        ]);

        expect(kindsOf(weeks).filter((k) => k === 'EXAM')).toHaveLength(1);
    });
});

describe('the preview and the wire cannot diverge', () => {
    it('buildAcademicCalendar reports exactly what classifyWeeks does', () => {
        // THE point of the shared extraction. If these ever disagree, the editor
        // shows a tenant one thing and tells the solver another — and the tenant
        // has no way to see it.
        const periods = [
            { kind: 'EXAM' as const, startDate: d('2027-12-13'), endDate: d('2027-12-23') },
            { kind: 'HOLIDAY' as const, startDate: d('2027-10-04'), endDate: d('2027-10-10') },
        ];

        const wire = buildAcademicCalendar('t1', TERM_START, TERM_END, periods);
        const preview = classifyWeeks(TERM_START, TERM_END, periods);

        expect(wire.weeks.map((w) => ({ index: w.index, startDate: w.startDate, kind: w.kind })))
            .toEqual(preview);
    });

    it('still emits partial holidays as individual dates', () => {
        // The one thing buildAcademicCalendar does beyond classification, kept
        // working across the extraction.
        const wire = buildAcademicCalendar('t1', TERM_START, TERM_END, [
            { kind: 'HOLIDAY', startDate: d('2027-10-06'), endDate: d('2027-10-07') },
        ]);

        expect(wire.holidays.map((h) => h.date)).toEqual(['2027-10-06', '2027-10-07']);
    });

    it('does NOT list days of a week already classified HOLIDAY', () => {
        const wire = buildAcademicCalendar('t1', TERM_START, TERM_END, [
            { kind: 'HOLIDAY', startDate: d('2027-10-04'), endDate: d('2027-10-10') },
        ]);

        const holidayWeek = wire.weeks.find((w) => w.startDate === '2027-10-04');

        expect(holidayWeek?.kind).toBe(WEEK_KIND.HOLIDAY);
        expect(wire.holidays.filter((h) => h.date.startsWith('2027-10-0'))).toEqual([]);
    });
});
