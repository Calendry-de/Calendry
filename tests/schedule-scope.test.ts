import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, TEST_PASSWORD, ownerDb, seed, teardown } from './helpers/seed';
import { api, login } from './helpers/client';

/**
 * `session.read_own`: seeing YOUR timetable without being able to read anybody
 * else's, and without needing to query the institution to draw it.
 *
 * WHAT THIS FILE IS ACTUALLY GUARDING
 *
 * Three things, none of which a CRUD-shaped test would touch:
 *
 *   1. THE DIRECTION OF THE GROUP WALK. A Session assigned to a Cohort is
 *      attended by everyone in its Seminars: attendance flows DOWN
 *      (TAXONOMY.md §6), so "is this session mine" walks UP from the Groups I
 *      am a member of. Using `descendantGroupIds` instead would show a Cohort
 *      member every seminar's private sessions, and would look perfectly correct
 *      on any fixture whose groups are flat. So the fixture is NOT flat, and a
 *      sibling seminar is asserted invisible.
 *
 *   2. THE CONTEXT AGREEING WITH THE SESSION LIST. `/api/schedule/context`
 *      publishes names for the rooms, people and groups in the visible sessions.
 *      If its idea of "visible" were even slightly wider than
 *      `/api/sessions`, it would leak a name for something the caller cannot
 *      read, silently, since nothing on screen would show it. Both call one
 *      function; these assertions are what prove they still do.
 *
 *   3. THAT DRAWING NEEDS NO DIRECTORY PERMISSION. The point of the change: a
 *      lecturer learns which room they are in and who leads the lecture without
 *      holding `person.read`, which is authority over the whole staff list.
 */
const TENANT_A = 'test-tenant-a';

/** Only `session.read_own`. The default `member` role's shape. */
const OWN_VIEWER = 'own-viewer@test.local';

const cookies: Record<string, string> = {};

const ids = {
    /** A second seminar under the same cohort: the sibling that must stay hidden. */
    siblingSeminar: 'scope-group-sibling',
    /** Somebody else's room and person, to prove the context does not name them. */
    otherRoom: 'scope-room-other',
    otherPerson: 'scope-person-other',
    ownPerson: 'scope-person-own',
    sessionDirect: 'scope-session-direct',
    sessionCohort: 'scope-session-cohort',
    sessionSeminar: 'scope-session-seminar',
    sessionSibling: 'scope-session-sibling',
    sessionUnrelated: 'scope-session-unrelated',
    /** Owen COVERS this one (issue #30): no membership, no attachment at all. */
    sessionCovered: 'scope-session-covered',
};

interface SessionRow { id: string }
interface Context {
    scope: 'any' | 'own';
    resolvedTermId: string;
    terms: { id: string }[];
    timeGrids: { id: string }[];
    rooms: { id: string; code: string }[];
    people: { id: string }[];
    groups: { id: string }[];
}

/**
 * One Session in the shared fixture's term/grid/kind, placed somewhere nothing
 * else occupies. Placement is irrelevant to this file (visibility is), so the
 * only thing that matters is that two sessions never collide into a constraint
 * the fixture does not expect.
 */
async function makeSession(id: string, blockIndex: number) {
    await ownerDb.session.create({
        data: {
            id,
            tenantId: TENANT_A,
            termId: 'test-term-a',
            kindId: 'test-kind-a',
            timeGridId: 'test-grid-a',
            generationId: 'test-generation-a',
            termWeek: 1,
            dayOfWeek: 3,
            blockIndex,
        },
    });
}

