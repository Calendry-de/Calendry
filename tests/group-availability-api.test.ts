import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, TEST_PASSWORD, seed, teardown } from './helpers/seed';
import { api, login } from './helpers/client';

/**
 * A Group's per-Term availability window, over HTTP and rendered.
 *
 * WHY THIS FILE EXISTS, and it is not "the endpoint should work". Three bugs
 * shipped in this feature's first hour and all three were invisible to
 * `nuxt typecheck`, because every one of them was a wrong assumption about a
 * shape the compiler takes on trust:
 *
 *   1. `/api/terms` was read as `{ rows }` and returns a BARE ARRAY (the list
 *      route switches shape on `limit`). Hidden by a `?? []` fallback, so the
 *      panel rendered "No terms defined yet" for a tenant with two.
 *   2. `/api/constraints` had the same wrong shape and did NOT have a fallback,
 *      so it threw `Cannot read properties of undefined (reading 'find')`
 *      during SSR. The crash was the lucky half; it is why (1) was found.
 *   3. The PUT body was sent as `{ rows }` where `[relation].put.ts` parses
 *      `z.array(config.item)`. A flat 400, nothing saved.
 *
 * `request<T>()` is an unchecked assertion about what a server sends, so a wrong
 * `T` is a lie the compiler believes. The only thing that catches it is calling
 * the route and rendering the page, which is what this does.
 */
const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:8080';

let cookie = '';
let groupId = '';
let termId = '';

/** Rendered markup with template comments stripped: see my-availability-a11y. */
async function page(path: string): Promise<string> {
    const res = await fetch(`${BASE}${path}`, { headers: { cookie } });

    expect(res.status).toBe(200);

    return (await res.text()).replace(/<!--[\s\S]*?-->/g, '');
}

beforeAll(async () => {
    const ids = await seed();

    cookie = (await login(ACCOUNTS.adminA, TEST_PASSWORD)).cookie;
    groupId = ids.groupCohortA;
    termId = ids.termA;
});

afterAll(teardown);

describe('the response shapes this feature reads', () => {
    it('serves /api/terms as a bare array, not { rows }', async () => {
        const res = await api<unknown>('/api/terms', { cookie });

        expect(res.status).toBe(200);
        expect(Array.isArray(res.body), 'the list route returns an array without `limit`').toBe(true);
    });

    it('serves /api/constraints as a bare array too', async () => {
        const res = await api<unknown>('/api/constraints', { cookie });

        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
    });
});

describe('the window round-trips', () => {
    it('accepts a bare array body and returns what it stored', async () => {
        const put = await api<unknown>(`/api/groups/${groupId}/availability`, {
            method: 'PUT',
            cookie,
            body: JSON.stringify([
                { termId, availableFrom: '2026-10-05', availableTo: '2026-12-09' },
            ]),
        });

        expect(put.status).toBe(200);

        const get = await api<{ termId: string; availableFrom: string; availableTo: string }[]>(
            `/api/groups/${groupId}/availability`,
            { cookie },
        );

        expect(get.status).toBe(200);
        expect(get.body).toHaveLength(1);
        expect(get.body[0]!.termId).toBe(termId);
        expect(get.body[0]!.availableFrom).toContain('2026-10-05');
        expect(get.body[0]!.availableTo).toContain('2026-12-09');
    });

    it('clears the window when the set is empty, rather than needing a delete verb', async () => {
        // A PUT-set gives this for nothing, and it matters because an absent row
        // and a boundless one mean the same thing, so there must be exactly one
        // way to say it.
        const put = await api<unknown>(`/api/groups/${groupId}/availability`, {
            method: 'PUT',
            cookie,
            body: JSON.stringify([]),
        });

        expect(put.status).toBe(200);

        const get = await api<unknown[]>(`/api/groups/${groupId}/availability`, { cookie });

        expect(get.body).toEqual([]);
    });
});

describe('the write boundary refuses the two unrepresentable states', () => {
    it('refuses a row with neither bound', async () => {
        // Says exactly what an absent row says. Refused at the boundary so the
        // caller gets a 400 naming the problem rather than a CHECK-violation 500.
        const res = await api<unknown>(`/api/groups/${groupId}/availability`, {
            method: 'PUT',
            cookie,
            body: JSON.stringify([{ termId, availableFrom: null, availableTo: null }]),
        });

        expect(res.status).toBe(400);
    });

    it('refuses an inverted range', async () => {
        // Not a narrow window: an EMPTY one, which would black out every week of
        // the term and surface as nothing more specific than "no feasible
        // placement".
        const res = await api<unknown>(`/api/groups/${groupId}/availability`, {
            method: 'PUT',
            cookie,
            body: JSON.stringify([
                { termId, availableFrom: '2026-12-09', availableTo: '2026-10-05' },
            ]),
        });

        expect(res.status).toBe(400);
    });
});

describe('the editor renders', () => {
    it('names the tenant\'s terms rather than claiming there are none', async () => {
        const html = await page(`/manage/groups/${groupId}`);

        expect(html).toContain('Availability within a term');
        /*
         * THE SILENT HALF of bug (1). With the wrong response shape this said
         * "No terms defined yet", a sentence that is indistinguishable from a
         * correctly-empty tenant, which is the failure mode CLAUDE.md names: if
         * "no data" and "fetch failed" render identically, the bug is invisible.
         */
        expect(html).not.toContain('No terms defined yet');
        expect(html).toMatch(/Available every week of this term|weeks available/);
    });

    it('renders a saved window into the inputs at FIRST render, server-side', async () => {
        await api(`/api/groups/${groupId}/availability`, {
            method: 'PUT',
            cookie,
            body: JSON.stringify([{ termId, availableFrom: '2026-10-05', availableTo: null }]),
        });

        try {
            const html = await page(`/manage/groups/${groupId}`);

            /*
             * Vue does not flush watchers during SSR, so a draft seeded by
             * `watch(data, seed, { immediate: true })` would be empty here and
             * correct only after hydration: visible as a flash, and wrong for
             * anything reading the HTML. Seeded from the awaited promise instead,
             * which this asserts by looking for the VALUE, not the input.
             */
            expect(html).toContain('value="2026-10-05"');
        } finally {
            await api(`/api/groups/${groupId}/availability`, {
                method: 'PUT',
                cookie,
                body: JSON.stringify([]),
            });
        }
    });

    it('says the rule is not enforced while the tenant has no group_veto row', async () => {
        /*
         * The state EVERY existing tenant is in until `backfill:constraints`
         * runs, and the one the first version of this condition treated as
         * nothing to mention: it checked `rule && !rule.isEnabled`, so silence
         * fell exactly where the reader cannot fix it from this page.
         */
        const html = await page(`/manage/groups/${groupId}`);

        expect(html).toContain('Saved, but not yet enforced');
    });
});
