import { describe, expect, it } from 'vitest';
import {
    CONTACT_EMAIL,
    landingBuilt,
    landingFeatures,
    landingNext,
    landingPrinciples,
    landingTechLead,
    landingTechnicalNotes,
} from '../app/utils/landingContent';
import { englishT } from './helpers/landingMessages';

/**
 * The public landing page at `/`: it renders for a visitor with no session, and
 * what it claims stays consistent with `app/utils/landingContent.ts`, which is
 * the single source of those claims.
 *
 * TWO KINDS OF CHECK, BOTH NEEDED.
 *
 * 1. RENDER. Every other page in this app is behind auth, so this one exercises a
 *    path nothing else does: a page fetched with no cookie at all. Fetching it
 *    is not enough: a 200 with an empty body is exactly what a blanked page
 *    returns (see tests/page-renders-per-role.test.ts), so every assertion here
 *    names content that only exists once the page actually composed.
 *
 * 2. DRIFT. A marketing page is prose, and prose is checked by nobody. That is the
 *    failure this repository has hit repeatedly. So the roadmap's claims are not
 *    prose: they are `app/utils/landingContent.ts`, and the page is asserted to
 *    render exactly it. See the long note above the roadmap block for what that
 *    guarantees now and what it stopped guaranteeing when `BACKLOG.md` was
 *    retired. The honest answer is "less", and it is written down there rather
 *    than left for somebody to assume.
 */
const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:8080';

/**
 * The page's claims, resolved to the SENTENCES the page actually serves.
 *
 * Issue #19 moved the copy out of `landingContent.ts` and into
 * `i18n/locales/en/landing.json`; the module kept the ids, the reading order,
 * the done/next state and the clusters, and each list is now a builder taking a
 * `Translate`. So this file has two sources instead of one, and it has to read
 * both or it stops being a drift check:
 *
 *   - `englishT` resolves against the English catalogue, so `item.title` below
 *     is still a real sentence and `expect(html).toContain(item.title)` still
 *     compares the served page against the authored copy, character for
 *     character. `tests/helpers/setup.ts` forces `Accept-Language: en-GB`, so
 *     the page under test is rendering this same tree.
 *   - the builders supply the structure, so a row deleted, reordered, moved
 *     between lists or given the wrong state still fails here.
 *
 * The `(key) => key` stub `i18n/CONVENTIONS.md` recommends for structural
 * tests would have been the easy move and would have gutted the suite: it
 * asserts rendered HTML, and HTML contains sentences, not key names. See
 * `tests/helpers/landingMessages.ts`.
 */
const FEATURES = landingFeatures(englishT);
const BUILT = landingBuilt(englishT);
const NEXT = landingNext(englishT);
const PRINCIPLES = landingPrinciples(englishT);
const TECHNICAL_NOTES = landingTechnicalNotes(englishT);
const TECH_LEAD = landingTechLead(englishT);

async function page(path: string) {
    const res = await fetch(`${BASE}${path}`, { redirect: 'manual' });

    return { status: res.status, location: res.headers.get('location'), html: await res.text() };
}

describe('reachability without a session', () => {
    it('serves the domain root to a visitor with no cookie, without redirecting', async () => {
        const res = await page('/');

        expect(res.status).toBe(200);
        expect(res.location).toBeNull();
    });

    it('is linked from the login page, so someone bounced there can read it', async () => {
        // Reachability of `/` itself is inherent: it is the domain root. This
        // link is the reverse path: an anonymous visitor sent to /login by a deep
        // link needs a way back to what the product actually is.
        const res = await page('/login');

        expect(res.status).toBe(200);
        expect(res.html).toContain('class="login_link"');
        expect(res.html).toContain('href="/"');
    });

    it('renders WITHOUT the app chrome: no menu, no command palette trigger', async () => {
        const res = await page('/');

        // Paired with a positive assertion on purpose: "the header is absent"
        // also passes for a page that failed to render at all.
        expect(res.html).toContain('In active development');
        expect(res.html).not.toContain('aria-label="Search');
        expect(res.html).not.toContain('aria-label="Main"');
    });
});