beforeAll(async () => {
    await seed();
    await ownerDb.$executeRawUnsafe(`DELETE FROM account WHERE email = '${OWN_VIEWER}'`);

    // A sibling of `test-group-seminar-a`, under the same cohort. The closure
    // trigger maintains `group_closure`; nothing here touches it.
    await ownerDb.group.create({
        data: {
            id: ids.siblingSeminar,
            tenantId: TENANT_A,
            parentGroupId: 'test-group-cohort-a',
            name: 'Seminar A2',
        },
    });

    await ownerDb.room.create({
        data: { id: ids.otherRoom, tenantId: TENANT_A, code: 'SECRET', name: 'Other Room', capacity: 10 },
    });
    await ownerDb.person.create({
        data: { id: ids.otherPerson, tenantId: TENANT_A, givenName: 'Otto', familyName: 'Other' },
    });

    /*
     * The acting person. A member of the SEMINAR, not the cohort, so the
     * up-walk has something to walk, and the down-walk would give a different
     * (wrong) answer.
     */
    await ownerDb.person.create({
        data: { id: ids.ownPerson, tenantId: TENANT_A, givenName: 'Owen', familyName: 'Own', email: 'owen@a.test' },
    });
    await ownerDb.membership.create({
        data: { tenantId: TENANT_A, personId: ids.ownPerson, groupId: 'test-group-seminar-a' },
    });

    const role = await ownerDb.accessRole.create({
        data: { tenantId: TENANT_A, key: 'own-viewer', name: 'Own Viewer' },
    });

    await ownerDb.accessRolePermission.create({
        data: { accessRoleId: role.id, permissionKey: 'session.read_own', tenantId: TENANT_A },
    });
    await ownerDb.personAccessRole.create({
        data: { personId: ids.ownPerson, accessRoleId: role.id, tenantId: TENANT_A },
    });

    const template = await ownerDb.account.findFirstOrThrow({ where: { email: ACCOUNTS.adminA } });
    const account = await ownerDb.account.create({
        data: { email: OWN_VIEWER, passwordHash: template.passwordHash },
    });

    await ownerDb.accountPerson.create({ data: { accountId: account.id, personId: ids.ownPerson } });

    // --- the five sessions, one per way of being (or not being) "mine" -------
    await makeSession(ids.sessionDirect, 1);
    await ownerDb.sessionPerson.create({
        data: { tenantId: TENANT_A, sessionId: ids.sessionDirect, personId: ids.ownPerson },
    });

    // Assigned to the COHORT: mine, because I am in one of its seminars.
    await makeSession(ids.sessionCohort, 2);
    await ownerDb.sessionGroup.create({
        data: { tenantId: TENANT_A, sessionId: ids.sessionCohort, groupId: 'test-group-cohort-a' },
    });
    // Ada leads it, in a room. This is the "who holds it, and where" the whole
    // change is about; both must reach a caller with no directory permission.
    await ownerDb.sessionPerson.create({
        data: { tenantId: TENANT_A, sessionId: ids.sessionCohort, personId: 'test-person-a' },
    });
    await ownerDb.sessionRoom.create({
        data: { tenantId: TENANT_A, sessionId: ids.sessionCohort, roomId: 'test-room-private-a' },
    });

    await makeSession(ids.sessionSeminar, 3);
    await ownerDb.sessionGroup.create({
        data: { tenantId: TENANT_A, sessionId: ids.sessionSeminar, groupId: 'test-group-seminar-a' },
    });

    // The sibling seminar's own session. NOT mine, and the one a reversed
    // closure walk would hand over.
    await makeSession(ids.sessionSibling, 4);
    await ownerDb.sessionGroup.create({
        data: { tenantId: TENANT_A, sessionId: ids.sessionSibling, groupId: ids.siblingSeminar },
    });

    // Nobody's business: another person, another room, no group at all.
    await makeSession(ids.sessionUnrelated, 5);
    await ownerDb.sessionPerson.create({
        data: { tenantId: TENANT_A, sessionId: ids.sessionUnrelated, personId: ids.otherPerson },
    });
    await ownerDb.sessionRoom.create({
        data: { tenantId: TENANT_A, sessionId: ids.sessionUnrelated, roomId: ids.otherRoom },
    });

    /**
     * Issue #30's addition to "mine": COVERING it, via `session_substitution`
     * rather than `session_person`. Owen has no membership, no direct
     * attachment, nothing `ownSessionClause`'s first two branches would ever
     * find; only the third one does, which is the entire point of asserting
     * it here rather than trusting the code review.
     */
    await makeSession(ids.sessionCovered, 6);
    await ownerDb.sessionSubstitution.create({
        data: { tenantId: TENANT_A, sessionId: ids.sessionCovered, coveringPersonId: ids.ownPerson },
    });

    cookies.own = (await login(OWN_VIEWER, TEST_PASSWORD, 'test-a')).cookie;
    cookies.admin = (await login(ACCOUNTS.adminA, TEST_PASSWORD, 'test-a')).cookie;
    cookies.viewer = (await login(ACCOUNTS.viewerA, TEST_PASSWORD, 'test-a')).cookie;
}, 60_000);

