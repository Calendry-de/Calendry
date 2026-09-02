import { describe, expect, it } from 'vitest';
import { termPosition } from '../shared/academicCalendar';
import type { CurrentTermResponse } from '../app/utils/currentTerm';
import { mayReadCurrentTerm, termContext, termContextKey } from '../app/utils/currentTerm';

/**
 * `/dashboard`'s calendar line: the arithmetic behind it and the four states in
 * front of it.
 *
 * NO DATABASE AND NO NUXT, deliberately. `termPosition` is the whole reason the
 * dashboard can name a week at all, and it is pure; the state machine that
 * turns a response into a rendering is pure for the same reason
 * `reviewQueues.ts` and `institutionCounts.ts` are. What a live route can
 * confirm (that this shape is really what the server sends, and that the static
 * `current` segment wins over `[resource]/[id]`) is
 * `tests/current-term-api.test.ts`, which is a different question.
 *
 * The fixture term is the seed's own: WS2026, 2026-10-01 (a THURSDAY) to
 * 2027-02-28 (a SUNDAY). The Thursday start is what makes these assertions
 * worth having, because week 1 begins on Monday 2026-09-28, three days before
 * the term's own start date.
 */
const TERM_START = new Date('2026-10-01');
const TERM_END = new Date('2027-02-28');

describe('where today falls in a term', () => {
    it('counts Monday-anchored weeks, so a Thursday start spans 22 and not 21', () => {
        // mondayOf(2026-10-01) = 09-28, mondayOf(2027-02-28) = 2027-02-22:
        // 21 whole weeks between them, and the term occupies both ends.
        expect(termPosition(TERM_START, TERM_END, new Date('2026-10-01')).totalWeeks).toBe(22);
    });

    it('reads the days between week 1’s Monday and the start date as DURING week 1', () => {
        /*
         * THE ONE JUDGEMENT CALL in `termPosition`, and the reason it is a test
         * rather than a comment. Wednesday 2026-09-30 is before the term's own
         * startDate, and `/schedule`'s Today button already draws it inside
         * week 1 (`jumpToToday` clamps the same `weekIndexOf`). Comparing dates
         * here instead would make the dashboard say "not started yet" about a
         * week the schedule is showing, which is two definitions of now.
         */
        expect(termPosition(TERM_START, TERM_END, new Date('2026-09-30')))
            .toEqual({ phase: 'DURING', week: 1, totalWeeks: 22 });
    });

    it('reads the Sunday before that Monday as BEFORE, with the week clamped to 1', () => {
        // Clamped rather than 0 or negative: `week` is only ever read next to
        // `phase`, and a 0th week is not a thing anyone can be told about.
        expect(termPosition(TERM_START, TERM_END, new Date('2026-09-27')))
            .toEqual({ phase: 'BEFORE', week: 1, totalWeeks: 22 });
    });

    it('is 1-based, so the second Monday is week 2', () => {
        expect(termPosition(TERM_START, TERM_END, new Date('2026-10-05')).week).toBe(2);
    });

    it('includes the end date itself in the last week', () => {
        expect(termPosition(TERM_START, TERM_END, new Date('2027-02-28')))
            .toEqual({ phase: 'DURING', week: 22, totalWeeks: 22 });
    });

    it('reads the Monday after the last week as AFTER, clamped to the last week', () => {
        expect(termPosition(TERM_START, TERM_END, new Date('2027-03-01')))
            .toEqual({ phase: 'AFTER', week: 22, totalWeeks: 22 });
    });

    it('handles a term inside one week without reporting zero weeks', () => {
        // A one-day term is legal data, and `totalWeeks: 0` would render as
        // "week 1 of 0".
        const single = termPosition(new Date('2026-10-01'), new Date('2026-10-01'), new Date('2026-10-01'));

        expect(single).toEqual({ phase: 'DURING', week: 1, totalWeeks: 1 });
    });
});

describe('the four states the header line can be in', () => {
    it('asks nothing without term.read', () => {
        /*
         * The gate is checked BEFORE the fetch so that a caller who was never
         * allowed to ask sees no line, rather than the word "unavailable" —
         * which means "I asked and could not get an answer" and makes a
         * permission boundary look like a broken server.
         */
        expect(mayReadCurrentTerm(new Set())).toBe(false);
        expect(mayReadCurrentTerm(new Set(['session.read', 'dashboard.view']))).toBe(false);
        expect(mayReadCurrentTerm(new Set(['term.read']))).toBe(true);
    });

    it('keeps "no term configured" apart from "could not be read"', () => {
        /*
         * CLAUDE.md's invisible-bug rule, at the smallest possible scale: a
         * fresh tenant that has authored no Term and a request that failed are
         * different facts, and the route answers the first with
         * `{ term: null }` rather than by erroring.
         */
        expect(termContext({ term: null })).toEqual({ kind: 'none' });
        expect(termContextKey({ kind: 'none' })).toBe('dashboard.term.none');
        expect(termContextKey({ kind: 'unavailable' })).toBe('dashboard.term.unavailable');
        expect(termContextKey({ kind: 'none' })).not.toBe(termContextKey({ kind: 'unavailable' }));
    });

    it('carries the term’s name and position through unchanged', () => {
        const response: CurrentTermResponse = {
            term: { id: 'test-term-a', name: 'WS2026', startDate: '2026-10-01', endDate: '2027-02-28' },
            phase: 'DURING',
            week: 4,
            totalWeeks: 22,
        };

        expect(termContext(response)).toEqual({
            kind: 'term',
            name: 'WS2026',
            phase: 'DURING',
            week: 4,
            totalWeeks: 22,
        });
    });

    it('gives each phase its own message, so a term that has not started cannot read as running', () => {
        const keys = (['BEFORE', 'DURING', 'AFTER'] as const).map((phase) => termContextKey({
            kind: 'term', name: 'WS2026', phase, week: 1, totalWeeks: 22,
        }));

        expect(new Set(keys).size).toBe(3);
        expect(keys).toEqual(['dashboard.term.before', 'dashboard.term.during', 'dashboard.term.after']);
    });
});
