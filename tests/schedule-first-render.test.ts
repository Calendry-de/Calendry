import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, type Fixtures, TEST_PASSWORD, ownerDb, seed, teardown } from './helpers/seed';
import { login } from './helpers/client';
import { weekCountOf } from '#shared/academicCalendar';

/**
 * What the SERVER actually renders for /schedule.
 *
 * WHY THIS SUITE EXISTS. This project has now been bitten four times by the same
 * shape: state seeded by a watcher is `undefined` at first render on the server,
 * because Vue does not flush watchers during SSR. Each time the symptom differed:
 * empty management forms, a `<select>` showing the wrong option, a hidden
 * solver control, and each time it survived review because the check asked
 * whether something EXISTED rather than what it SAID.
 *
 * The fourth was the worst: `totalWeeks` fell back to 1 on the server, so the
 * week stepper rendered `disabled="true"`. Vue patches mismatched TEXT on
 * hydration but explicitly refuses to patch mismatched ATTRIBUTES ("this
 * mismatch is check-only. The DOM will not be rectified"), so the buttons stayed
 * disabled in the live DOM and week navigation was dead on every load, while the
 * label beside them correctly read "Week 1 / 19".
 *
 * So these assertions read the markup's CONTENT: the number in the label, and
 * the absence of an attribute. A test that only checked the buttons were present
 * would have passed throughout.
 */
let f: Fixtures;
let cookie: string;

const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:8080';

async function renderSchedule(query = ''): Promise<string> {
    const res = await fetch(`${BASE}/schedule${query}`, { headers: { cookie } });

    expect(res.status).toBe(200);

    return res.text();
}

/** The week the SERVER decided to draw, read off the stepper's own label. */
function renderedWeek(html: string): number {
    const match = html.match(/weeknav_number[^>]*>\s*Week\s*(\d+)/);

    expect(match, 'no current week in the rendered page').not.toBeNull();

    return Number(match![1]);
}

function renderedTotalWeeks(html: string): number {
    const match = html.match(/weeknav_total[^>]*>\s*of\s*(\d+)/);

    expect(match, 'no week total in the rendered page').not.toBeNull();

    return Number(match![1]);
}

/** The `<button …>` open tag carrying this aria-label, attributes included. */
function buttonTag(html: string, ariaLabel: string): string {
    const match = html.match(new RegExp(`<button[^>]*aria-label="${ariaLabel}"[^>]*>`))
        ?? html.match(new RegExp(`<button[^>]*aria-label='${ariaLabel}'[^>]*>`));

    expect(match, `no <button> with aria-label="${ariaLabel}" in the rendered page`).not.toBeNull();

    return match![0];
}

/**
 * A term that STARTS ON A SATURDAY, because a Monday-start term cannot tell the
 * two week-count definitions apart.
 *
 * These are the real dates of the Wintersemester term that exposed the bug.
 * Monday-anchored counting says 13 weeks (the term's last four days fall in a
 * thirteenth Monday-week); a raw `ceil((end - start) / 7)` says 12. The suite
 * asserts that difference explicitly below, so this fixture cannot quietly stop
 * discriminating if someone edits the dates.
 *
 * Applied HERE rather than in tests/helpers/seed.ts: forty suites share that
 * fixture, and none of them needs a Saturday term. Suites run serially
 * (`fileParallelism: false`) and this file seeds and tears down its own, so the
 * change cannot reach anything else.
 */
const SATURDAY_TERM = { start: new Date('2027-10-02'), end: new Date('2027-12-23') };

beforeAll(async () => {
    f = await seed();

    await ownerDb.term.update({
        where: { id: f.termA },
        data: { startDate: SATURDAY_TERM.start, endDate: SATURDAY_TERM.end },
    });

    cookie = (await login(ACCOUNTS.adminA, TEST_PASSWORD)).cookie;
}, 60_000);

afterAll(async () => {
    await teardown();
    await ownerDb.$disconnect();
});

