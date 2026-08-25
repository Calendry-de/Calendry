import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUILT, CONTACT_EMAIL, FEATURES, NEXT, PRINCIPLES, TECHNICAL_NOTES, TECH_LEAD } from '../app/utils/landingContent';

/**
 * The public landing page at `/`: it renders for a visitor with no session, and
 * what it claims still matches BACKLOG.md.
 *
 * TWO KINDS OF CHECK, BOTH NEEDED.
 *
 * 1. RENDER. Every other page in this app is behind auth, so this one exercises a
 *    path nothing else does: a page fetched with no cookie at all. Fetching it
 *    is not enough — a 200 with an empty body is exactly what a blanked page
 *    returns (see tests/page-renders-per-role.test.ts), so every assertion here
 *    names content that only exists once the page actually composed.
 *
 * 2. DRIFT. A marketing page is prose, and prose is checked by nobody — the
 *    failure this repository has hit repeatedly. So the honesty of the roadmap is
 *    pinned mechanically: the unchecked entries in BACKLOG.md's phase checklist
 *    are read from the file and compared against what the page presents as "not
 *    built". Tick a box in BACKLOG without touching the page and this fails.
 */
const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:8080';

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
        // Reachability of `/` itself is inherent — it is the domain root. This
        // link is the reverse path: an anonymous visitor sent to /login by a deep
        // link needs a way back to what the product actually is.
        const res = await page('/login');

        expect(res.status).toBe(200);
        expect(res.html).toContain('class="login_link"');
        expect(res.html).toContain('href="/"');
    });

    it('renders WITHOUT the app chrome — no menu, no command palette trigger', async () => {
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
        // titled "Calendry — … | Calendry" with a green test.
        expect(html).toContain('<title>Timetabling for schools and universities | Calendry</title>');
        // The CONTENT, not just the attribute — useLayout() registers a
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

    it('renders the hero figure — the one place the product is visible', async () => {
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
        // the form — so the last thing she read before the CTA was addressed to
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
 * The drift guard. This is the assertion most likely to fail years from now, and
 * failing is what it is for.
 *
 * The map is the claim: these are the phase-checklist entries BACKLOG.md marks as
 * NOT done, and this is the landing-page item each one is presented as. If the
 * checklist changes on either side — a box ticked, a new phase added — the first
 * assertion fails and names the mismatch, rather than the page quietly
 * advertising a gap that closed or hiding one that opened.
 */
const UNCHECKED_TO_LANDING: Record<string, string> = {
    'Import (CSV/Excel)': 'import',
    'Export (iCal/Google/Outlook)': 'export',
    'Notifications (delivery; audience resolution already exists)': 'notifications',
};

function phaseChecklist(): { checked: string[]; unchecked: string[] } {
    const backlog = readFileSync(join(import.meta.dirname, '..', 'BACKLOG.md'), 'utf8');
    const section = backlog.split('## Current phase')[1]?.split('\n---')[0] ?? '';
    const checked: string[] = [];
    const unchecked: string[] = [];

    // Only the top-level checklist lines: continuation lines are indented.
    for (const line of section.split('\n')) {
        const match = /^- \[([ x])\] (.+)$/.exec(line);

        if (!match) {
            continue;
        }

        // Bold markers and trailing em-dash detail are formatting, not the title.
        const title = (match[2] as string).replace(/\*\*/g, '').trim();

        (match[1] === 'x' ? checked : unchecked).push(title);
    }

    return { checked, unchecked };
}

describe('the roadmap still matches BACKLOG.md', () => {
    it('reads the phase checklist at all — the guard must not pass by finding nothing', () => {
        const { checked, unchecked } = phaseChecklist();

        // Without this, a renamed heading would make every assertion below pass
        // over an empty list: the "correctly found nothing / broken and found
        // nothing" failure CLAUDE.md warns about.
        expect(checked.length).toBeGreaterThan(5);
        expect(unchecked.length).toBeGreaterThan(0);
    });

    it('presents exactly the unfinished checklist entries as unfinished', () => {
        const { unchecked } = phaseChecklist();

        expect(unchecked.sort()).toEqual(Object.keys(UNCHECKED_TO_LANDING).sort());
    });

    it('carries a "next" item for each unfinished entry, and never a "done" one', () => {
        const doneIds = new Set(BUILT.map((item) => item.id));

        for (const [entry, landingId] of Object.entries(UNCHECKED_TO_LANDING)) {
            const item = NEXT.find((candidate) => candidate.id === landingId);

            expect(item, `${entry} has no roadmap item on the page`).toBeTruthy();
            expect(doneIds.has(landingId), `${entry} is advertised as built`).toBe(false);
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
