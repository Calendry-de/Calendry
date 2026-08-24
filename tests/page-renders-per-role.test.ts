import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, TEST_PASSWORD, ownerDb, seed, teardown } from './helpers/seed';
import { login } from './helpers/client';
import { defaultConstraintRow, defaultConstraintTypes } from '#shared/constraintTypes';

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
 * A role that may READ constraints and not change them.
 *
 * Local to this file rather than added to tests/helpers/seed.ts, and that is a
 * deliberate call rather than laziness. The read-only assertion needs the
 * tenant to hold a default constraint row per live catalogue type — otherwise
 * the page renders zero rows and "no editable toggles" passes for the wrong
 * reason. Seeding those into the SHARED fixture would break two suites that
 * use the same tenant: `constraint-scopes-api` creates its own `isDefault`
 * row, which `constraint_one_default_per_type` would then reject, and
 * `constraint-defaults` counts default rows. Suites run serially
 * (`fileParallelism: false`), so a file-local fixture cannot race them.
 */
const CONSTRAINT_VIEWER = 'constraint-viewer@test.local';

/**
 * `viewer` holds ONLY `session.read` (pinned by auth-permissions.test.ts), so
 * it is the sharpest instrument available: any page it can reach that depends
 * on a second permission fails here.
 */
const ROLES = [
    { name: 'admin', account: ACCOUNTS.adminA },
    { name: 'viewer', account: ACCOUNTS.viewerA },
    { name: 'constraintViewer', account: CONSTRAINT_VIEWER },
] as const;

/**
 * The fixture tenant's id, from tests/helpers/seed.ts.
 *
 * Hardcoded because the helper does not export its ids, and the alternative —
 * exporting them — widens a fixture 40 suites share for the benefit of one.
 */
const TENANT_A = 'test-tenant-a';

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
    {
        /*
         * The constraint grid renders from the CATALOGUE, so its rows exist
         * whether or not the tenant has rows — which is why the marker is a
         * rule's own description rather than a heading. A heading survives a
         * failed fetch; this does not.
         */
        path: '/manage/constraints',
        roles: ['admin', 'constraintViewer'],
        marker: 'A room cannot host two sessions that overlap',
        why: 'a catalogue rule\'s description — present only once the rows rendered',
    },
] as const;

const cookies: Record<string, string> = {};

/**
 * A person + account + role holding `constraint.read` and `session_kind.read`
 * and NOT `constraint.update`, plus the constraint rows the page needs.
 *
 * Everything tenant-scoped here dies with the tenant in `teardown()`. The
 * ACCOUNT does not — accounts are tenant-independent by design — so it is
 * removed explicitly, and removed again up front in case a crashed run left one
 * behind and the unique email would otherwise fail the next seed.
 */
async function seedConstraintViewer() {
    await ownerDb.$executeRawUnsafe(`DELETE FROM account WHERE email = '${CONSTRAINT_VIEWER}'`);

    /*
     * One default row per LIVE catalogue type, built by the same function
     * `provision:tenant` uses. Derived rather than listed: a catalogue that
     * grows a type would otherwise leave this fixture quietly incomplete, which
     * is the exact failure `defaultConstraintRow` was introduced to end.
     */
    await ownerDb.constraint.createMany({
        data: defaultConstraintTypes().map((type) => ({
            ...defaultConstraintRow(type),
            tenantId: TENANT_A,
        })),
    });

    const role = await ownerDb.accessRole.create({
        data: { tenantId: TENANT_A, key: 'constraint-viewer', name: 'Constraint Viewer' },
    });

    await ownerDb.accessRolePermission.createMany({
        data: ['constraint.read', 'session_kind.read'].map((permissionKey) => ({
            accessRoleId: role.id, permissionKey, tenantId: TENANT_A,
        })),
    });

    const person = await ownerDb.person.create({
        data: { tenantId: TENANT_A, givenName: 'Cass', familyName: 'Constraint', email: 'cass@a.test' },
    });

    await ownerDb.personAccessRole.create({
        data: { personId: person.id, accessRoleId: role.id, tenantId: TENANT_A },
    });

    // The same hash every fixture account uses, so TEST_PASSWORD logs in.
    const template = await ownerDb.account.findFirstOrThrow({ where: { email: ACCOUNTS.adminA } });
    const account = await ownerDb.account.create({
        data: { email: CONSTRAINT_VIEWER, passwordHash: template.passwordHash },
    });

    await ownerDb.accountPerson.create({ data: { accountId: account.id, personId: person.id } });
}

