import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, TEST_PASSWORD, type Fixtures, ownerDb, seed, teardown } from './helpers/seed';
import { api, login } from './helpers/client';

/**
 * A manual override of who leads a Session — #7 item 4.
 *
 * WHY THIS ROUTE EXISTS RATHER THAN REUSING `details.post.ts`. That route
 * refuses ANY edit to an Offering-linked Session's people, because they are
 * copied from the Offering and the solver on every apply. This route's whole
 * job is enforcing the ONE precondition under which an override is safe from
 * that overwrite: the Session is already LOCKED (skipped entirely by
 * `planMaterialization`, on a rebuild as much as a repair), or it is an Event
 * (structurally invisible to the solver regardless of `isLocked`).
 *
 * ONLY LECTURER ROWS MOVE. `session_person` rows with `roleId IS NULL`
 * (ordinary attendees) are a separate concern this route must not touch.
 */
let f: Fixtures;
let cookie = '';
let lecturerRoleId = '';
let personA = '';
let personB = '';

beforeAll(async () => {
    f = await seed();
    cookie = (await login(ACCOUNTS.adminA, TEST_PASSWORD)).cookie;

    // The fixture tenant provisions no domain Role at all — `provision:tenant`
    // creates `lecturer` for a real tenant, but this fixture hand-seeds, so the
    // precondition this route depends on has to be built here explicitly.
    lecturerRoleId = (await ownerDb.role.create({
        data: { tenantId: f.tenantA, key: 'lecturer', name: 'Lecturer', isSystem: true },
    })).id;

    personA = f.personA;
    personB = (await ownerDb.person.create({
        data: { tenantId: f.tenantA, givenName: 'Bo', familyName: 'Backup', email: 'backup@a.test' },
    })).id;
});

afterAll(async () => {
    await teardown();
    await ownerDb.$disconnect();
});

const setLecturers = (sessionId: string, personIds: string[]) => api(
    `/api/sessions/${sessionId}/lecturers`,
    { method: 'POST', cookie, body: JSON.stringify({ personIds }) },
);

describe('an unlocked Offering-linked Session', () => {
    it('refuses the override, naming the fix', async () => {
        const session = await ownerDb.session.findUniqueOrThrow({ where: { id: 'test-session-a' } });

        expect(session.isLocked).toBe(false);
        expect(session.offeringId).not.toBeNull();

        const res = await setLecturers('test-session-a', [personA]);

        expect(res.status).toBe(409);
        expect(JSON.stringify(res.body)).toContain('Lock');

        // Refused means REFUSED — nothing written.
        const rows = await ownerDb.sessionPerson.findMany({
            where: { sessionId: 'test-session-a', roleId: lecturerRoleId },
        });

        expect(rows).toHaveLength(0);
    });
});

describe('a locked Offering-linked Session', () => {
    it('accepts the override', async () => {
        await ownerDb.session.update({ where: { id: 'test-session-a' }, data: { isLocked: true } });

        const res = await setLecturers('test-session-a', [personB]);

        expect(res.status).toBe(200);

        const rows = await ownerDb.sessionPerson.findMany({
            where: { sessionId: 'test-session-a', roleId: lecturerRoleId },
        });

        expect(rows.map((r) => r.personId)).toEqual([personB]);
    });

    it('replaces wholesale: dropping a lecturer DELETES their row', async () => {
        // personB was the sole lecturer a moment ago. Naming only a third
        // person here drops them, and dropping is a delete — not a demotion to
        // plain attendee, which would invent an attendance fact nobody asked
        // for. See the route's own comment for why.
        const personC = (await ownerDb.person.create({
            data: { tenantId: f.tenantA, givenName: 'Cy', familyName: 'Cover', email: 'cover@a.test' },
        })).id;

        const res = await setLecturers('test-session-a', [personC]);

        expect(res.status).toBe(200);

        const stillThere = await ownerDb.sessionPerson.findUnique({
            where: { sessionId_personId: { sessionId: 'test-session-a', personId: personB } },
        });

        expect(stillThere).toBeNull();
    });

    it('PROMOTES an existing plain attendee rather than erroring on the shared key', async () => {
        /*
         * `session_person`'s key is (sessionId, personId) — one row per person
         * per Session. The fixture attaches personA to this Session already,
         * with `roleId: null` (an ordinary attendee). Naming them here must
         * turn that SAME row into a lecturer row, not attempt a second row for
         * the same pair, which the primary key would refuse.
         */
        const before = await ownerDb.sessionPerson.findUniqueOrThrow({
            where: { sessionId_personId: { sessionId: 'test-session-a', personId: personA } },
        });

        expect(before.roleId).toBeNull();

        const res = await setLecturers('test-session-a', [personA]);

        expect(res.status).toBe(200);

        const after = await ownerDb.sessionPerson.findUniqueOrThrow({
            where: { sessionId_personId: { sessionId: 'test-session-a', personId: personA } },
        });

        expect(after.roleId).toBe(lecturerRoleId);
    });

    it('leaves an unrelated attendee’s row untouched', async () => {
        const bystander = (await ownerDb.person.create({
            data: { tenantId: f.tenantA, givenName: 'By', familyName: 'Stander', email: 'bystander@a.test' },
        })).id;

        await ownerDb.sessionPerson.create({
            data: { tenantId: f.tenantA, sessionId: 'test-session-a', personId: bystander, roleId: null },
        });

        const res = await setLecturers('test-session-a', [personA]);

        expect(res.status).toBe(200);

        const row = await ownerDb.sessionPerson.findUniqueOrThrow({
            where: { sessionId_personId: { sessionId: 'test-session-a', personId: bystander } },
        });

        expect(row.roleId).toBeNull();
    });

    it('emits SET_LECTURERS with before and after', async () => {
        const res = await setLecturers('test-session-a', [personA, personB]);

        expect(res.status).toBe(200);

        const events = await ownerDb.sessionEvent.findMany({
            where: { sessionId: 'test-session-a', type: 'SET_LECTURERS' },
            orderBy: { createdAt: 'desc' },
        });

        expect(events.length).toBeGreaterThan(0);

        const payload = events[0]!.payload as { before: string[]; after: string[] };

        expect(payload.before).toEqual([personA]);
        expect(payload.after.slice().sort()).toEqual([personA, personB].sort());
    });

    it('refuses another tenant’s person', async () => {
        const res = await setLecturers('test-session-a', [f.personB]);

        expect(res.status).toBe(404);
    });
});

describe('an Event', () => {
    it('accepts the override with no lock required', async () => {
        const event = await ownerDb.session.create({
            data: {
                tenantId: f.tenantA, termId: 'test-term-a', kindId: 'test-kind-a',
                title: 'Open day', termWeek: 1, dayOfWeek: 1, blockIndex: 0,
                generationId: 'test-generation-a', isLocked: false,
            },
        });

        const res = await setLecturers(event.id, [personA]);

        expect(res.status).toBe(200);

        const rows = await ownerDb.sessionPerson.findMany({
            where: { sessionId: event.id, roleId: lecturerRoleId },
        });

        expect(rows.map((r) => r.personId)).toEqual([personA]);
    });
});

describe('the write boundary', () => {
    it('needs session.assign_lecturer, which session.update does not imply', async () => {
        // viewer-a holds only session.read.
        const viewer = (await login(ACCOUNTS.viewerA, TEST_PASSWORD)).cookie;
        const res = await api('/api/sessions/test-session-a/lecturers', {
            method: 'POST', cookie: viewer, body: JSON.stringify({ personIds: [] }),
        });

        expect(res.status).toBe(403);
    });
});
