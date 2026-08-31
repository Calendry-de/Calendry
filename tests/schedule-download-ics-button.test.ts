import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, type Fixtures, TEST_PASSWORD, ownerDb, seed, teardown } from './helpers/seed';
import { login } from './helpers/client';

/**
 * The frontend half of issue #15's download export: `server/api/me/schedule.ics.get.ts`
 * and its timezone-correct `.ics` generation already have their own suite
 * (`tests/ical-export.test.ts`). What that suite cannot catch is a live page with
 * no way to reach the endpoint at all — the toolbar rendered no button for it
 * until this change, which `grep -rln "schedule.ics" app/` would have shown had
 * anyone checked.
 *
 * So this asserts the ACTUAL rendered link, not just that a button exists
 * somewhere: a real `<a href>` (not a NuxtLink push-state route, which would
 * strip the browser's own cookie-bearing navigation and 401), pointing at the
 * caller's own resolved Term, and that the href it renders is one the same
 * session can actually download from.
 */
let f: Fixtures;
let cookie: string;

const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:8080';

beforeAll(async () => {
    f = await seed();
    cookie = (await login(ACCOUNTS.adminA, TEST_PASSWORD)).cookie;
}, 60_000);

afterAll(async () => {
    await teardown();
    await ownerDb.$disconnect();
});

describe('schedule toolbar — download .ics', () => {
    it('renders a real <a href> to the export endpoint for the resolved Term', async () => {
        const res = await fetch(`${BASE}/schedule`, { headers: { cookie } });

        expect(res.status).toBe(200);

        const html = await res.text();
        const match = html.match(/<a[^>]*href="([^"]*\/api\/me\/schedule\.ics\?[^"]*)"[^>]*>/);

        expect(match, 'no <a href="/api/me/schedule.ics?..."> in the rendered schedule page').not.toBeNull();

        const href = match![1].replace(/&amp;/g, '&');

        // NOT a client-side route: a NuxtLink here would drop the browser's
        // real navigation (and its cookie) in favour of the SPA router, which
        // never reaches this h3 route at all.
        expect(href.startsWith('/api/me/schedule.ics?')).toBe(true);
        expect(href).toContain(`termId=${f.termA}`);

        // The link is not just present — it has to actually work for the same
        // session, or the wiring only looks correct.
        const download = await fetch(`${BASE}${href}`, { headers: { cookie } });

        expect(download.status).toBe(200);
        expect(download.headers.get('content-type')).toContain('text/calendar');

        const ics = await download.text();

        expect(ics).toContain('BEGIN:VCALENDAR');
    });

    it('names the action for a keyboard or screen-reader user, not just an icon', async () => {
        const res = await fetch(`${BASE}/schedule`, { headers: { cookie } });
        const html = await res.text();

        expect(html).toContain('Download .ics');
    });
});
