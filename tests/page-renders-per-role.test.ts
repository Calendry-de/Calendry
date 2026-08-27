import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, TEST_PASSWORD, ownerDb, seed, teardown } from './helpers/seed';
import { login } from './helpers/client';
import { defaultConstraintRow, defaultConstraintTypes } from '#shared/constraintTypes';

/**
 * Every page a role can reach must actually RENDER for that role.
 *
 * A page's data arrives as one `Promise.all` of reference fetches carrying their
 * OWN permissions, which need not be the one the page is gated on — and a single
 * 403 inside `Promise.all` rejects the whole handler, so the page renders as
 * NOTHING. Not an error, not a partial view: blank, and indistinguishable from a
 * page that legitimately has no data.
 *
 * It has happened twice, both to `/schedule`: `/api/offerings` needing
 * `offering.read`, then `/api/session-kinds` needing `session_kind.read`. The rule
 * was written down after the first and did not prevent the second, because prose is
 * checked by nobody. A lint rule cannot know which permission an endpoint needs.
 *
 * ADDING A PAGE: add a row. The marker must be a structural element that exists
 * only once the data resolved — NOT "200 OK", because a blanked page returns 200
 * with an empty body, which is how both incidents escaped review.
 */
const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:8080';

/**
 * A role that may READ constraints and not change them.
 *
 * File-local rather than in tests/helpers/seed.ts: the read-only assertion needs a
 * default constraint row per live catalogue type, and seeding those into the SHARED
 * fixture would break `constraint-scopes-api` (which creates its own `isDefault`
 * row) and `constraint-defaults` (which counts them). Suites run serially, so a
 * file-local fixture cannot race them.
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
 * Only `person.*` and `room.*` — the systemic case. SIX relation pickers across
 * four entities fetched options from a resource their page's gate did not cover,
 * and none was new. The result was not a blank page but every picker rendering an
 * EMPTY option list: a tenant with groups being told it has none.
 *
 * One account across two entities on purpose — this was never about access roles.
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
 * Only `generation.read` — the reviewer case, and the reason that key exists.
 *
 * PRODUCT.md's reviewer is a department head who decides on solver output and
 * administers nothing. Under the old gate that role was unexpressible: reading
 * proposals meant `session.read`, so "may decide on proposals" and "may look at
 * the timetable" were one permission, and every lecturer got the second by
 * getting the first. This fixture is the shape that was missing.
 */
