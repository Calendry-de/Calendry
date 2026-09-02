import { describe, expect, it } from 'vitest';
import {
    CONTACT_EMAIL,
    REPO_LABEL,
    landingBenefits,
    landingBuilt,
    landingCtaTarget,
    landingFaq,
    landingNext,
    landingPrinciples,
    landingProblem,
    landingSteps,
    landingTagline,
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
 *
 * A THIRD KIND ARRIVED WITH THE REBUILD: the page is now built to a design
 * system with rules a test can actually hold it to. "Exactly one primary
 * action", "the closing action is the same as the hero's", "the FAQ's
 * structured data describes the questions the page renders" are all mechanical,
 * and all three are the kind of rule that decays silently the moment somebody
 * adds a section. They are asserted below rather than left in a comment.
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
const PROBLEM = landingProblem(englishT);
const BENEFITS = landingBenefits(englishT);
const STEPS = landingSteps(englishT);
const BUILT = landingBuilt(englishT);
const NEXT = landingNext(englishT);
const PRINCIPLES = landingPrinciples(englishT);
const TECHNICAL_NOTES = landingTechnicalNotes(englishT);
const TECH_LEAD = landingTechLead(englishT);
const FAQ = landingFaq(englishT);
const TAGLINE = landingTagline(englishT);

/**
 * The label the page's single action actually carries.
 *
 * Derived rather than written out, because it FLIPS: with no scheduling link
 * configured `landingCtaTarget()` degrades to the mailbox and the button says
 * "ask for a walkthrough" instead of "book" one. A hardcoded string here would
 * turn configuring `BOOKING_URL` into a test failure, which is exactly
 * backwards.
 */
const CTA_TARGET = landingCtaTarget();
const CTA_LABEL = CTA_TARGET.booking
    ? englishT('landing.action.bookWalkthrough')
    : englishT('landing.action.askForWalkthrough');

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
    it('carries the hero: badge, both authored headline lines, the lead and the proof line', async () => {
        const { html } = await page('/');

        expect(html).toContain('In active development');
        // BOTH lines. The headline's break is authored, so asserting one half
        // passes over a hero that lost the other.
        expect(html).toContain(englishT('landing.hero.titleLineOne'));
        expect(html).toContain(englishT('landing.hero.titleLineTwo'));
        expect(html).toContain(englishT('landing.hero.lead'));
        expect(html).toContain(englishT('landing.hero.proof'));
    });

    it('renders a title and description a search engine can read', async () => {
        const { html } = await page('/');

        // The whole tag, not a fragment: the layout's titleTemplate appends the
        // product name, and asserting only the page's half is how a page ends up
        // titled "Calendry: … | Calendry" with a green test.
        expect(html).toContain(`<title>${englishT('landing.meta.title')} | Calendry</title>`);
        // The CONTENT, not just the attribute: useLayout() registers a
        // description of its own with an empty string, so "a description tag
        // exists" would pass over an empty one.
        expect(html).toContain(`content="${englishT('landing.meta.description')}"`);
    });

    it('asks to be indexed, because this page is an evergreen offer', async () => {
        const { html } = await page('/');

        // Stated rather than left to the default, so that a campaign page added
        // later has to make the opposite decision on purpose.
        expect(html).toContain('name="robots"');
        expect(html).toContain('content="index, follow"');
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

    it('renders the hero figure, the one place the product is visible above the fold', async () => {
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

    it('carries link-preview metadata, because that is how the page gets forwarded', async () => {
        const { html } = await page('/');

        expect(html).toContain('property="og:title"');
        expect(html).toContain('property="og:description"');
        expect(html).toContain('name="twitter:card"');
    });

    it('renders every section', async () => {
        const { html } = await page('/');

        const ids = [
            'problem', 'benefits', 'how', 'built',
            'roadmap', 'why', 'technical', 'faq', 'talk', 'contact',
        ];

        for (const id of ids) {
            expect(html, `section #${id} is missing`).toContain(`id="${id}"`);
        }
    });

    it.each([
        ['problem and solution', PROBLEM],
        ['benefit', BENEFITS],
        ['how it works step', STEPS],
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

/**
 * The design system's structural rules, as assertions.
 *
 * These are the ones that decay silently. A second primary button, a closing
 * action that drifted from the hero's, an FAQ whose structured data still
 * describes a question somebody deleted: every one of them looks fine in a
 * diff and is only visible from the rendered page.
 */
describe('one offer, one audience, one action', () => {
    it('renders the primary action exactly twice, in the hero and at the close', async () => {
        const { html } = await page('/');

        // The element, counted. `LandingCta` is one component rendered in two
        // places by rule, so three occurrences means somebody added a third
        // call to action and two means one of them stopped rendering.
        expect(html.split('class="cta"').length - 1).toBe(2);
    });

    it('points every call to action at the same place', async () => {
        const { html } = await page('/');

        expect(html).toContain(CTA_LABEL);
        expect(html).toContain(CTA_TARGET.href);
    });

    it('offers no competing action above the fold', async () => {
        const { html } = await page('/');

        // The hero's old second button. A landing page gets one primary action,
        // and the section this pointed at is still reachable from the nav.
        expect(html).not.toContain('See what works today');
    });

    it('carries no dead links', async () => {
        const { html } = await page('/');

        // A button or anchor pointing at `#` is either unlinked or a visually
        // disabled control pretending to be live. Neither belongs on the page.
        expect(html).not.toContain('href="#"');
    });

    it('states what the reader is not risking, under both actions', async () => {
        const { html } = await page('/');

        expect(html).toContain(englishT('landing.risk.line'));
    });

    it('renders the tagline reveal as words, fully lit before any script runs', async () => {
        const { html } = await page('/');

        // Every word of both lines, and the whole sentence on the section's
        // label. The reveal mutes the words only once it has mounted and
        // decided it can animate, so the SERVED html must be legible: a
        // JavaScript failure must not leave the page's largest sentence at 30%
        // contrast. That is what the absent `--armed` class below proves.
        for (const word of `${TAGLINE.lineOne} ${TAGLINE.lineTwo}`.split(/\s+/u)) {
            expect(html, `tagline word "${word}" did not render`).toContain(word);
        }

        expect(html).toContain('tagline_word');
        expect(html).not.toContain('tagline_measure--armed');
    });
});

describe('the FAQ answers objections and says so to a search engine', () => {
    it('renders every question and every answer', async () => {
        const { html } = await page('/');

        for (const entry of FAQ) {
            expect(html, `question ${entry.id} did not render`).toContain(entry.question);
            expect(html, `answer ${entry.id} did not render`).toContain(entry.answer);
        }
    });

    it('has enough of them to be an objection list rather than a gesture', () => {
        // The guard must not pass by finding nothing: an emptied export would
        // make the assertions above iterate over an empty array and succeed.
        expect(FAQ.length).toBeGreaterThanOrEqual(6);
    });

    it('opens on the two objections that lose the sale, not on the easy ones', () => {
        // Order is editorial and load bearing. "Can it run our term" and "can
        // it take our spreadsheets" are the questions a reader actually arrives
        // with, and both are answered with a no or a partial no.
        expect(FAQ[0]?.id).toBe('runTerm');
        expect(FAQ[1]?.id).toBe('import');
    });

    it('publishes structured data describing exactly the questions it renders', async () => {
        const { html } = await page('/');

        expect(html).toContain('application/ld+json');
        expect(html).toContain('FAQPage');

        // The schema is built from the same array as the markup, so this
        // catches the case the two were ever allowed to diverge.
        for (const entry of FAQ) {
            const escaped = JSON.stringify(entry.question).slice(1, -1);

            expect(html, `question ${entry.id} is missing from the FAQ schema`).toContain(escaped);
        }
    });

    it('starts with every row closed', async () => {
        const { html } = await page('/');

        // An FAQ with a row already open is a paragraph pretending to be a
        // list, and it pushes the rest of the rows out of the section.
        expect(html).not.toContain('<details open');
        expect(html).not.toContain('open=""');
    });
});

describe('reading order is the argument', () => {
    it('proves the product before admitting the gaps', async () => {
        const { html } = await page('/');

        // A roadmap read before the evidence is a list of things that do not
        // work. `built` has to come first.
        expect(html.indexOf('id="built"')).toBeGreaterThan(-1);
        expect(html.indexOf('id="built"')).toBeLessThan(html.indexOf('id="roadmap"'));
    });

    it('earns the solution before describing it, and ties it together after', async () => {
        const { html } = await page('/');

        expect(html.indexOf('id="problem"')).toBeLessThan(html.indexOf('id="benefits"'));
        expect(html.indexOf('id="benefits"')).toBeLessThan(html.indexOf('id="how"'));
    });

    it('handles the objections before it asks for the click', async () => {
        const { html } = await page('/');

        expect(html.indexOf('id="faq"')).toBeLessThan(html.indexOf('id="talk"'));
    });

    it('offers a way to act without scrolling back to the top', async () => {
        const { html } = await page('/');

        // The floating bar carries the action on every screen, which on a phone
        // is the only navigation the page has.
        expect(html).toContain('topbar');
        expect(html).toContain('topbar_toggle');
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

        expect(html).toContain('no sign up you can do yourself');
    });
});

describe('no fabricated content', () => {
    it('claims no customers, quotes or user counts', async () => {
        const { html } = await page('/');

        for (const phrase of ['Trusted by', 'trusted by', 'testimonial', 'Loved by', 'customers worldwide']) {
            expect(html, `found fabricated social proof: ${phrase}`).not.toContain(phrase);
        }
    });

    it('says the code is readable without calling an unlicensed repository open source', async () => {
        const { html } = await page('/');

        // The repository is public and carries no licence, so every right is
        // reserved: a reader may read it and may not reuse it. "Open source" is
        // the one overclaim this page's whole argument cannot afford.
        expect(html).toContain(REPO_LABEL);
        expect(html).not.toContain('open source');
        expect(html).not.toContain('Open source');
    });

    it('carries none of the filler that marks a page as generated rather than written', async () => {
        const { html } = await page('/');

        // Placeholder copy, invented brands and the stock intensifiers. Each of
        // these is a tell, and each has a way of arriving in a hurry.
        const tells = [
            'Lorem ipsum', 'lorem ipsum', 'John Doe', 'Jane Doe',
            'Acme', 'Nexus', 'SmartFlow',
            'Elevate', 'Seamless', 'seamless', 'Unleash',
            'Next Gen', 'next-gen', 'game changer', 'game-changer',
            'Delve', 'tapestry', 'In the world of',
        ];

        for (const tell of tells) {
            expect(html, `found generated-page filler: ${tell}`).not.toContain(tell);
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

    it('pairs a figure with every benefit that describes behaviour, and none that does not', () => {
        // Four of the five benefits describe something a schedule DOES, and a
        // moving timetable states those better than a sentence can. Isolation
        // is a drawing of nothing happening, so it runs as prose. This is the
        // rule `index.vue` states; without it, adding a benefit silently either
        // loses its figure or gives one to a claim that cannot be drawn.
        const withFigure = BENEFITS.filter((item) => item.figure !== undefined);

        expect(withFigure.length).toBe(4);
        expect(new Set(withFigure.map((item) => item.figure)).size).toBe(4);
        expect(BENEFITS.find((item) => item.id === 'isolation')?.figure).toBeUndefined();
    });

    it('numbers the how-it-works steps from their position, so there are exactly three', () => {
        expect(STEPS.length).toBe(3);
        expect(new Set(STEPS.map((step) => step.id)).size).toBe(3);
    });
});
