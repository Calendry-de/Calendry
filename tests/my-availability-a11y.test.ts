import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, TEST_PASSWORD, seed, teardown } from './helpers/seed';
import { api, login } from './helpers/client';

/**
 * The `/my` self-service pages, pinned at the accessibility facts that were
 * measured at ZERO and must never return to it.
 *
 * WHY THIS FILE EXISTS. Two WCAG Level A failures shipped here and neither was
 * visible in a screenshot, a code review, or the bundled design detector (which
 * returned 0 findings on these files, twice):
 *
 * 1. `AvailabilityBlockPicker` set `display: none` on its checkbox, which removes
 *    a control from the focus order AND the accessibility tree. All eight block
 *    toggles were unreachable by keyboard on both pages, and the block axis is
 *    the only way to say "not this time of day", so the sole window a keyboard
 *    user could express was the whole day, the most destructive one.
 * 2. The mode switcher was two bare `<button>`s whose only difference was a CSS
 *    class: no role, no `aria-selected`, no `aria-controls`, no `tabindex`.
 *
 * Both look perfect rendered. That is the whole problem, and it is the repo's
 * "guards must fail loudly" rule in its most literal form, so the guard is a
 * test, not a comment.
 *
 * ONE CHECK IS SOURCE-LEVEL, deliberately. `display: none` is a CSS fact and
 * cannot be seen in served HTML, so pinning it needs to read the component. It is
 * narrow on purpose: it asserts one declaration inside one rule, not a stylesheet
 * snapshot.
 */
const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:8080';

/** The `id` a tab's open tag carries, so a panel can be checked against it. */
function tabId(tag: string): string {
    return /id="([^"]+)"/.exec(tag)?.[1] ?? '';
}

/** `adminA` holds every permission in tenant A, which includes `availability.manage_own`. */
let cookie = '';

/**
 * The page's RENDERED markup, with template comments removed.
 *
 * Vue serves `<!-- -->` template comments in development, and this repo comments
 * its templates heavily, including comments that quote the very attributes and
 * sentences these tests look for. An assertion that matched a comment would pass
 * while the feature was broken, and one that forbade a string would fail because
 * the string appears in prose EXPLAINING it. Both happened while writing this
 * file. Stripping them means every assertion below is about what a browser
 * actually renders.
 */
async function page(path: string): Promise<string> {
    const res = await fetch(`${BASE}${path}`, { headers: { cookie } });

    expect(res.status).toBe(200);

    return (await res.text()).replace(/<!--[\s\S]*?-->/g, '');
}

beforeAll(async () => {
    await seed();
    cookie = (await login(ACCOUNTS.adminA, TEST_PASSWORD)).cookie;
});

afterAll(teardown);

describe('the block picker is operable', () => {
    it('does not hide its checkbox, so the control keeps its focus and its a11y node', () => {
        const source = readFileSync(
            join(import.meta.dirname, '../app/components/availability/AvailabilityBlockPicker.vue'),
            'utf8',
        );

        // The rule that governs the input inside a block chip, up to its close.
        const itemRule = /&_item\s*\{[\s\S]*?\n {4}\}/.exec(source);

        expect(itemRule, 'the `.blocks_item` rule should exist').not.toBeNull();

        const inputRule = /input\s*\{([\s\S]*?)\}/.exec(itemRule![0]);

        expect(inputRule, 'the chip should still style its own input').not.toBeNull();
        expect(
            inputRule![1],
            'display:none takes the checkbox out of the tab order and the accessibility tree',
        ).not.toMatch(/display\s*:\s*none/);
    });

    /*
     * On /my/preferences, which is now the picker's only caller:
     * /my/availability paints its window on a week grid instead.
     */
    it('names its group with a fieldset and legend rather than a loose span', async () => {
        const html = await page('/my/preferences');

        expect(html).toContain('<fieldset');
        expect(html).toMatch(/<legend[^>]*>Preferred blocks<\/legend>/);
    });

    it('renders one checkbox per block in the tenant grid', async () => {
        const html = await page('/my/preferences');
        const boxes = html.match(/type="checkbox"/g) ?? [];

        // 7 weekdays + 8 blocks for the fixture grid (blocksPerDay: 8).
        expect(boxes.length).toBe(15);
    });
});

