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
 * Everything a person editor plausibly holds, and NOTHING about access roles.
 *
 * `role.read` and `group.read` are in there because the Person page's relation
 * wave already fetched `/api/roles` and `/api/groups` long before this feature
 * — a role holding only `person.*` gets every picker on that page reporting
 * "nothing defined yet", which is a separate and pre-existing gap. Including
 * them keeps this fixture aimed at the one thing it is testing.
 */
const PERSON_EDITOR = 'person-editor-page@test.local';

/**
 * Only `person.*` and `room.*` — no role.read, group.read or equipment.read.
 *
 * The systemic case. SIX relation pickers across four entities fetched their
 * options from a resource their page's own gate did not cover, and none of them
 * was new: the Person page has fetched `/api/roles` and `/api/groups` since
 * Step 13, and the Room page `/api/equipment`. What that produced was not a
 * blank page but every picker on the page rendering an EMPTY option list — a
 * tenant with groups being told it has none.
 *
 * One account across two entities on purpose: the point is that this was never
 * about access roles.
 */
const ENTITY_EDITOR = 'entity-editor@test.local';

/**
 * Only `availability.manage_own` — the self-service case.
 *
 * The sharpest instrument for the /my section, because it is the whole point of
 * that section existing: a lecturer must reach their own settings WITHOUT
 * `person.read`, `time_grid.read` or anything else. Everything those pages
 * render travels in the response of the one endpoint behind this key, precisely
 * so the link cannot lead somewhere that then 403s on a reference fetch.
 */
const SELF_SERVICE = 'self-service@test.local';

/**
 * `viewer` holds ONLY `session.read` (pinned by auth-permissions.test.ts), so
 * it is the sharpest instrument available: any page it can reach that depends
 * on a second permission fails here.
 */