afterAll(async () => {
    await ownerDb.$executeRawUnsafe(`DELETE FROM account WHERE email = '${OWN_VIEWER}'`);
    await teardown();
    await ownerDb.$disconnect();
});

describe('GET /api/sessions under session.read_own', () => {
    it('returns the sessions this person is in, by attachment and by group', async () => {
        const res = await api<SessionRow[]>('/api/sessions?termId=test-term-a', { cookie: cookies.own });

        expect(res.status).toBe(200);

        const seen = res.body.map((row) => row.id).sort();

        /*
         * `test-session-a` is the shared fixture's own, and it belongs here: it
         * is assigned to `test-group-seminar-a`, which Owen is a member of. It
         * being Ada's session is irrelevant: Owen attends it, so it is his
         * timetable too, which is precisely what a group-scoped lecture means.
         */
        expect(seen).toEqual(
            [ids.sessionCohort, ids.sessionDirect, ids.sessionSeminar, ids.sessionCovered, 'test-session-a'].sort(),
        );
    });

    /**
     * Issue #30: a THIRD way to be "mine" that has nothing to do with
     * membership or attachment. Owen holds no `session_person` row here at
     * all: if this passed for the wrong reason (a bug that widened `own` to
     * everything), the earlier "sibling"/"unrelated" assertions would already
     * have failed, so this specifically isolates the substitution branch.
     */
    it('includes a session the caller is COVERING, with no session_person row of their own', async () => {
        const attachment = await ownerDb.sessionPerson.findFirst({
            where: { sessionId: ids.sessionCovered, personId: ids.ownPerson },
        });

        expect(attachment, 'the fixture attached Owen directly, which would defeat the point').toBeNull();

        const res = await api<SessionRow[]>('/api/sessions?termId=test-term-a', { cookie: cookies.own });

        expect(res.body.map((row) => row.id)).toContain(ids.sessionCovered);
    });

    /**
     * The direction assertion, stated on its own because it is the one that a
     * plausible wrong implementation passes everything else with.
     */
    it('does not hand a seminar member the sibling seminar’s sessions', async () => {
        const res = await api<SessionRow[]>('/api/sessions?termId=test-term-a', { cookie: cookies.own });
        const seen = res.body.map((row) => row.id);

        expect(seen, 'the closure was walked DOWN instead of UP').not.toContain(ids.sessionSibling);
        expect(seen).not.toContain(ids.sessionUnrelated);
    });

    /**
     * A filter cannot widen the scope. Asking for somebody else's sessions by
     * name returns the ones you share with them, not theirs.
     */
    it('composes a person filter with the scope instead of replacing it', async () => {
        const res = await api<SessionRow[]>(
            '/api/sessions?termId=test-term-a&personId=scope-person-other',
            { cookie: cookies.own },
        );

        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);
    });

    /**
     * The filter has to WORK, not merely appear. A `read_own` caller narrowing to
     * one of their own groups is the request this rule exists for, and the
     * control would be a decoration if the query behind it refused or ignored the
     * parameter.
     */
    it('narrows to one of the caller’s own groups', async () => {
        const res = await api<SessionRow[]>(
            '/api/sessions?termId=test-term-a&groupId=test-group-seminar-a',
            { cookie: cookies.own },
        );

        expect(res.status).toBe(200);

        const seen = res.body.map((row) => row.id).sort();

        // The seminar's own sessions, not the cohort-wide one, which is theirs
        // but is not assigned to this group.
        expect(seen).toEqual([ids.sessionSeminar, 'test-session-a'].sort());
    });

    it('still returns everything to a caller holding session.read', async () => {
        const res = await api<SessionRow[]>('/api/sessions?termId=test-term-a', { cookie: cookies.viewer });
        const seen = res.body.map((row) => row.id);

        // The control. Without it every assertion above would pass against a
        // build where /api/sessions returned nothing to anybody.
        expect(seen).toContain(ids.sessionSibling);
        expect(seen).toContain(ids.sessionUnrelated);
    });

    /**
     * The schedule's filters are multi-select: one dimension repeated is a
     * UNION ("in room A or room B"), and the same route still takes a single
     * id as a plain string (every test above). Pinned by CALLING the route,
     * because the client's `request<T>()` is an unchecked assertion about
     * what the server sends (CLAUDE.md, the `/api/[resource]` trap).
     */
    it('takes several ids per filter and returns their union', async () => {
        const rooms = await api<SessionRow[]>(
            `/api/sessions?termId=test-term-a&roomId=test-room-private-a&roomId=${ ids.otherRoom }`,
            { cookie: cookies.viewer },
        );

        expect(rooms.status).toBe(200);

        const inRooms = rooms.body.map((row) => row.id);

        expect(inRooms).toContain(ids.sessionCohort);
        expect(inRooms).toContain(ids.sessionUnrelated);
        expect(inRooms, 'a session in neither room came back').not.toContain(ids.sessionSeminar);

        const people = await api<SessionRow[]>(
            `/api/sessions?termId=test-term-a&personId=${ ids.ownPerson }&personId=${ ids.otherPerson }`,
            { cookie: cookies.viewer },
        );

        expect(people.status).toBe(200);

        const withPeople = people.body.map((row) => row.id);

        expect(withPeople).toContain(ids.sessionDirect);
        expect(withPeople).toContain(ids.sessionUnrelated);
        expect(withPeople).not.toContain(ids.sessionSeminar);

        // Across dimensions the filters INTERSECT: Owen's sessions in Otto's
        // room is an empty set on this fixture, and must stay one.
        const both = await api<SessionRow[]>(
            `/api/sessions?termId=test-term-a&personId=${ ids.ownPerson }&roomId=${ ids.otherRoom }`,
            { cookie: cookies.viewer },
        );

        expect(both.status).toBe(200);
        expect(both.body).toEqual([]);
    });
});