describe('/schedule first render', () => {
    it('renders the real week count, not the fallback of 1', async () => {
        const html = await renderSchedule();

        /*
         * The fixture term spans October to February: many weeks, never one.
         *
         * Anchored on `weeknav_total`, the class that exists only to carry this
         * number. It was `Week 1</span> / N`, which broke when the stepper moved
         * out of the toolbar and became `ScheduleWeekNav`: a positional match
         * on adjacent markup, which is exactly the kind that goes red on a
         * layout change and says nothing about the invariant. The invariant is
         * unchanged: the total is the real week count, never the fallback of 1.
         */
        const label = html.match(/weeknav_total[^>]*>\s*of\s*(\d+)/);

        expect(label, 'no week total in the rendered page').not.toBeNull();

        const totalWeeks = Number(label![1]);

        // The assertion that matters: 1 is what a null term falls back to, and
        // it is what made the stepper render itself disabled.
        expect(totalWeeks).toBeGreaterThan(1);
    });

    /**
     * THE URL IS NOW THE VIEW'S STATE, and therefore untrusted input rendered on
     * the server.
     *
     * The week, term and filters moved out of plain `ref`s and into the query
     * string so a view is shareable and survives a round trip to the proposals
     * list. That puts them in the same category as `totalWeeks` above (read
     * before first paint, on the server), so the same trap applies: whatever the
     * server writes is what the reader gets, and a week the term does not contain
     * renders an empty grid indistinguishable from a term with nothing in it.
     *
     * These read the CONTENT of the stepper's label rather than asking whether it
     * exists, for the reason this whole suite exists.
     */
    describe('week from the URL', () => {
        it('renders the week named in the query, not week 1', async () => {
            const html = await renderSchedule('?week=3');

            expect(renderedWeek(html)).toBe(3);
        });

        it('clamps a week past the end of the term to the last one', async () => {
            const html = await renderSchedule('?week=999');
            const total = renderedTotalWeeks(html);

            // Not 999, and not silently 1 either: the last week the term has.
            expect(renderedWeek(html)).toBe(total);
        });

        it.each(['?week=0', '?week=-4', '?week=abc', '?week='])(
            'falls back to week 1 for %s',
            async (query) => {
                expect(renderedWeek(await renderSchedule(query))).toBe(1);
            },
        );

        it('renders week 1 with no query at all', async () => {
            expect(renderedWeek(await renderSchedule())).toBe(1);
        });
    });

    it('does NOT render the next-week button as disabled', async () => {
        const html = await renderSchedule();

        // Vue will not rectify this attribute on hydration, so whatever the
        // server writes here is what the user is stuck with.
        expect(buttonTag(html, 'Next week')).not.toContain('disabled');
    });

    it('does render the previous-week button as disabled on week 1', async () => {
        const html = await renderSchedule();

        // The counter-example, so the test above cannot pass by the buttons
        // simply never being disabled: at week 1, going back IS unavailable.
        expect(buttonTag(html, 'Previous week')).toContain('disabled');
    });

    /**
     * THE WEEK COUNT IS `weekCountOf`, NOT A LOCAL FORMULA.
     *
     * `app/composables/schedule.ts` used to export `weeksInTerm`, computing the
     * raw span `ceil((end - start) / 7)`. That disagrees with the Monday-anchored
     * `weekCountOf` (which the week classifier, the solver calendar assembly and
     * `POST /api/sessions` all use) on roughly half of all terms, always by one.
     *
     * The toolbar was the only reader of the local version, so the schedule
     * capped a term one week SHORT of what the server accepts: measured on this
     * exact term, the toolbar said "Week 1 / 12" and disabled the next-week
     * button there, while the API happily created a session in week 13 that the
     * UI could then never display.
     *
     * This is the shape that silently regresses, because a Monday-start term
     * makes both formulas agree and any test using one would pass either way.
     */
    it('counts weeks the way weekCountOf does, on a term where the old formula differed', async () => {
        const expected = weekCountOf(SATURDAY_TERM.start, SATURDAY_TERM.end);

        /*
         * The guard that keeps this test honest. If someone changes the dates
         * above to a term where the two definitions agree, this fails loudly
         * instead of the suite quietly ceasing to discriminate.
         */
        const rawSpan = Math.max(1, Math.ceil(
            (SATURDAY_TERM.end.getTime() - SATURDAY_TERM.start.getTime()) / (7 * 24 * 60 * 60 * 1000),
        ));

        expect(rawSpan, 'the fixture term must be one where the two definitions disagree')
            .not.toBe(expected);

        const html = await renderSchedule();
        const label = html.match(/weeknav_total[^>]*>\s*of\s*(\d+)/);

        expect(label, 'no week total in the rendered page').not.toBeNull();
        expect(Number(label![1])).toBe(expected);
    });

    it('names the selected term in the toolbar rather than falling back', async () => {
        const html = await renderSchedule();

        // Same class of bug, different symptom: `<select>` needs :selected on
        // its options because `value` is a property SSR drops.
        expect(html).toContain('selected');
        expect(html).toContain(f.termA);
    });
});