beforeAll(async () => {
    await seed();
    await seedConstraintViewer();

    for (const role of ROLES) {
        const { cookie } = await login(role.account, TEST_PASSWORD);

        cookies[role.name] = cookie;
    }
});

afterAll(async () => {
    await ownerDb.$executeRawUnsafe(`DELETE FROM account WHERE email = '${CONSTRAINT_VIEWER}'`);
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

    /*
     * THE READ-ONLY RENDERING PATH.
     *
     * Step 13's rule is that a role with `.read` and no `.update` gets STATIC
     * TEXT, not disabled inputs — a disabled control reads as "unavailable
     * right now" rather than "not yours to change". The constraint grid was the
     * last place still rendering disabled inputs, and nothing pinned the fix.
     *
     * Counting absences is the trap this whole file exists to catch, so every
     * absence below is paired with the admin rendering the SAME page: zero
     * toggles for a viewer means nothing unless the page produces toggles for
     * someone. Without that control, a blank page passes every assertion here.
     */
    describe('the constraint grid, read-only', () => {
        const constraintPage = (role: string) =>
            fetch(`${BASE}/manage/constraints`, { headers: { cookie: cookies[role]! } })
                .then((res) => res.text())
                // Assertions read the RENDERED body only. The hydration payload
                // carries the same rows as JSON, and matching there would pass
                // for a page that rendered nothing at all — which is precisely
                // how the deprecated-constraint bug hid.
                .then((html) => html.split('<script type="application/json"')[0] ?? '');

        const count = (html: string, pattern: RegExp) => (html.match(pattern) ?? []).length;

        /** One row per live catalogue type, because the fixture seeds one row per type. */
        const expectedRows = defaultConstraintTypes().length;

        /** Only SOFT rules carry a weight — the presence of the control IS the severity signal. */
        const softRules = defaultConstraintTypes().filter((type) => type.severity === 'SOFT').length;

        it('renders every rule, with no control the role cannot use', async () => {
            const [admin, viewer] = await Promise.all([
                constraintPage('admin'),
                constraintPage('constraintViewer'),
            ]);

            // The control: the page is capable of rendering these at all.
            expect(count(admin, /class="crow[ "]/g), 'admin should see every catalogue rule')
                .toBe(expectedRows);
            expect(count(admin, /type="checkbox"/g), 'admin should get real toggles')
                .toBe(expectedRows);
            /*
             * The CONTROL, not its class name. `crow_weight--static` begins
             * with `crow_weight`, so a class-based negative lookahead matches
             * the read-only rendering too and the assertion silently inverts.
             * A number input is unambiguous: it is either there or it is not.
             */
            expect(count(admin, /<input[^>]*type="number"/g), 'admin should get weight inputs')
                .toBe(softRules);

            // The subject: same rows, none of the controls.
            expect(count(viewer, /class="crow[ "]/g), 'read-only should still see every rule')
                .toBe(expectedRows);
            expect(count(viewer, /type="checkbox"/g), 'read-only must get no toggles')
                .toBe(0);
            expect(count(viewer, /<input[^>]*type="number"/g), 'read-only must get no weight inputs')
                .toBe(0);
        });

        it('states each rule as text instead of disabling a control', async () => {
            const viewer = await constraintPage('constraintViewer');

            /*
             * The positive half of "no toggles": every row says On or Off in
             * words. Asserting only the absence would also pass for a row that
             * rendered its name and nothing else.
             */
            expect(count(viewer, /crow_state-word/g)).toBe(expectedRows);

            // Every soft rule's weight is stated rather than edited.
            expect(count(viewer, /crow_weight--static/g)).toBe(softRules);
        });

        it('renders no disabled control anywhere on the page', async () => {
            const viewer = await constraintPage('constraintViewer');

            /*
             * The rule stated directly. A `disabled` attribute surviving here
             * would mean some control had been made inert rather than replaced
             * by the value it holds — which is what this path is about.
             */
            expect(viewer).not.toMatch(/<(?:input|select|textarea|button)[^>]*\sdisabled/);
        });

        it('offers no way to create or edit, and says so by omission', async () => {
            const [admin, viewer] = await Promise.all([
                constraintPage('admin'),
                constraintPage('constraintViewer'),
            ]);

            expect(admin, 'admin is offered the create affordances').toContain('Add scoped variant');
            expect(viewer).not.toContain('Add scoped variant');
            expect(viewer).not.toContain('Add a rule');
        });
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