describe('GET /api/schedule/context', () => {
    it('resolves a termId this tenant does not have to the first real term, never echoing it back', async () => {
        /*
         * THE PRODUCTION FREEZE. A stale id (a deleted term, or the
         * remembered-term cookie carried over from another tenant) used to come
         * back as `resolvedTermId` verbatim; the page cleared it and its
         * watchEffect re-seeded it from the same response, a reactive cycle
         * Vue's dev build aborts ("Maximum recursive updates exceeded") and
         * the production build runs forever. Reproduced at 1,781 context
         * requests in four seconds. "Resolved" now means a term in `terms`.
         */
        const res = await api<Context>('/api/schedule/context?termId=does-not-exist', { cookie: cookies.admin });

        expect(res.status).toBe(200);
        expect(res.body.resolvedTermId).not.toBe('does-not-exist');
        expect(res.body.terms.map((term) => term.id)).toContain(res.body.resolvedTermId);
        expect(res.body.resolvedTermId).toBe(res.body.terms[0]!.id);
    });

    it('still honours a termId the tenant has', async () => {
        const res = await api<Context>('/api/schedule/context?termId=test-term-a', { cookie: cookies.admin });

        expect(res.body.resolvedTermId).toBe('test-term-a');
    });

    it('names the room and the lecturer of a session, with no directory permission', async () => {
        const res = await api<Context>('/api/schedule/context?termId=test-term-a', { cookie: cookies.own });

        expect(res.status).toBe(200);
        expect(res.body.scope).toBe('own');

        // The whole point: "which room am I in, and who is leading it", answered
        // without `room.read` or `person.read`.
        expect(res.body.rooms.map((r) => r.id)).toContain('test-room-private-a');
        expect(res.body.people.map((p) => p.id)).toContain('test-person-a');

        // And the frame, which is not about anybody: every term, every grid.
        expect(res.body.terms.length).toBeGreaterThan(0);
        expect(res.body.timeGrids.length).toBeGreaterThan(0);
    });

    /**
     * The agreement assertion. A context wider than the session list is a leak
     * that renders as nothing at all, so it can only be caught here.
     */
    it('names nothing from a session this caller cannot read', async () => {
        const res = await api<Context>('/api/schedule/context?termId=test-term-a', { cookie: cookies.own });

        expect(res.body.rooms.map((r) => r.id), 'a room from an invisible session was named')
            .not.toContain(ids.otherRoom);
        expect(res.body.people.map((p) => p.id), 'a person from an invisible session was named')
            .not.toContain(ids.otherPerson);
        expect(res.body.groups.map((g) => g.id), 'the sibling seminar was named')
            .not.toContain(ids.siblingSeminar);
    });

    /**
     * The Group's PARENT travels too. Not a widening (the child being visible
     * already implies it), and without it the inspector renders a seminar as an
     * orphan, which is what disambiguates two identically-named ones.
     */
    it('includes the ancestors of a visible group', async () => {
        const res = await api<Context>('/api/schedule/context?termId=test-term-a', { cookie: cookies.own });
        const groups = res.body.groups.map((g) => g.id);

        expect(groups).toContain('test-group-seminar-a');
        expect(groups).toContain('test-group-cohort-a');
    });

    it('widens for a caller holding session.read', async () => {
        const res = await api<Context>('/api/schedule/context?termId=test-term-a', { cookie: cookies.admin });

        expect(res.body.scope).toBe('any');
        expect(res.body.rooms.map((r) => r.id)).toContain(ids.otherRoom);
        expect(res.body.people.map((p) => p.id)).toContain(ids.otherPerson);
    });

    it('refuses a caller holding neither read key', async () => {
        // `verify@calendry.local` does not exist here; the constraint viewer does
        // not either. The fixture's tenant-B admin has no identity in tenant A,
        // so the cheapest "holds neither" is a role built for it.
        const role = await ownerDb.accessRole.create({
            data: { tenantId: TENANT_A, key: 'scope-nothing', name: 'Nothing' },
        });

        await ownerDb.accessRolePermission.create({
            data: { accessRoleId: role.id, permissionKey: 'constraint.read', tenantId: TENANT_A },
        });
        await ownerDb.personAccessRole.deleteMany({ where: { personId: ids.otherPerson } });
        await ownerDb.personAccessRole.create({
            data: { personId: ids.otherPerson, accessRoleId: role.id, tenantId: TENANT_A },
        });

        const template = await ownerDb.account.findFirstOrThrow({ where: { email: ACCOUNTS.adminA } });

        await ownerDb.$executeRawUnsafe("DELETE FROM account WHERE email = 'scope-nothing@test.local'");

        const account = await ownerDb.account.create({
            data: { email: 'scope-nothing@test.local', passwordHash: template.passwordHash },
        });

        await ownerDb.accountPerson.create({ data: { accountId: account.id, personId: ids.otherPerson } });

        const { cookie } = await login('scope-nothing@test.local', TEST_PASSWORD, 'test-a');

        const sessions = await api('/api/sessions?termId=test-term-a', { cookie });
        const context = await api('/api/schedule/context', { cookie });

        expect(sessions.status).toBe(403);
        expect(context.status).toBe(403);
        // BOTH keys named. Told only `session.read`, an admin grants the whole
        // institution's timetable to somebody who needed their own.
        expect(JSON.stringify(context.body)).toContain('session.read_own');

        await ownerDb.$executeRawUnsafe("DELETE FROM account WHERE email = 'scope-nothing@test.local'");
    });
});