const PROPOSAL_REVIEWER = 'proposal-reviewer@test.local';

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
    { name: 'proposalReviewer', account: PROPOSAL_REVIEWER },
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
        marker: 'grid_cell',
        /*
         * Was `grid_col`, the per-day column wrapper. The grid no longer has
         * one: blocks are shared grid ROWS and every cell names its own row and
         * column, so the day columns are grid tracks rather than elements. A
         * cell is the equivalent structural marker — it exists only once the
         * reference wave resolved and the TimeGrid could be read.
         */
        why: 'a grid cell — present only once the reference wave resolved',
    },
    {
        /*
         * THE VIEWER NOW DRAWS THE GRID, and this row moving is the whole point
         * of the change that put it here.
         *
         * It holds ONLY `session.read`. It used to render blank (one 403 inside
         * the reference wave rejecting the lot), then — once the six-permission
         * gate was added — a stated denial naming five permissions it did not
         * need. Both were symptoms of the page assembling the institution's
         * directory in order to draw itself. It draws from
         * `/api/schedule/context` now, behind its own key, so the smallest role
         * that may look at a timetable can actually see one.
         */
        path: '/schedule',
        roles: ['viewer'],
        marker: 'grid_cell',
        why: 'a grid cell — the viewer needs no directory permission to draw one',
    },
    {
        /*
         * A role holding NEITHER read key is still refused, and the denial names
         * BOTH — a tenant admin told only `session.read` would grant the whole
         * institution's timetable to somebody who needed their own.
         */
        path: '/schedule',
        roles: ['constraintViewer'],
        status: 403,
        marker: 'session.read_own',
        why: 'a stated denial naming both keys, not an empty grid',
    },
    {
        /*
         * A proposal that does not exist must say SO. The review page's preview
         * fetch is the one thing on it that is not tolerant, and a rejection nulled
         * `preview`, fell through to the "not produced by a solver run" branch and
         * interpolated `undefined` into the message — so a 403, a 404, a dropped
         * connection and a genuine manual baseline were indistinguishable.
         */
        path: '/schedule/review/01a04015-0000-0000-0000-000000000000',
        roles: ['admin'],
        marker: 'No such proposal',
        why: 'the 404 branch, which only renders once the preview fetch failed',
    },
    {
        /*
         * The review routes are gated on `session.read` by their own
         * middleware, so a role without it gets a STATED denial. Before that
         * middleware existed this returned 200 and told the reader the proposal
         * was "undefined".
         */
        path: '/schedule/review/01a04015-0000-0000-0000-000000000000',
        roles: ['constraintViewer'],
        status: 403,
        marker: 'do not have permission to review schedule proposals',
        why: 'a stated denial, not a sentence about the data',
    },
    {
        /*
         * The display-settings page is NOT a registry entity — no list, no row
         * form, no `/api/display` resource — so it is gated inline rather than
         * by the `manage` middleware, which resolves `to.params.entity` against
         * the registry and 404s a static path that has no entity param at all.
         * It shipped that way first; this row is what would catch it again.
         *
         * The marker is the resolved settings form, not the page title: the
         * title renders from a shell that does not need the fetch.
         */
        path: '/manage/display',
        roles: ['admin'],
        marker: 'Where a session',
        why: 'the settings form, present only once /api/display-settings resolved',
    },
    {
        /*
         * The viewer used to be on the row above: the page was gated on
         * `session.read`, so an institution's own settings sat in the navigation
         * of everybody who could look at a timetable. Now `tenant.read`, and the
         * denial is STATED rather than an empty form.
         */
        path: '/manage/display',
        roles: ['viewer'],
        status: 403,
        marker: 'display settings needs tenant.read',
        why: 'a stated denial naming the permission, not a blank settings form',
    },
    {
        /*
         * Proposals: `generation.read`, and the admin row is the control. The
         * marker is the resolved empty state — it renders only on the branch
         * where the fetch came back, so a 403 or a dropped request cannot pass
         * as "nothing awaiting a decision".
         */
        path: '/schedule/proposals',
        roles: ['admin', 'proposalReviewer'],
        marker: 'Nothing awaiting a decision',
        why: 'the resolved empty state, which the load-failure branch replaces',
    },
    {
        /*
         * The same page for the viewer, which holds `session.read` and therefore
         * used to reach it — every solver proposal this tenant had ever produced,
         * offered to anybody who could see the grid.
         */
        path: '/schedule/proposals',
        roles: ['viewer'],
        status: 403,
        marker: 'do not have permission to review schedule proposals',
        why: 'a stated denial, from the review middleware\'s new gate',
    },
    {
        path: '/manage',
        roles: ['admin'],
        marker: 'Manage',
        why: 'the manage index renders whatever sections the role may read',
    },
    {
        /*
         * The viewer holds ONLY `session.read`, which after this change reaches
         * no management section at all — Display and Proposals were the last two
         * it did reach. The index must therefore say so rather than render an
         * empty card grid, which would be indistinguishable from a failed load.
         *
         * Paired with the admin row above deliberately: "the empty message is
         * present" proves nothing unless the same page fills for somebody.
         */
        path: '/manage',
        roles: ['viewer'],
        marker: 'do not have read access to any management section',
        why: 'the stated empty state, not an empty grid',
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
         * THE OPTION-WAVE TRAP. The Person page fetches every relation's options in
         * ONE `Promise.all`, including `/api/access-roles`, which no person
         * permission reaches. `useEntityRelations` awaits a useAsyncData HANDLE,
         * which resolves rather than rejects — so the page renders with every
         * picker EMPTY. Verified live: the role picker says "No roles defined yet"
         * to a tenant that has them. A page-wide lie instead of an obvious absence.
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
        /*
         * The marker moved with stage 7 (2026-08-27). It was "Recorded, not yet
         * used by the scheduler" — true until the solver gained its evaluator,
         * and the sentence this page existed to be honest with. The replacement
         * carries the same weight and is the reason the anchor is still THIS
         * paragraph rather than a heading: it is the one thing on the page a
         * lecturer needs in order to know what saving does, so losing it is the
         * failure worth catching.
         */
        path: '/my/preferences',
        roles: ['selfService'],
        marker: 'The scheduler can weigh these',
        why: 'the honest disclosure of what saving a preference now does',
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

/**
 * A person + account + role holding ONLY `generation.read`. Same lifecycle
 * reasoning as `seedConstraintViewer` above.
 */
async function seedProposalReviewer() {
    await ownerDb.$executeRawUnsafe(`DELETE FROM account WHERE email = '${PROPOSAL_REVIEWER}'`);

    const role = await ownerDb.accessRole.create({
        data: { tenantId: TENANT_A, key: 'proposal-reviewer-page', name: 'Proposal Reviewer' },
    });

    await ownerDb.accessRolePermission.create({
        data: { accessRoleId: role.id, permissionKey: 'generation.read', tenantId: TENANT_A },
    });

    const person = await ownerDb.person.create({
        data: { tenantId: TENANT_A, givenName: 'Pru', familyName: 'Proposal', email: 'pru@a.test' },
    });

    await ownerDb.personAccessRole.create({
        data: { personId: person.id, accessRoleId: role.id, tenantId: TENANT_A },
    });

    const template = await ownerDb.account.findFirstOrThrow({ where: { email: ACCOUNTS.adminA } });
    const account = await ownerDb.account.create({
        data: { email: PROPOSAL_REVIEWER, passwordHash: template.passwordHash },
    });

    await ownerDb.accountPerson.create({ data: { accountId: account.id, personId: person.id } });
}

beforeAll(async () => {
    await seed();
    await seedConstraintViewer();
    await seedPersonEditor();
    await seedEntityEditor();
    await seedSelfService();
    await seedProposalReviewer();

    for (const role of ROLES) {
        const { cookie } = await login(role.account, TEST_PASSWORD);

        cookies[role.name] = cookie;
    }
});

afterAll(async () => {
    for (const email of [CONSTRAINT_VIEWER, PERSON_EDITOR, ENTITY_EDITOR, SELF_SERVICE, PROPOSAL_REVIEWER]) {
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
     * `/schedule/proposals` is reachable on `generation.read` ALONE, which is why
     * it has its own middleware. The same `proposalReviewer` account is REFUSED
     * `/schedule` (six reads to draw a grid) and ADMITTED here. Borrowing the
     * schedule's gate would have denied the department head PRODUCT.md names as
     * the reviewer.
     *
     * IT USED TO BE THE `viewer` ON BOTH SIDES OF THIS, because the gate was
     * `session.read` — which is the state that turned out to be wrong in the
     * other direction: every lecturer who could see a timetable was also offered
     * every proposal. The single-permission property is what this test is about
     * and it survives the key changing; the role holding that key does not.
     *
     * Asserted on a data-dependent branch with the failure branch asserted ABSENT:
     * "contained the heading" passes for a page whose fetch rejected.
     */
    it('admits a generation.read-only role to /schedule/proposals', async () => {
        // The contrast: one permission gets you the proposals list and NOT the
        // week grid, which needs six reads. Without this the assertion below
        // would pass just as well against a build that gated nothing.
        const grid = await fetch(`${BASE}/schedule`, {
            headers: { cookie: cookies.proposalReviewer! },
        });

        expect(grid.status, '/schedule admitted a role holding one permission').toBe(403);

        for (const role of ['admin', 'proposalReviewer'] as const) {
            const res = await fetch(`${BASE}/schedule/proposals`, { headers: { cookie: cookies[role]! } });

            expect(res.status, `/schedule/proposals refused ${role}`).toBe(200);

            const html = await res.text();

            expect(html, `/schedule/proposals failed to load for ${role}`)
                .not.toContain('Could not load proposals');

            /*
             * Either outcome of a SUCCESSFUL fetch is acceptable — the fixture
             * tenant may or may not hold proposals depending on what ran before
             * it — but one of them must be present. A shell with neither is the
             * blank-page failure this file exists to catch.
             */
            const resolved = html.includes('props_row')
                || html.includes('Nothing awaiting a decision')
                || html.includes('No proposals yet');

            expect(resolved, `/schedule/proposals rendered neither rows nor an empty state for ${role}`)
                .toBe(true);
        }
    });

    /**
     * The review screen must never state a fact about a proposal it could not
     * read.
     *
     * Two assertions, and the second is why this is a test rather than a note:
     * the absent sentence is only meaningful once the page has been shown to
     * have RENDERED, otherwise "does not contain the falsehood" passes for a
     * page that rendered nothing at all. Same rule as the redirect assertion
     * below.
     */
    it('never claims a proposal it could not read proposes nothing', async () => {
        const res = await fetch(`${BASE}/schedule/review/01a04015-0000-0000-0000-000000000000`, {
            headers: { cookie: cookies.admin! },
        });

        expect(res.status).toBe(200);

        const html = await res.text();

        // Rendered, and rendered the failure branch specifically.
        expect(html).toContain('No such proposal');

        // The two shapes of the original bug.
        expect(html, 'the empty-state sentence is a claim about the proposal, not about the fetch')
            .not.toContain('was not produced by a solver run');
        expect(html, 'a raw undefined reached user-facing copy')
            .not.toMatch(/proposal is undefined/i);
    });

    /**
     * A proposal must be REACHABLE by clicking, from both entry points. Before
     * this, the only link to `/schedule/review/:id` was inside
     * `ScheduleSolverControl`'s transient `finished` state, which a reload
     * destroys — so a proposal was reachable for minutes, by one person, while
     * dozens sat READY. Every page test passed throughout.
     *
     * Asserted in both directions: a link offered to everybody proves nothing.
     */
    it('offers a route to proposals from the schedule and the palette', async () => {
        // Entry point 1: the schedule toolbar, gated on `generation.read` rather
        // than `solver.trigger` — the person who reviews a schedule is usually
        // not the person allowed to generate one.
        const schedule = await fetch(`${BASE}/schedule`, { headers: { cookie: cookies.admin! } })
            .then((res) => res.text());

        expect(schedule, 'the schedule toolbar lost its route to the proposals list')
            .toContain('href="/schedule/proposals"');

        // Entry point 2: the nav registry, which renders into the palette.
        const palette = async (role: string) => fetch(`${BASE}/dashboard`, {
            headers: { cookie: cookies[role]! },
        }).then((res) => res.text());

        const adminHtml = await palette('admin');
        const withoutHtml = await palette('viewer');

        /*
         * MATCHED AS AN `href` ATTRIBUTE, not as a bare path.
         *
         * The bare string first passed the positive cases and then FAILED the
         * negative one, because the dev server inlines a route manifest naming
         * every page — so `/schedule/proposals` appears in the document of a
         * role that cannot reach it. A guard that matches build metadata instead
         * of a link is the "matches for the wrong reason" failure in miniature:
         * it would also have gone green had the actual link disappeared.
         */
        const LINK = 'href="/schedule/proposals"';

        expect(adminHtml).toContain(LINK);

        /*
         * The negative direction, and it needs the page proven to have rendered
         * first — otherwise "no proposals entry" passes for a blank dashboard,
         * which is the trap this file exists to catch.
         *
         * THE VIEWER IS NOW THE NEGATIVE CASE. It used to be the second positive
         * one, on the reasoning that `session.read` was the gate and the viewer
         * holds it — which is exactly the state that turned out to be wrong:
         * "may look at the timetable" was offering every solver proposal the
         * tenant had ever produced. The gate is `generation.read` now, so a role
         * holding only `session.read` belongs on this side of the assertion.
         */
        expect(withoutHtml, 'the dashboard itself failed to render, so the absence below proves nothing')
            .toContain('Ctrl');
        expect(withoutHtml, 'offered to a role without generation.read')
            .not.toContain(LINK);
    });

    /**
     * NEITHER Display NOR Proposals is offered to somebody who can only look at
     * a schedule.
     *
     * This is the report that produced `tenant.read` and `generation.read`. Both
     * entries were gated on `session.read` — which sounds exactly like "may view
     * the timetable" — so every lecturer was shown a link to the institution's
     * own settings and a link to every solver proposal it had ever produced.
     *
     * Read off `/manage`, because that is the one page the viewer can still
     * render, and asserted BOTH WAYS in one test: the admin's copy of the same
     * page must contain both labels. An absence check alone would pass against a
     * build where the navigation stopped rendering entirely, which is precisely
     * the trap this file exists to catch.
     */
    it('keeps Display and Proposals out of a schedule viewer\'s navigation', async () => {
        const body = async (role: string) => fetch(`${BASE}/manage`, {
            headers: { cookie: cookies[role]! },
        }).then((res) => res.text())
            // Rendered body only. The hydration payload carries the whole nav
            // registry as JSON, so matching there would find both labels for
            // every role and prove nothing.
            .then((html) => html.split('<script type="application/json"')[0] ?? '');

        const viewer = await body('viewer');

        expect(viewer).toContain('do not have read access to any management section');
        expect(viewer).not.toContain('Proposals');
        expect(viewer).not.toContain('Display');

        const admin = await body('admin');

        expect(admin).toContain('Proposals');
        expect(admin).toContain('Display');
    });

    /**
     * The create action stays on the DETAIL screen, so entering a run of records
     * does not round-trip through the list.
     *
     * Creating lands you on the row you just made, so without this the loop was:
     * back to the list, New, fill, create — two navigations per record whose only
     * purpose was to reach a button that had been on screen a moment earlier.
     *
     * Both directions in one test, because "the link is not there" is true of a
     * page that rendered nothing: the room's own code proves the first page
     * rendered, and the constraint's own name proves the second did.
     */
    it('offers the next record from the detail screen, unless the entity forbids it', async () => {
        const detail = async (path: string) => fetch(`${BASE}${path}`, {
            headers: { cookie: cookies.admin! },
        }).then((res) => res.text())
            // Rendered body only — the hydration payload carries every registry
            // key, so a raw match would find the path for any entity at all.
            .then((html) => html.split('<script type="application/json"')[0] ?? '');

        const room = await detail('/manage/rooms/test-room-private-a');

        expect(room, 'the page did not render, so the link below proves nothing').toContain('A101');
        expect(room).toContain('href="/manage/rooms/new"');

        /*
         * `hideCreateAction` still wins. The constraint catalogue is a fixed set
         * of switches rather than a collection you populate — framing it as one
         * is how a tenant ended up with types that had no row and were therefore
         * never evaluated — so the detail screen must not grow the affordance the
         * list deliberately does without.
         */
        const stored = await ownerDb.constraint.findFirstOrThrow({ where: { tenantId: TENANT_A } });
        const rule = await detail(`/manage/constraints/${stored.id}`);

        expect(rule, 'the constraint page did not render').toContain(stored.name);
        expect(rule, 'a hideCreateAction entity grew a create button')
            .not.toContain('href="/manage/constraints/new"');
    });

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
     * A picker whose options come from a resource the page's gate does not cover is
     * OMITTED, never rendered empty. Six relations across four entities were in
     * that state and only one involved access roles, so both pages are checked.
     *
     * Every absence is paired with an admin rendering the SAME page — "does not
     * contain X" passes just as well for a page that rendered nothing.
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
     * A page nobody can NAVIGATE to might as well not exist. Every other assertion
     * here fetches a URL directly, which is how the /my section shipped with
     * working pages, correct gating and no way to click into it. So the header is
     * asserted too, in both directions.
     */
    it('offers the /my section in the header to exactly the roles that can use it', async () => {
        const header = async (role: string) => {
            // `/dashboard`, not `/`: the root is the PUBLIC landing page and uses
            // the `empty` layout, which renders no header at all — so fetching it
            // here would find no nav and report every role as "correctly not
            // offered the section".
            const html = await fetch(`${BASE}/dashboard`, { headers: { cookie: cookies[role]! } })
                .then((res) => res.text());

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

    it('names WHICH permissions would open the schedule, not just that access is denied', async () => {
        /*
         * "You do not have access" sends someone to ask for the wrong thing, so
         * the denial states what would fix it.
         *
         * IT USED TO NAME FIVE — `term.read`, `time_grid.read`, `group.read`,
         * `room.read`, `person.read` — because the page assembled the
         * institution's directory in order to draw itself, and the `viewer`
         * (holding `session.read`) was the role it refused. That was an honest
         * message about a wrong requirement: none of those five is anything to do
         * with looking at a timetable, and demanding them made "a lecturer sees
         * their own schedule" unexpressible. The viewer now renders the page (see
         * the PAGES table), so the denial belongs to a role holding NEITHER read
         * key.
         *
         * BOTH keys are named on purpose. Told only `session.read`, an admin
         * grants the whole institution's timetable to somebody who needed their
         * own — an over-grant chosen by an error message.
         */
        const res = await fetch(`${BASE}/schedule`, { headers: { cookie: cookies.constraintViewer! } });
        const html = await res.text();

        expect(res.status).toBe(403);

        for (const permission of ['session.read', 'session.read_own']) {
            expect(html, `denial should name ${permission}`).toContain(permission);
        }

        // And none of the five it no longer needs, which is what would show the
        // old requirement had quietly come back.
        for (const permission of ['term.read', 'time_grid.read', 'group.read', 'room.read', 'person.read']) {
            expect(html, `the schedule should not demand ${permission}`).not.toContain(permission);
        }
    });

    /*
     * THE READ-ONLY RENDERING PATH. Step 13's rule: `.read` without `.update` gets
     * STATIC TEXT, not disabled inputs, which read as "unavailable right now"
     * rather than "not yours". The constraint grid was the last place still
     * rendering disabled inputs and nothing pinned the fix.
     *
     * Every absence below is paired with the admin rendering the SAME page: zero
     * toggles for a viewer means nothing unless the page produces toggles at all.
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