describe('the page states what it is', () => {
    it('carries the hero, the status badge and both calls to action', async () => {
        const { html } = await page('/');

        expect(html).toContain('Timetabling for schools and universities.');
        expect(html).toContain('In active development');
        expect(html).toContain('Get in touch');
        expect(html).toContain('See what works today');
    });

    it('renders a title and description a search engine can read', async () => {
        const { html } = await page('/');

        // The whole tag, not a fragment: the layout's titleTemplate appends the
        // product name, and asserting only the page's half is how a page ends up
        // titled "Calendry: … | Calendry" with a green test.
        expect(html).toContain('<title>Timetabling for schools and universities | Calendry</title>');
        // The CONTENT, not just the attribute: useLayout() registers a
        // description of its own with an empty string, so "a description tag
        // exists" would pass over an empty one.
        expect(html).toContain('content="Calendry is a multi-tenant timetabling platform');
    });

    it('wraps its content in a main landmark', async () => {
        const { html } = await page('/');

        // The whole app had no <main> anywhere. On a page with a sticky bar and
        // a footer, the content needs a landmark to be skippable at all.
        expect(html).toContain('<main');
    });

    it('does not stamp the developer build version over the marketing copy', async () => {
        const { html } = await page('/');

        // `ViewVersion` is position: fixed at z-index 10000. On this page it
        // pinned "v0.0.1" in the corner permanently, duplicating the hero
        // badge's deliberate statement with a bare number a stranger reads as
        // "this does not exist yet". Still present on /login, asserted below.
        expect(html).not.toContain('class="version"');
        expect(html).toContain('In active development');
    });

    it('keeps the version stamp on the other pages that layout serves', async () => {
        // The counterpart assertion: the gate is route-specific, not a deletion.
        const { html } = await page('/login');

        expect(html).toContain('class="version"');
    });

    it('renders the hero figure, the one place the product is visible', async () => {
        const { html } = await page('/');

        // A timetabling page with no timetable on it was the critique's first
        // finding. The figure is drawn from the schedule's own geometry, so
        // these are its cells, its session chips and its placement targets.
        expect(html).toContain('grid_cell');
        expect(html).toContain('grid_chip');
        expect(html).toContain('grid_target');
    });

    it('leads the technical band with the measured figure', async () => {
        const { html } = await page('/');

        expect(html).toContain(TECH_LEAD.figure);
    });

    it('puts the form BEFORE the section that tells a registrar to skip it', async () => {
        const { html } = await page('/');

        // Reading order is the argument. "Under the hood" opens by telling a
        // timetabling officer to skip it, and it used to sit between her and
        // the form, so the last thing she read before the CTA was addressed to
        // somebody else, followed by "Calendry cannot send mail yet".
        expect(html.indexOf('id="contact"')).toBeLessThan(html.indexOf('id="under-the-hood"'));
        expect(html.indexOf('id="contact"')).toBeGreaterThan(-1);
    });

    it('offers a way to act without scrolling back to the top', async () => {
        const { html } = await page('/');

        // There were two conversion affordances in 1,500 words, both in the
        // hero. The sticky bar and the mid-page callout are the other two.
        expect(html).toContain('topbar');
        expect(html).toContain('callout_text');
    });

    it('carries link-preview metadata, because that is how the page gets forwarded', async () => {
        const { html } = await page('/');

        expect(html).toContain('property="og:title"');
        expect(html).toContain('property="og:description"');
        expect(html).toContain('name="twitter:card"');
    });

    it('renders every section', async () => {
        const { html } = await page('/');

        for (const id of ['what', 'built', 'next', 'why', 'under-the-hood', 'contact']) {
            expect(html, `section #${id} is missing`).toContain(`id="${id}"`);
        }
    });

    it.each([
        ['what it does', FEATURES],
        ['built so far', BUILT],
        ['what is next', NEXT],
        ['why it works this way', PRINCIPLES],
        ['under the hood', TECHNICAL_NOTES],
    ])('renders every %s entry', async (_label, items) => {
        const { html } = await page('/');

        for (const item of items) {
            expect(html, `${item.title} did not render`).toContain(item.title);
        }
    });

    it('marks built and unbuilt items differently for a screen reader, not by colour alone', async () => {
        const { html } = await page('/');

        expect(html).toContain('Working: ');
        expect(html).toContain('Not built yet: ');
    });
});