describe('the page itself', () => {
    const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:8080';

    async function body(role: string): Promise<string> {
        const html = await fetch(`${BASE}/schedule`, { headers: { cookie: cookies[role]! } })
            .then((res) => res.text());

        // Rendered body only: the hydration payload carries every label as
        // JSON, so matching there would find the filters for every role.
        return html.split('<script type="application/json"')[0] ?? '';
    }

    /**
     * The headline: a role holding ONE permission draws a real timetable.
     *
     * The marker is a grid cell, which exists only once the geometry resolved.
     * "200 OK" is what a blanked page returns, and that is the failure this whole
     * area keeps re-learning.
     */
    it('draws for a role holding only session.read_own', async () => {
        const html = await body('own');

        expect(html).toContain('grid_cell');
        expect(html, 'the page did not say whose timetable this is').toContain('Your schedule');
    });

    /**
     * A FILTER APPEARS WHEN IT CAN NARROW SOMETHING, not when a permission says
     * so. Owen holds neither `group.read` nor `person.read` nor `room.read`, and
     * this one fixture exercises both sides of the rule at once:
     *
     *   groups  cohort + seminar   → two, so the filter is offered
     *   people  Owen + Ada         → two, so the filter is offered
     *   rooms   one room, twice    → one, so there is nothing to narrow
     *
     * The room case is the half that would otherwise go untested, and it is what
     * distinguishes this rule from "always show them": a checkbox list offering
     * one row claims this institution has one room to choose between.
     *
     * Every absence is paired with the admin's copy of the same page, because
     * "does not contain Room" passes just as well for a page that rendered
     * nothing.
     *
     * The marker is each filter's LEGEND (`ScheduleFilterMultiSelect`), matched
     * with its class so a stray "Room" in a chip's label cannot satisfy it. The
     * drawer is `v-show`, so its markup is in the server-rendered body.
     */
    it('offers a filter to a read_own caller whenever it has options to offer', async () => {
        const legend = (label: string) => new RegExp(`mpick_label[^>]*>${ label }<`);
        const own = await body('own');

        expect(own, 'sessions span two groups, so narrowing to one is offered')
            .toMatch(legend('Group'));
        expect(own, 'two people appear, so narrowing to one is offered')
            .toMatch(legend('Person'));
        expect(own, 'one room, so there is nothing to narrow')
            .not.toMatch(legend('Room'));

        // Term stays unconditional: the frame every schedule is drawn in.
        expect(own).toContain('Term');

        const admin = await body('admin');

        expect(admin).toMatch(legend('Group'));
        expect(admin).toMatch(legend('Room'));
        expect(admin).toMatch(legend('Person'));
    });

    /**
     * No editing permissions, so no editing affordances.
     *
     * The inspector's own empty state is the marker, because nothing is selected
     * on first render: it offers "details and edit it" to somebody who may edit
     * and "details" to somebody who may not, so the pair proves the panel
     * rendered AND that it rendered the read-only half.
     */
    it('offers no editor to a read-only caller', async () => {
        const own = await body('own');

        expect(own).not.toContain('Add event');
        expect(own).not.toContain('Generate schedule');
        expect(own).toContain('Select a session to see its details');
        expect(own, 'the inspector offered editing to a caller who cannot edit')
            .not.toContain('details and edit it');

        // The control: the same panel DOES offer it to somebody who may.
        const admin = await body('admin');

        expect(admin).toContain('details and edit it');
        expect(admin).toContain('Add event');
    });
});
