import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, TEST_PASSWORD, type Fixtures, ownerDb, seed, teardown } from './helpers/seed';
import { api, login } from './helpers/client';

/**
 * Substitutions / Vertretungen (issue #30): covering a Session someone cannot
 * teach, as an OVERLAY on one occurrence rather than an edit to the Offering's
 * own assignment.
 *
 * WHAT THIS FILE GUARDS, THAT A CRUD TEST WOULD NOT:
 *
 *   1. THE PICKER FILTERS BEFORE CREATION, not after. `substitute-candidates`
 *      must never offer somebody already teaching (or already covering) an
 *      overlapping Session — the ticket's own words: "not let a clash be
 *      created and warned about after."
 *   2. THE SAME CHECK IS RE-ENFORCED AT WRITE TIME. A picker's list can go
 *      stale; `substitute.post.ts` must refuse a now-busy person rather than
 *      trust the client.
 *   3. THE ORIGINAL ASSIGNMENT SURVIVES. `session_person` is never touched by
 *      a substitution — "Frau Müller's lesson, covered by Herr Schmidt" is a
 *      fact ON TOP of the original, not a replacement.
 *   4. IT REACHES THE EVENT LOG as its own event type, not as an edit.
 */
let f: Fixtures;
let cookie = '';
let viewerCookie = '';
let lecturerRoleId = '';
let freePersonA = '';
let freePersonB = '';
let busyPerson = '';
let clashSessionId = '';

beforeAll(async () => {
    f = await seed();
    cookie = (await login(ACCOUNTS.adminA, TEST_PASSWORD)).cookie;
    viewerCookie = (await login(ACCOUNTS.viewerA, TEST_PASSWORD)).cookie;

    // The fixture tenant provisions no domain Role at all — `provision:tenant`
    // creates `lecturer` for a real tenant, but this fixture hand-seeds, so the
    // precondition every route here depends on has to be built explicitly, same
    // as `session-lecturer-override.test.ts`.
    lecturerRoleId = (await ownerDb.role.create({
        data: { tenantId: f.tenantA, key: 'lecturer', name: 'Lecturer', isSystem: true },
    })).id;

    async function makeLecturer(id: string, email: string): Promise<string> {
        const person = await ownerDb.person.create({
            data: { tenantId: f.tenantA, givenName: id, familyName: 'Lecturer', email },
        });

        await ownerDb.personRole.create({
            data: { tenantId: f.tenantA, personId: person.id, roleId: lecturerRoleId },
        });

        return person.id;
    }

    freePersonA = await makeLecturer('Free-A', 'free-a@a.test');
    freePersonB = await makeLecturer('Free-B', 'free-b@a.test');
    busyPerson = await makeLecturer('Busy', 'busy@a.test');

    // A second Session at test-session-a's EXACT slot (term-a, week 1, day 2,
    // block 0) so `busyPerson` is double-booked at it without touching the
    // fixture's own Session.
    const clash = await ownerDb.session.create({
        data: {
            tenantId: f.tenantA, termId: 'test-term-a', kindId: 'test-kind-a',
            timeGridId: 'test-grid-a', generationId: 'test-generation-a',
            title: 'Clash', termWeek: 1, dayOfWeek: 2, blockIndex: 0,
        },
    });

    clashSessionId = clash.id;

    await ownerDb.sessionPerson.create({
        data: { tenantId: f.tenantA, sessionId: clashSessionId, personId: busyPerson },
    });
});

afterAll(async () => {
    await teardown();
    await ownerDb.$disconnect();
});

const candidates = (q?: string) => api<{ rows: { id: string }[]; total: number }>(
    `/api/sessions/test-session-a/substitute-candidates${q ? `?q=${encodeURIComponent(q)}` : ''}`,
    { cookie },
);

const substitute = (personId: string) => api(
    '/api/sessions/test-session-a/substitute',
    { method: 'POST', cookie, body: JSON.stringify({ personId }) },
);

const uncover = () => api('/api/sessions/test-session-a/substitute', { method: 'DELETE', cookie, body: '{}' });

describe('GET substitute-candidates', () => {
    it('offers a free lecturer and excludes one double-booked at this slot', async () => {
        const res = await candidates();

        expect(res.status).toBe(200);

        const ids = res.body.rows.map((row) => row.id);

        expect(ids).toContain(freePersonA);
        expect(ids, 'a person teaching an overlapping session was offered as free').not.toContain(busyPerson);
    });

    it('excludes personA, already attached to this Session as a plain attendee', async () => {
        // The fixture attaches personA to test-session-a with roleId: null.
        // Not a lecturer-role holder either, but this asserts the RIGHT reason:
        // "already on it" is checked independently of the role filter.
        await ownerDb.personRole.create({
            data: { tenantId: f.tenantA, personId: f.personA, roleId: lecturerRoleId },
        });

        const res = await candidates();

        expect(res.body.rows.map((row) => row.id)).not.toContain(f.personA);
    });

    it('narrows by name', async () => {
        const res = await candidates('Free-B');
        const ids = res.body.rows.map((row) => row.id);

        expect(ids).toContain(freePersonB);
        expect(ids).not.toContain(freePersonA);
    });
});