describe('the contact capture is wired to something real', () => {
    it('renders the form and the address as text, not a dead Sign up button', async () => {
        const { html } = await page('/');

        expect(html).toContain('Open an email to us');
        expect(html).toContain(`mailto:${CONTACT_EMAIL}`);
        expect(html).toContain(CONTACT_EMAIL);
        // A page with no signup backend must not render a signup affordance.
        expect(html).not.toContain('Sign up');
        expect(html).not.toContain('Start free trial');
    });

    it('says why it is an email rather than implying delivery it cannot do', async () => {
        const { html } = await page('/');

        expect(html).toContain('no self-service sign-up');
    });
});

describe('no fabricated social proof', () => {
    it('claims no customers, quotes or user counts', async () => {
        const { html } = await page('/');

        for (const phrase of ['Trusted by', 'trusted by', 'testimonial', 'Loved by', 'customers worldwide']) {
            expect(html, `found fabricated social proof: ${phrase}`).not.toContain(phrase);
        }
    });
});

/**
 * The drift guard, and what it can and cannot promise since 2026-08-28.
 *
 * IT USED TO CROSS-CHECK TWO INDEPENDENT SOURCES: `BACKLOG.md`'s phase checklist
 * against what this page presents as unbuilt. Tick a box without touching the
 * page and the test failed, naming the mismatch. That is a genuinely strong
 * property: the page could not advertise a gap that had closed.
 *
 * `BACKLOG.md` was retired in favour of a GitHub project board, which nothing
 * offline can read: querying it would put a network call and a secret into the
 * test suite. So THE CROSS-CHECK IS GONE, and it is worth being blunt about the
 * consequence rather than pretending the replacement is equivalent.
 *
 * WHAT STILL HOLDS: `app/utils/landingContent.ts` is the single source of the
 * page's claims, the page is asserted to render exactly it, ids are unique, and
 * each list's items carry the state that list means. So the PAGE cannot drift
 * from the CONTENT MODULE.
 *
 * WHAT NO LONGER HOLDS: nothing catches the content module drifting from
 * reality. If import ships and `NEXT` still lists it, this suite stays green and
 * the landing page lies. That is now a human step (moving a card to Done on the
 * board means editing `NEXT`/`BUILT` in the same change), and it is stated in
 * CLAUDE.md as a rule because a test can no longer state it.
 */
describe('the roadmap is internally consistent', () => {
    it('has roadmap content at all: the guard must not pass by finding nothing', () => {
        // Without this, an emptied or renamed export would make every assertion
        // below pass over nothing: the "correctly found nothing / broken and
        // found nothing" failure CLAUDE.md warns about.
        expect(BUILT.length).toBeGreaterThan(5);
        expect(NEXT.length).toBeGreaterThan(0);
    });

    it('presents every NEXT item on the page, and none of them as built', () => {
        const doneIds = new Set(BUILT.map((item) => item.id));

        for (const item of NEXT) {
            expect(doneIds.has(item.id), `${item.id} appears in both lists`).toBe(false);
            expect(item.title.length, `${item.id} has no title to render`).toBeGreaterThan(0);
        }
    });

    it('keeps every roadmap item in the state its list means', () => {
        expect(BUILT.every((item) => item.state === 'done')).toBe(true);
        expect(NEXT.every((item) => item.state === 'next')).toBe(true);
    });

    it('uses each id once across both lists', () => {
        const ids = [...BUILT, ...NEXT].map((item) => item.id);

        expect(new Set(ids).size).toBe(ids.length);
    });
});