describe('the mode switcher is a complete tablist', () => {
    it('wires every tab to a panel that exists and names it back', async () => {
        const html = await page('/my/availability');

        expect(html).toContain('role="tablist"');

        const tabs = [...html.matchAll(/<button[^>]*role="tab"[^>]*>/g)].map((m) => m[0]);

        expect(tabs.length, 'both modes should be tabs').toBe(2);

        for (const tab of tabs) {
            expect(tab, 'a tab must report its selected state').toMatch(/aria-selected="(true|false)"/);
            expect(tab, 'a tab must be reachable or explicitly skipped').toMatch(/tabindex="(0|-1)"/);

            const controls = /aria-controls="([^"]+)"/.exec(tab);

            expect(controls, 'a tab must point at its panel').not.toBeNull();

            const panelId = controls![1]!;

            /*
             * The PANEL's own open tag, not the first mention of the id: the
             * tab's `aria-controls` carries the same string and comes first in
             * the document, which is what an earlier version of this assertion
             * matched instead.
             */
            const panel = [...html.matchAll(/<section[^>]*>/g)]
                .map((m) => m[0])
                .find((tag) => tag.includes(`id="${panelId}"`));

            // Only the ACTIVE panel is rendered, which is valid for tabs; when it
            // is present it must actually be a tabpanel labelled by its own tab.
            if (panel) {
                expect(panel, `panel ${panelId} must be a tabpanel`).toContain('role="tabpanel"');
                expect(panel).toContain(`aria-labelledby="${tabId(tab)}"`);
            }
        }
    });

    it('has exactly one selected tab', async () => {
        const html = await page('/my/availability');
        const selected = html.match(/aria-selected="true"/g) ?? [];

        expect(selected.length).toBe(1);
    });
});

describe('state changes are announced', () => {
    it('ships live regions that exist before they have anything to say', async () => {
        const html = await page('/my/availability');

        // Present in the DOM unpopulated: a region inserted at the same moment as
        // its text may never be observed, because the node was not there to watch.
        expect((html.match(/role="status"/g) ?? []).length).toBeGreaterThanOrEqual(2);
    });
});

describe('the form does not accuse the visitor before they act', () => {
    it('withholds the total-blackout warning on an untouched form', async () => {
        const html = await page('/my/availability');

        /*
         * `wouldBlockEverything` is true for an UNTOUCHED form, because both
         * drafts start empty, so this page used to open with an amber warning
         * above a disabled submit, reporting a mistake the visitor had not had
         * the chance to make.
         *
         * The requirement is still stated (a disabled button with no reason is
         * the same failing from the other side), but neutrally until the person
         * has actually emptied both axes themselves.
         */
        /*
         * The precondition is stated ONCE, beside the grid, and the disabled
         * button names it, rather than a second sentence under the form saying
         * the same thing, which is how a message stops being read.
         */
        expect(html).toContain('choose one corner of the week, then the opposite one');

        /*
         * And that the gesture REPEATS. One window is one rectangle, but a real
         * week is rarely one rectangle: the first version of the painter held a
         * single draft, so a second drag silently replaced the first and only
         * one entry could ever be submitted.
         */
        expect(html).toContain('Repeat for as many separate times as you need');
        expect(html).toMatch(/aria-describedby="painter-status"/);
        expect(html).toContain('id="painter-status"');

        /*
         * And the total blackout is no longer merely discouraged, it is
         * UNREPRESENTABLE: a painted rectangle is always at least one cell, so
         * the axes that could both be empty no longer exist on this page.
         */
        expect(html).not.toContain('never available at all');
    });
});