describe('POST substitute', () => {
    it('covers the session and logs a SUBSTITUTE event, leaving session_person untouched', async () => {
        const before = await ownerDb.sessionPerson.findMany({ where: { sessionId: 'test-session-a' } });

        const res = await substitute(freePersonA);

        expect(res.status).toBe(200);

        const row = await ownerDb.sessionSubstitution.findUniqueOrThrow({
            where: { sessionId: 'test-session-a' },
        });

        expect(row.coveringPersonId).toBe(freePersonA);

        const after = await ownerDb.sessionPerson.findMany({ where: { sessionId: 'test-session-a' } });

        expect(after.map((p) => p.personId).sort()).toEqual(before.map((p) => p.personId).sort());

        const events = await ownerDb.sessionEvent.findMany({
            where: { sessionId: 'test-session-a', type: 'SUBSTITUTE' },
            orderBy: { createdAt: 'desc' },
        });

        expect(events.length).toBeGreaterThan(0);

        const payload = events[0]!.payload as { from: string | null; to: string | null };

        expect(payload.to).toBe(freePersonA);
    });

    it('replaces the current substitute rather than refusing, and records the correction', async () => {
        const res = await substitute(freePersonB);

        expect(res.status).toBe(200);

        // Still exactly ONE row — an upsert, not a second substitute.
        const rows = await ownerDb.sessionSubstitution.findMany({ where: { sessionId: 'test-session-a' } });

        expect(rows).toHaveLength(1);
        expect(rows[0]!.coveringPersonId).toBe(freePersonB);

        const events = await ownerDb.sessionEvent.findMany({
            where: { sessionId: 'test-session-a', type: 'SUBSTITUTE' },
            orderBy: { createdAt: 'desc' },
        });
        const payload = events[0]!.payload as { from: string | null; to: string | null };

        expect(payload.from).toBe(freePersonA);
        expect(payload.to).toBe(freePersonB);
    });

    it('refuses a person already teaching an overlapping session (409), re-checked at write time', async () => {
        const res = await substitute(busyPerson);

        expect(res.status).toBe(409);

        // Refused means REFUSED — the existing substitute is untouched.
        const row = await ownerDb.sessionSubstitution.findUniqueOrThrow({
            where: { sessionId: 'test-session-a' },
        });

        expect(row.coveringPersonId).toBe(freePersonB);
    });

    it('refuses a person who does not hold the lecturer role (422)', async () => {
        const nonLecturer = await ownerDb.person.create({
            data: { tenantId: f.tenantA, givenName: 'No', familyName: 'Role', email: 'norole@a.test' },
        });

        const res = await substitute(nonLecturer.id);

        expect(res.status).toBe(422);
    });

    it('refuses another tenant’s person', async () => {
        const res = await substitute(f.personB);

        expect(res.status).toBe(404);
    });
});

describe('DELETE substitute', () => {
    it('removes the substitution and logs SUBSTITUTE with to: null', async () => {
        const res = await uncover();

        expect(res.status).toBe(200);

        const row = await ownerDb.sessionSubstitution.findUnique({ where: { sessionId: 'test-session-a' } });

        expect(row).toBeNull();

        const events = await ownerDb.sessionEvent.findMany({
            where: { sessionId: 'test-session-a', type: 'SUBSTITUTE' },
            orderBy: { createdAt: 'desc' },
        });
        const payload = events[0]!.payload as { from: string | null; to: string | null };

        expect(payload.to).toBeNull();
        expect(payload.from).toBe(freePersonB);
    });

    it('no-ops when nothing is covering it', async () => {
        const res = await uncover();

        expect(res.status).toBe(200);
        expect((res.body as { wasCovered: boolean }).wasCovered).toBe(false);
    });
});

describe('the write boundary', () => {
    it('needs session.substitute, which session.read does not imply', async () => {
        const res = await api(
            '/api/sessions/test-session-a/substitute',
            { method: 'POST', cookie: viewerCookie, body: JSON.stringify({ personId: freePersonA }) },
        );

        expect(res.status).toBe(403);
    });

    it('gates the candidates read the same way', async () => {
        const res = await api('/api/sessions/test-session-a/substitute-candidates', { cookie: viewerCookie });

        expect(res.status).toBe(403);
    });
});
