import { describe, expect, it } from 'vitest';
import { blackedOutWeeks, weekCountOf } from '../shared/academicCalendar';

/**
 * `blackedOutWeeks`: the one place a Group's availability polarity flips.
 *
 * A tenant states when a Group IS available, because that is the question an
 * academic calendar answers ("this cohort runs the first six weeks"). The wire
 * has exactly one way to say absence, `Unavailability`, shared with
 * `Person.blackouts`. This function is the inversion, and it is worth its own
 * test file for two reasons that are not "the code is complicated":
 *
 *  1. **A polarity bug is silent and severe.** Inverted, every Group would be
 *     forbidden from precisely the weeks it is available and free in the rest.
 *     The solve still succeeds, every Session still gets placed, and the
 *     timetable is wrong in a way nothing reports. Note the shape: the OUTPUT
 *     looks healthy either way, which is why the assertions below name specific
 *     week indices rather than counting them.
 *  2. **The rounding direction is a decision, not arithmetic.** Weeks are the
 *     wire's granularity, so a window ending mid-week has to round somewhere. It
 *     rounds toward AVAILABLE (a partially-covered week is not blocked)
 *     because this rule is HARD and the other direction would refuse placements
 *     that are legitimately fine.
 *
 * Dates are UTC-anchored and Monday-anchored, matching `weekIndexOf`.
 */
const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/** A Monday-starting term of exactly four weeks: 5 Oct 2026 – 1 Nov 2026. */
const TERM_START = utc('2026-10-05');
const TERM_END = utc('2026-11-01');

describe('the term this file measures against', () => {
    it('is four Monday-anchored weeks, so the indices below are readable', () => {
        expect(weekCountOf(TERM_START, TERM_END)).toBe(4);
    });
});

describe('the polarity', () => {
    it('blocks the weeks AFTER an early window, not the ones inside it', () => {
        // Available weeks 0-1 (5 Oct – 18 Oct) → weeks 2 and 3 blocked.
        const blocked = blackedOutWeeks(TERM_START, TERM_END, {
            availableFrom: TERM_START,
            availableTo: utc('2026-10-18'),
        });

        expect(blocked).toEqual([2, 3]);
        // Stated as its own assertion because this is the inverted-polarity bug
        // in its exact form: the available weeks must never appear.
        expect(blocked).not.toContain(0);
        expect(blocked).not.toContain(1);
    });

    it('blocks the weeks BEFORE a late window', () => {
        const blocked = blackedOutWeeks(TERM_START, TERM_END, {
            availableFrom: utc('2026-10-19'),
            availableTo: TERM_END,
        });

        expect(blocked).toEqual([0, 1]);
    });

    it('blocks both sides of a middle window', () => {
        const blocked = blackedOutWeeks(TERM_START, TERM_END, {
            availableFrom: utc('2026-10-12'),
            availableTo: utc('2026-10-18'),
        });

        expect(blocked).toEqual([0, 2, 3]);
    });
});

describe('an open-ended window', () => {
    it('treats a missing start as "from the beginning of the term"', () => {
        expect(blackedOutWeeks(TERM_START, TERM_END, {
            availableFrom: null,
            availableTo: utc('2026-10-18'),
        })).toEqual([2, 3]);
    });

    it('treats a missing end as "to the end of the term"', () => {
        expect(blackedOutWeeks(TERM_START, TERM_END, {
            availableFrom: utc('2026-10-19'),
            availableTo: null,
        })).toEqual([0, 1]);
    });

    it('blocks nothing when both sides are open', () => {
        /*
         * Which is what an ABSENT row already means. The database forbids
         * storing this state (`group_term_availability_needs_a_bound`), so it
         * cannot arrive from a query: the function is total rather than
         * throwing because "no bounds" has an honest answer, and it is this one.
         */
        expect(blackedOutWeeks(TERM_START, TERM_END, {
            availableFrom: null,
            availableTo: null,
        })).toEqual([]);
    });
});

describe('week granularity rounds toward AVAILABLE', () => {
    it('frees the whole week a window ends mid-way through', () => {
        // Wednesday of week 1. Week 1 is FREE, not blocked: the rule is hard, and
        // blocking a week the Group attends for three days would refuse
        // placements that are fine.
        const blocked = blackedOutWeeks(TERM_START, TERM_END, {
            availableFrom: TERM_START,
            availableTo: utc('2026-10-14'),
        });

        expect(blocked).toEqual([2, 3]);
        expect(blocked, 'the partially-covered week must not be blocked').not.toContain(1);
    });

    it('frees the whole week a window starts mid-way through', () => {
        const blocked = blackedOutWeeks(TERM_START, TERM_END, {
            availableFrom: utc('2026-10-21'),
            availableTo: TERM_END,
        });

        expect(blocked).toEqual([0, 1]);
        expect(blocked, 'the partially-covered week must not be blocked').not.toContain(2);
    });
});

describe('the edges', () => {
    it('blocks nothing when the window spans the whole term', () => {
        // Legitimate, and the reason `assembleSolverInput` counts it: a tenant
        // can configure a window that narrows nothing, which is
        // indistinguishable from a broken feature unless something reports it.
        expect(blackedOutWeeks(TERM_START, TERM_END, {
            availableFrom: TERM_START,
            availableTo: TERM_END,
        })).toEqual([]);
    });

    it('blocks every week when the window falls outside the term', () => {
        /*
         * Reachable only by editing a term's dates after setting a window: the
         * write boundary clamps the inputs to the term. The honest reading of
         * "available only in April" during an autumn term IS "never available",
         * so it is not softened here; the UI's preview says so in words
         * ("Blocks every week of this term") rather than leaving a tenant to
         * discover it from an unplaceable session.
         */
        const blocked = blackedOutWeeks(TERM_START, TERM_END, {
            availableFrom: utc('2027-04-01'),
            availableTo: utc('2027-04-30'),
        });

        expect(blocked).toEqual([0, 1, 2, 3]);
    });
});