describe('the week painter is the tenant\'s own week', () => {
    it('offers exactly the teaching days and blocks the grid defines', async () => {
        const html = await page('/my/availability');

        expect(html).toContain('role="grid"');

        // The fixture grid is 8 blocks × 5 active days.
        const paintable = html.match(/class="painter_cell"/g) ?? [];

        expect(paintable.length).toBe(40);

        /*
         * A break band is never paintable: it has no block index, so a cell
         * there could not be stored and offering one would be an affordance that
         * silently does nothing.
         *
         * Asserted as an INVARIANT rather than a count. The count is a property
         * of the tenant, not of the code: this fixture declares no break
         * overrides and so has no bands at all, while the development tenant has
         * two. An earlier version of this test hardcoded the development
         * tenant's 10 and failed here for a reason that had nothing to do with
         * the behaviour under test.
         */
        expect(html).not.toMatch(/<button[^>]*painter_gap/);
        expect(html).not.toMatch(/painter_gap[^>]*<button/);

        /*
         * Saturday and Sunday have no column at all, which is why this page no
         * longer needs the disclosure that choosing them blocks nothing: the
         * affordance that did nothing is simply absent.
         */
        expect(html).not.toContain('Saturday');
        expect(html).not.toContain('Sunday');
    });

    it('is one tab stop with a named cell under the cursor', async () => {
        const html = await page('/my/availability');

        // `role="grid"` is a composite widget: Tab enters once, arrows move
        // inside. Exactly one cell may therefore be tabbable.
        const cursors = html.match(/class="painter_cell"[^>]*tabindex="0"/g)
            ?? html.match(/tabindex="0"[^>]*class="painter_cell"/g)
            ?? [];

        expect(cursors.length).toBe(1);
    });

    it('names every cell by day, block and clock time', async () => {
        const html = await page('/my/availability');

        expect(html).toMatch(/aria-label="Monday block 1, \d\d:\d\d to \d\d:\d\d, free"/);
        expect(html).toContain('role="columnheader"');
        expect(html).toContain('role="rowheader"');
    });
});

describe('a declared row is individually addressable', () => {
    it('gives each Remove button the row it removes', async () => {
        const created = await api<{ id: string }>('/api/me/availability/vetoes', {
            method: 'POST',
            cookie,
            body: JSON.stringify({ days: [5], blocks: [4, 5], weeks: [], reason: 'a11y fixture' }),
        });

        expect(created.status).toBe(201);

        try {
            const html = await page('/my/availability');

            /*
             * Was the bare string "Remove", repeated once per row, so three
             * declared windows announced as "Remove, Remove, Remove" with nothing
             * to tell them apart.
             */
            expect(html).toMatch(/aria-label="Remove: [^"]+"/);

            // And the wait now has a shape: both timestamps travelled in the
            // payload all along and neither was rendered.
            expect(html).toContain('Submitted ');
        } finally {
            await api(`/api/me/availability/vetoes/${created.body.id}`, { method: 'DELETE', cookie });
        }
    });
});

describe('the hub is navigable by landmark and heading', () => {
    it('names its nav and nests group headings above destination headings', async () => {
        const html = await page('/my');

        expect(html).toContain('aria-label="My settings sections"');

        /*
         * ASSERTED AS A TWO-LEVEL NESTING, which is a stronger claim than the
         * one this test started with.
         *
         * It used to require `<h2 class="cards_label">`, because the hub was a
         * flat wall of cards and a card label was the only thing below the
         * page's `h1`. The hub now groups its destinations through the same
         * `groupNavEntries()` the sidebar and the dashboard use, so the
         * structure a screen-reader user skims is `h1` (page) -> `h2` (group)
         * -> `h3` (destination), and a card label at `h2` would now claim to
         * be a sibling of the heading that introduces it.
         *
         * Both levels are named here rather than just the one that changed: a
         * regression in either direction (groups losing their heading, or
         * cards being promoted back to `h2`) breaks the nesting, and asserting
         * only the card level is what let the previous shape pass while
         * saying nothing about the group above it.
         */
        expect(html).toMatch(/<h2[^>]*class="[^"]*groups_heading/);
        expect(html).toMatch(/<h3[^>]*class="[^"]*cards_label/);

        // And the level that moved is genuinely gone, not merely joined: a
        // card still rendering at `h2` would satisfy both matches above.
        expect(html).not.toMatch(/<h2[^>]*class="[^"]*cards_label/);
    });
});

describe('the warning text colour reaches the browser', () => {
    it('emits --warning800 as a custom property, not just a compile-time fallback', async () => {
        const html = await page('/my/availability');

        /*
         * `warning800` exists because `warning700` measured 3.73:1 on this
         * page's ground, below AA for the most important sentence on it. The
         * generated SCSS resolves it as `var(--warning800, <compile-time
         * fallback>)`, which means a MISSING custom property is invisible in the
         * light theme (the fallback IS the light value) and wrong in the dark
         * one, where the override never arrives and warning text renders the
         * dark-brown light value on a near-black ground.
         *
         * That exact failure is recorded in `useLayout`'s own comment: the
         * emitter once filtered on keys that did not exist, so `css` was always
         * empty and "every themed color silently fell back to its compile-time
         * value". Nothing about the page looked wrong. So the property is
         * asserted rather than assumed.
         */
        expect(html).toMatch(/--warning800:\s*\d+\s*,\s*\d+\s*,\s*\d+/);
    });
});