const ROLES = [
    { name: 'admin', account: ACCOUNTS.adminA },
    { name: 'viewer', account: ACCOUNTS.viewerA },
    { name: 'constraintViewer', account: CONSTRAINT_VIEWER },
    { name: 'personEditor', account: PERSON_EDITOR },
    { name: 'entityEditor', account: ENTITY_EDITOR },
    { name: 'selfService', account: SELF_SERVICE },
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
    {
        /*
         * Same reasoning as the constraint grid: the permission matrix renders
         * from the CATALOGUE, so the marker is one permission's own description
         * rather than a heading. A heading survives a failed fetch; this does
         * not.
         */
        path: '/manage/access-roles/new',
        roles: ['admin'],
        marker: 'Grant or revoke access roles',
        why: 'a catalogue permission\'s description — present only once the matrix rendered',
    },
    {
        /*
         * THE OPTION-WAVE TRAP, pinned — and measured rather than assumed.
         *
         * The Person page fetches every relation's option list in ONE
         * `Promise.all`, and one of those is now `/api/access-roles`, which no
         * person permission reaches. What that does is not a blank page, which
         * is what the 6c rule describes: `useEntityRelations` awaits the
         * useAsyncData HANDLE, which resolves rather than rejects, so the page
         * renders with every picker's options EMPTY. Verified live with the
         * gate removed — the scheduling-role picker then says "No roles defined
         * yet" to a tenant that has them.
         *
         * Same family, worse symptom in one respect: a page-wide lie instead of
         * an obvious absence. `requiresAnyPermission` drops the relation before
         * the wave is assembled.
         *
         * The marker is the person's own name, which only exists once the form
         * seeded from the awaited row.
         */
        path: '/manage/persons/:personEditorId',
        roles: ['personEditor'],
        marker: 'Fix',
        why: 'the person\'s own name — present only once the whole relation wave resolved',
    },
    {
        /*
         * The same page for a role holding ONLY `person.*`. Every picker on it
         * is now omitted, and the page still has to render the record — an
         * absence check that a blank page would pass is no check at all.
         */
        path: '/manage/persons/:personEditorId',
        roles: ['entityEditor'],
        marker: 'Fix',
        why: 'the person\'s own name, with every relation picker gated away',
    },
    {
        /*
         * The Room page, which had the identical gap through `/api/equipment`
         * and has nothing to do with access roles. Included because one instance
         * of a systemic bug proves nothing about the other five.
         */
        path: '/manage/rooms/test-room-private-a',
        roles: ['admin', 'entityEditor'],
        marker: 'A101',
        why: 'the room\'s own code — present only once the form seeded',
    },
    {
        /*
         * The self-service pages, as somebody holding ONE permission. The marker
         * is the block picker's own rendered clock time, which exists only if
         * the TimeGrid arrived — and the grid arrives only because it travels
         * with `/api/me/availability` rather than being fetched from
         * `/api/time-grids`, which this role cannot read.
         */
        path: '/my/availability',
        roles: ['selfService'],
        marker: 'Submit for approval',
        why: 'the veto form itself — present only once the grid and rows resolved',
    },
    {
        path: '/my/preferences',
        roles: ['selfService'],
        marker: 'Recorded, not yet used by the scheduler',
        why: 'the honest disclosure that preferences do not affect the timetable yet',
    },
    {
        path: '/manage/availability/reviews',
        roles: ['admin'],
        marker: 'A declared window is a',
        why: 'the review page body — proves the static route beats /manage/[entity]/[id]',
    },
    {
        path: '/manage/availability/preferences',
        roles: ['admin'],
        marker: 'Preferred teaching days and blocks',
        why: 'the overview page body, with every active person listed',
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

/** The person editor's own Person row, which is also the page under test. */
let personEditorId = '';

/**
 * A person + account + role holding every `person.*` permission and nothing
 * else. Same lifecycle reasoning as `seedConstraintViewer` above.
 */
async function seedPersonEditor() {
    await ownerDb.$executeRawUnsafe(`DELETE FROM account WHERE email = '${PERSON_EDITOR}'`);

    const role = await ownerDb.accessRole.create({
        data: { tenantId: TENANT_A, key: 'person-editor-page', name: 'Person Editor' },
    });

    await ownerDb.accessRolePermission.createMany({
        data: [
            'person.read', 'person.create', 'person.update', 'person.delete',
            'role.read', 'group.read',
        ].map((permissionKey) => ({ accessRoleId: role.id, permissionKey, tenantId: TENANT_A })),
    });

    const person = await ownerDb.person.create({
        data: { tenantId: TENANT_A, givenName: 'Fix', familyName: 'Editor', email: 'fix@a.test' },
    });

    personEditorId = person.id;

    await ownerDb.personAccessRole.create({
        data: { personId: person.id, accessRoleId: role.id, tenantId: TENANT_A },
    });

    const template = await ownerDb.account.findFirstOrThrow({ where: { email: ACCOUNTS.adminA } });
    const account = await ownerDb.account.create({
        data: { email: PERSON_EDITOR, passwordHash: template.passwordHash },
    });

    await ownerDb.accountPerson.create({ data: { accountId: account.id, personId: person.id } });
}

/**
 * A person + account + role holding `person.*` and `room.*` and nothing else.
 * Same lifecycle reasoning as the two fixtures above.
 */
async function seedEntityEditor() {
    await ownerDb.$executeRawUnsafe(`DELETE FROM account WHERE email = '${ENTITY_EDITOR}'`);

    const role = await ownerDb.accessRole.create({
        data: { tenantId: TENANT_A, key: 'entity-editor', name: 'Entity Editor' },
    });

    await ownerDb.accessRolePermission.createMany({
        data: [
            'person.read', 'person.create', 'person.update', 'person.delete',
            'room.read', 'room.create', 'room.update', 'room.delete',
        ].map((permissionKey) => ({ accessRoleId: role.id, permissionKey, tenantId: TENANT_A })),
    });

    const person = await ownerDb.person.create({
        data: { tenantId: TENANT_A, givenName: 'Eve', familyName: 'Entity', email: 'eve@a.test' },
    });

    await ownerDb.personAccessRole.create({
        data: { personId: person.id, accessRoleId: role.id, tenantId: TENANT_A },
    });

    const template = await ownerDb.account.findFirstOrThrow({ where: { email: ACCOUNTS.adminA } });
    const account = await ownerDb.account.create({
        data: { email: ENTITY_EDITOR, passwordHash: template.passwordHash },
    });

    await ownerDb.accountPerson.create({ data: { accountId: account.id, personId: person.id } });
}

/** A person + account + role holding ONLY `availability.manage_own`. */
async function seedSelfService() {
    await ownerDb.$executeRawUnsafe(`DELETE FROM account WHERE email = '${SELF_SERVICE}'`);

    const role = await ownerDb.accessRole.create({
        data: { tenantId: TENANT_A, key: 'self-service-page', name: 'Self Service' },
    });

    await ownerDb.accessRolePermission.create({
        data: { accessRoleId: role.id, permissionKey: 'availability.manage_own', tenantId: TENANT_A },
    });

    const person = await ownerDb.person.create({
        data: { tenantId: TENANT_A, givenName: 'Sol', familyName: 'Self', email: 'sol@a.test' },
    });

    await ownerDb.personAccessRole.create({
        data: { personId: person.id, accessRoleId: role.id, tenantId: TENANT_A },
    });

    const template = await ownerDb.account.findFirstOrThrow({ where: { email: ACCOUNTS.adminA } });
    const account = await ownerDb.account.create({
        data: { email: SELF_SERVICE, passwordHash: template.passwordHash },
    });

    await ownerDb.accountPerson.create({ data: { accountId: account.id, personId: person.id } });
}

beforeAll(async () => {
    await seed();
    await seedConstraintViewer();
    await seedPersonEditor();
    await seedEntityEditor();
    await seedSelfService();

    for (const role of ROLES) {
        const { cookie } = await login(role.account, TEST_PASSWORD);

        cookies[role.name] = cookie;
    }
});

afterAll(async () => {
    for (const email of [CONSTRAINT_VIEWER, PERSON_EDITOR, ENTITY_EDITOR, SELF_SERVICE]) {
        await ownerDb.$executeRawUnsafe(`DELETE FROM account WHERE email = '${email}'`);
    }

    await teardown();
    await ownerDb.$disconnect();
});

describe('every page renders for every role that can reach it', () => {
    for (const page of PAGES) {
        for (const role of page.roles) {
            it(`${page.path} renders for ${role}`, async () => {
                // Ids are not known until the fixture is seeded, so the table
                // names a placeholder rather than growing a second mechanism
                // for "pages that need a row".
                const path = page.path.replace(':personEditorId', personEditorId);
                const res = await fetch(`${BASE}${path}`, { headers: { cookie: cookies[role]! } });

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

    /**
     * The manage sections a role may not read are not there AT ALL — no nav
     * entry, and a direct URL redirects to /manage. Asserted as a REDIRECT
     * rather than as an absent marker: "the page did not contain X" passes just
     * as well for a page that failed to render, which is the trap this whole
     * file exists to catch.
     */
    it('hides /manage/access-roles from a role without access_role.manage', async () => {
        for (const role of ['viewer', 'constraintViewer', 'personEditor']) {
            const res = await fetch(`${BASE}/manage/access-roles`, {
                headers: { cookie: cookies[role]! },
                redirect: 'manual',
            });

            expect(res.status, `${role} should be redirected away`).toBe(302);
            expect(res.headers.get('location')).toBe('/manage');
        }

        // The control: the section EXISTS and renders for someone. Without this
        // the assertions above would pass against a build where the route was
        // simply broken for everybody.
        const admin = await fetch(`${BASE}/manage/access-roles`, {
            headers: { cookie: cookies.admin! },
            redirect: 'manual',
        });

        expect(admin.status).toBe(200);
        expect(await admin.text()).toContain('Access roles');
    });

    /**
     * The person editor sees the person page and its scheduling-role picker, and
     * does NOT see the access-role picker — one page, two relations, two
     * different answers.
     *
     * Paired deliberately: "the access-role picker is absent" means nothing
     * unless the page rendered its other pickers, which is exactly how a blank
     * page passes an absence check.
     */
    it('omits the access-role picker for a person editor while keeping the page', async () => {
        const html = await fetch(`${BASE}/manage/persons/${personEditorId}`, {
            headers: { cookie: cookies.personEditor! },
        }).then((res) => res.text())
            // Rendered body only — the hydration payload carries the registry
            // as JSON, and matching there would pass for a page that rendered
            // nothing at all.
            .then((body) => body.split('<script type="application/json"')[0] ?? '');

        expect(html).toContain('Scheduling roles');
        expect(html).toContain('Group memberships');
        expect(html).not.toContain('Access roles');

        /*
         * The option wave RESOLVED — this is the assertion that makes the
         * absence above mean something. If the access-roles fetch had been left
         * in and 403'd, every picker on this page would render with an empty
         * option list, and "no Access roles heading" would pass while the page
         * quietly told the user their tenant has no groups.
         */
        expect(html, 'the surviving pickers must still have their options').toContain('Cohort A');

        // The control, again: an admin on the SAME page does get it.
        const asAdmin = await fetch(`${BASE}/manage/persons/${personEditorId}`, {
            headers: { cookie: cookies.admin! },
        }).then((res) => res.text())
            .then((body) => body.split('<script type="application/json"')[0] ?? '');

        expect(asAdmin).toContain('Access roles');
    });

    /**
     * THE SYSTEMIC CASE: a picker whose options come from a resource the page's
     * own gate does not cover is OMITTED, never rendered empty.
     *
     * Six relations across four entities were in that state before this, and
     * only one of them involved access roles. The Person and Room pages are both
     * checked here because one instance of a systemic bug proves nothing about
     * the other five.
     *
     * Every absence is paired with an admin rendering the SAME page. That
     * pairing is the whole discipline of this file: "the page does not contain
     * X" passes just as well for a page that rendered nothing.
     */
    describe('relation pickers whose options are out of reach', () => {
        const body = (path: string, role: string) =>
            fetch(`${BASE}${path}`, { headers: { cookie: cookies[role]! } })
                .then((res) => res.text())
                // Rendered body only. The hydration payload carries the registry
                // as JSON, and matching there would pass for a page that
                // rendered nothing at all.
                .then((html) => html.split('<script type="application/json"')[0] ?? '');

        it('omits all three pickers on the Person page for a person.*-only role', async () => {
            const html = await body(`/manage/persons/${personEditorId}`, 'entityEditor');

            // The record itself still renders — this is an edit form, not a
            // denial. Only the controls it cannot populate are gone.
            expect(html).toContain('Fix');
            expect(html).not.toContain('Scheduling roles');
            expect(html).not.toContain('Group memberships');
            expect(html).not.toContain('Access roles');

            /*
             * The control. Without it, all three assertions above would pass
             * against a build where the page simply failed to render — which is
             * precisely the shape of the bug being fixed.
             */
            const asAdmin = await body(`/manage/persons/${personEditorId}`, 'admin');

            expect(asAdmin).toContain('Scheduling roles');
            expect(asAdmin).toContain('Group memberships');
            expect(asAdmin).toContain('Access roles');
        });

        it('omits the equipment picker on the Room page for a room.*-only role', async () => {
            const html = await body('/manage/rooms/test-room-private-a', 'entityEditor');

            expect(html).toContain('A101');
            expect(html).not.toContain('Equipment in this room');

            const asAdmin = await body('/manage/rooms/test-room-private-a', 'admin');

            expect(asAdmin).toContain('Equipment in this room');
        });

        it('never renders a picker with an empty option list where the fetch was refused', async () => {
            /*
             * The failure this replaced, stated directly: the old behaviour kept
             * the picker and showed its `emptyHint`, so a tenant that HAS roles
             * and groups was told it has none. If a relation is ever offered
             * without its options being reachable, that hint comes back — on a
             * page whose fixture demonstrably has both.
             */
            const html = await body(`/manage/persons/${personEditorId}`, 'entityEditor');

            expect(html).not.toContain('No roles defined yet');
            expect(html).not.toContain('No groups defined yet');
            expect(html).not.toContain('No access roles defined yet');
        });
    });

    /**
     * The /my section is reachable on ONE permission and nothing else.
     *
     * Paired with denials, because "the page rendered" alone would pass for a
     * build where the section had no gate at all.
     */
    it('keeps /my to availability.manage_own, in both directions', async () => {
        const denied = await fetch(`${BASE}/my/availability`, {
            headers: { cookie: cookies.entityEditor! },
            redirect: 'manual',
        });

        expect(denied.status, 'a person editor holds no availability permission').toBe(403);

        const allowed = await fetch(`${BASE}/my/availability`, { headers: { cookie: cookies.selfService! } });

        expect(allowed.status).toBe(200);

        // ...and the same person cannot reach the ADMINISTRATOR side of the same
        // feature, which is the whole reason manage_own and manage_any are
        // separate keys.
        const review = await fetch(`${BASE}/manage/availability/reviews`, {
            headers: { cookie: cookies.selfService! },
            redirect: 'manual',
        });

        expect(review.status).toBe(403);
    });

    /**
     * A page nobody can NAVIGATE to might as well not exist.
     *
     * Every other assertion in this file fetches a URL directly, which is
     * exactly how the /my section shipped with working pages, correct gating and
     * no way to click into it: `ViewMenu` renders only entries carrying
     * `inHeader`, and the section's two pages deliberately do not. The pages
     * rendered, the middleware refused the right people, and the whole suite was
     * green while the feature was unreachable.
     *
     * So the header itself is now asserted — in both directions, because "the
     * link is there" proves nothing if it is there for everybody.
     */
    it('offers the /my section in the header to exactly the roles that can use it', async () => {
        const header = async (role: string) => {
            const html = await fetch(`${BASE}/`, { headers: { cookie: cookies[role]! } }).then((res) => res.text());

            // The header nav only — the command palette renders every permitted
            // entry into the same document, so matching the whole page would
            // pass for a build with no header link at all.
            return html.match(/<nav class="header__menu"[\s\S]*?<\/nav>/)?.[0] ?? '';
        };

        expect(await header('selfService'), 'the one role that needs it').toContain('My settings');
        expect(await header('admin'), 'an admin holds manage_own too').toContain('My settings');

        // The viewer holds only `session.read`; the person editor only
        // `person.*`. Neither can use the section, so neither is offered it.
        expect(await header('viewer')).not.toContain('My settings');
        expect(await header('entityEditor')).not.toContain('My settings');

        // The control: the header rendered at all for the roles asserted to
        // lack the entry, rather than being empty for an unrelated reason.
        expect(await header('viewer')).toContain('Home');
        expect(await header('entityEditor')).toContain('Home');
    });

    it('offers both administrator availability screens on the /manage index', async () => {
        const manage = async (role: string) => fetch(`${BASE}/manage`, { headers: { cookie: cookies[role]! } })
            .then((res) => res.text())
            .then((html) => html.split('<script type="application/json"')[0] ?? '');

        const asAdmin = await manage('admin');

        expect(asAdmin).toContain('Unavailability review');
        expect(asAdmin).toContain('Teaching preferences');

        // The self-service role holds `manage_own` and neither administrator
        // key, so it sees the hub's other sections — none of them, in its case —
        // but never these two.
        const asSelfService = await manage('selfService');

        expect(asSelfService).not.toContain('Unavailability review');
        expect(asSelfService).not.toContain('Teaching preferences');
    });

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
