import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, TEST_PASSWORD, ownerDb, seed, teardown } from './helpers/seed';
import { login } from './helpers/client';

/**
 * Every page a role can reach must actually RENDER for that role.
 *
 * WHY THIS FILE EXISTS, AND WHY IT IS A TEST RATHER THAN A LINT RULE
 *
 * A page's data usually arrives as one `Promise.all` of reference fetches. Those
 * endpoints carry their OWN permissions, which are not necessarily the one the
 * page is gated on — and a single 403 inside `Promise.all` rejects the whole
 * handler, so the page renders as NOTHING. Not an error, not a partial view:
 * blank. It is the least diagnosable failure a UI has, because it looks
 * identical to a page that legitimately has no data.
 *
 * This has now happened twice, both times to `/schedule`:
 *
 *   Stage 6c  `/schedule/review/[id]` was gated on `session.read` and fetched
 *             `/api/offerings`, which needs `offering.read`.
 *   Later     the same page's reference wave gained `/api/session-kinds`,
 *             which needs `session_kind.read`.
 *
 * The rule was written down after the first and did not prevent the second,
 * because prose is checked by nobody. A custom lint rule was considered and
 * rejected: it could spot a `.catch`-less fetch inside `Promise.all`, but it
 * cannot know which permission an endpoint needs or which the page is gated on,
 * so it would fire on every correct reference wave and be suppressed into
 * uselessness.
 *
 * The symptom, though, is trivially checkable — so this renders each page as
 * each role and asserts it came back. A new fetch that a role cannot reach
 * fails here immediately, whoever adds it and whether or not they read
 * CLAUDE.md.
 *
 * ADDING A PAGE: add a row. The marker should be a structural element that
 * only exists once the data resolved — NOT merely "200 OK", because a blanked
 * page returns 200 with an empty body, which is exactly how both incidents
 * escaped review.
 */
const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:8080';

/**
 * `viewer` holds ONLY `session.read` (pinned by auth-permissions.test.ts), so
 * it is the sharpest instrument available: any page it can reach that depends
 * on a second permission fails here.
 */
const ROLES = [
    { name: 'admin', account: ACCOUNTS.adminA },
    { name: 'viewer', account: ACCOUNTS.viewerA },
] as const;

const PAGES = [
    {
        path: '/schedule',
        roles: ['admin'],
        marker: 'grid_col',
        why: 'the week grid itself — present only once the reference wave resolved',
    },
    {
        /*
         * The viewer holds ONLY `session.read`, and the schedule needs six
         * reads to draw anything. It used to render blank; it now says which
         * permissions are missing.
         *
         * This row is the fix's real proof. It sat in `it.fails` while the page
         * was broken, so moving it back here — passing on its own terms rather
         * than by being expected to fail — is the signal the gap is closed.
         */
        path: '/schedule',
        roles: ['viewer'],
        status: 403,
        marker: 'do not have permission to view the schedule',
        why: 'a stated denial, not an empty grid and not a blank shell',
    },
    {
        path: '/manage',
        roles: ['admin', 'viewer'],
        marker: 'Manage',
        why: 'the manage index renders whatever sections the role may read',
    },
] as const;

const cookies: Record<string, string> = {};

beforeAll(async () => {
    await seed();

    for (const role of ROLES) {
        const { cookie } = await login(role.account, TEST_PASSWORD);

        cookies[role.name] = cookie;
    }
});

afterAll(async () => {
    await teardown();
    await ownerDb.$disconnect();
});

describe('every page renders for every role that can reach it', () => {
    for (const page of PAGES) {
        for (const role of page.roles) {
            it(`${page.path} renders for ${role}`, async () => {
                const res = await fetch(`${BASE}${page.path}`, { headers: { cookie: cookies[role]! } });

                /*
                 * The status is asserted per row, because a DENIAL is a correct
                 * outcome for some role/page pairs and 200 is not the only right
                 * answer. It is asserted at all because a page that 500s and one
                 * that legitimately refuses must not both count as "not blank".
                 */
                expect(res.status).toBe((page as { status?: number }).status ?? 200);

                const html = await res.text();

                /*
                 * The CONTENT check is the whole point. A page whose data fetch
                 * rejected still returns 200 with a shell — status alone passes
                 * for exactly the failure this file exists to catch.
                 */
                expect(html, `${page.path} for ${role} lost its content (${page.why})`)
                    .toContain(page.marker);
            });
        }
    }

    it('names WHICH permissions are missing, not just that access is denied', async () => {
        /*
         * "You do not have access" sends someone to ask for the wrong thing.
         * The whole reason this page broke is that its real requirements were
         * invisible, so the denial states them.
         */
        const res = await fetch(`${BASE}/schedule`, { headers: { cookie: cookies.viewer! } });
        const html = await res.text();

        for (const permission of ['term.read', 'time_grid.read', 'group.read', 'room.read', 'person.read']) {
            expect(html, `denial should name ${permission}`).toContain(permission);
        }

        // ...and not the one they DO hold.
        expect(html).not.toContain('session.read,');
    });

    it('fails when a page depends on a permission its role lacks', async () => {
        /*
         * Proof this suite can fail, not just pass. `/manage/session-kinds`
         * needs `session_kind.read`, which the viewer does not hold — so it
         * redirects rather than rendering that section, and asserting the
         * section's own marker finds nothing.
         *
         * Without this, a marker that had quietly stopped appearing anywhere
         * would make every case above vacuous.
         */
        const res = await fetch(`${BASE}/manage/session-kinds`, { headers: { cookie: cookies.viewer! } });
        const html = await res.text();

        expect(html).not.toContain('Session kinds</h1>');
    });
});
