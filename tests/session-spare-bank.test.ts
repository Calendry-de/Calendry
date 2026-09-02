import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, TEST_PASSWORD, ownerDb, seed, teardown } from './helpers/seed';
import { api, login } from './helpers/client';

/**
 * `POST /api/sessions/:id/bank` and its restore path (issue #22,
 * cancel-to-spare-bank, the state half; auto-reschedule is a separate,
 * blocked card).
 *
 * `test-session-a` is the fixture's Offering-linked, placed Session, exactly
 * the shape banking exists for. It carries a Group, a Person and a Room, all
 * of which must survive banking untouched: the row is cancelled, not erased.
 */
const TENANT = 'test-tenant-a';
const SESSION = 'test-session-a';
const OFFERING = 'test-offering-a';

let cookie: string | null;

beforeAll(async () => {
    await seed();
    ({ cookie } = await login(ACCOUNTS.adminA, TEST_PASSWORD));
});

afterAll(async () => {
    await teardown();
    await ownerDb.$disconnect();
});

describe('banking a Session', () => {
    it('nulls the placement, keeps the row and its links, and emits a BANK event', async () => {
        const before = await ownerDb.session.findUniqueOrThrow({ where: { id: SESSION } });

        expect(before.termWeek).not.toBeNull();

        const res = await api(`/api/sessions/${SESSION}/bank`, {
            method: 'POST',
            cookie,
            body: JSON.stringify({ reason: 'lecturer ill' }),
        });

        expect(res.status).toBe(200);
        expect(res.body.session.termWeek).toBeNull();
        expect(res.body.session.dayOfWeek).toBeNull();
        expect(res.body.session.blockIndex).toBeNull();

        const row = await ownerDb.session.findUniqueOrThrow({ where: { id: SESSION } });

        expect(row.termWeek).toBeNull();
        expect(row.dayOfWeek).toBeNull();
        expect(row.blockIndex).toBeNull();
        // The demand survives: still the same Offering, still counted.
        expect(row.offeringId).toBe(OFFERING);

        expect(await ownerDb.sessionGroup.count({ where: { sessionId: SESSION } })).toBe(1);
        expect(await ownerDb.sessionPerson.count({ where: { sessionId: SESSION } })).toBe(1);
        expect(await ownerDb.sessionRoom.count({ where: { sessionId: SESSION } })).toBe(1);

        const events = await ownerDb.sessionEvent.findMany({
            where: { tenantId: TENANT, type: 'BANK', sessionId: SESSION },
            orderBy: { seq: 'desc' },
            take: 1,
        });

        expect(events).toHaveLength(1);

        const payload = events[0]!.payload as Record<string, unknown>;
        const from = payload.from as Record<string, unknown>;

        // The placement it HELD before banking, not the one it has now: the
        // whole point of the payload is that it outlives the row's own state.
        expect(from.termWeek).toBe(before.termWeek);
        expect(from.dayOfWeek).toBe(before.dayOfWeek);
        expect(payload.reason).toBe('lecturer ill');

        // Placement-based violations cannot survive having no placement.
        expect(await ownerDb.constraintViolation.count({ where: { sessionId: SESSION } })).toBe(0);
    });

    it('refuses a Session already in the spare bank', async () => {
        const res = await api(`/api/sessions/${SESSION}/bank`, { method: 'POST', cookie, body: '{}' });

        expect(res.status).toBe(409);
        expect(String(res.body.statusMessage)).toContain('already in the spare bank');
    });
});

describe('placing a banked Session', () => {
    it('rejects a bare /move with nothing to fall back to', async () => {
        const res = await api(`/api/sessions/${SESSION}/move`, { method: 'POST', cookie, body: '{}' });

        expect(res.status).toBe(400);
        expect(String(res.body.statusMessage)).toContain('spare bank');

        // Refused, not partially applied.
        const row = await ownerDb.session.findUniqueOrThrow({ where: { id: SESSION } });

        expect(row.termWeek).toBeNull();
    });

    it('restores it with a full target, via the ordinary MOVE event', async () => {
        const res = await api(`/api/sessions/${SESSION}/move`, {
            method: 'POST',
            cookie,
            body: JSON.stringify({ termWeek: 3, dayOfWeek: 4, blockIndex: 2 }),
        });

        expect(res.status).toBe(200);
        expect(res.body.session).toMatchObject({ termWeek: 3, dayOfWeek: 4, blockIndex: 2 });

        const events = await ownerDb.sessionEvent.findMany({
            where: { tenantId: TENANT, type: 'MOVE', sessionId: SESSION },
            orderBy: { seq: 'desc' },
            take: 1,
        });

        expect(events).toHaveLength(1);

        const payload = events[0]!.payload as { from: { termWeek: number | null }; to: { termWeek: number } };

        // Recorded FROM nothing, the same shape banking recorded TO, so a
        // read of the log sees one continuous story rather than a gap.
        expect(payload.from.termWeek).toBeNull();
        expect(payload.to.termWeek).toBe(3);
    });
});

describe('the spare bank in GET /api/sessions', () => {
    it('is invisible to the ordinary week-scoped fetch, and listed under ?banked=true', async () => {
        await api(`/api/sessions/${SESSION}/bank`, { method: 'POST', cookie, body: '{}' });

        const week = await api<{ id: string }[]>('/api/sessions', { cookie });

        // No termId/week filter at all still must not surface a banked row by
        // accident: the `banked` param is what asks for it, nothing else.
        expect(week.body.some((s) => s.id === SESSION)).toBe(false);

        const banked = await api<{ id: string }[]>(
            '/api/sessions?termId=test-term-a&banked=true',
            { cookie },
        );

        expect(banked.status).toBe(200);
        expect(banked.body.map((s) => s.id)).toContain(SESSION);
    });
});

describe('a banked Session cannot swap or lock', () => {
    it('SWAP refuses when either side is banked', async () => {
        const other = await api('/api/sessions', {
            method: 'POST',
            cookie,
            body: JSON.stringify({
                termId: 'test-term-a', kindId: 'test-kind-a',
                termWeek: 2, dayOfWeek: 3, blockIndex: 1, title: 'Placed event',
            }),
        });

        expect(other.status).toBe(201);

        const res = await api(`/api/sessions/${SESSION}/swap`, {
            method: 'POST',
            cookie,
            body: JSON.stringify({ withSessionId: other.body.session.id }),
        });

        expect(res.status).toBe(409);
        expect(String(res.body.statusMessage)).toContain('spare bank');
    });

    it('LOCK refuses a banked Session', async () => {
        const res = await api(`/api/sessions/${SESSION}/lock`, { method: 'POST', cookie, body: '{}' });

        expect(res.status).toBe(409);
        expect(String(res.body.statusMessage)).toContain('spare bank');
    });
});

describe('only Offering-linked Sessions can be banked', () => {
    it('refuses an Event, which has no demand to preserve', async () => {
        const created = await api('/api/sessions', {
            method: 'POST',
            cookie,
            body: JSON.stringify({
                termId: 'test-term-a', kindId: 'test-kind-a',
                termWeek: 1, dayOfWeek: 1, blockIndex: 5, title: 'Open house',
            }),
        });

        expect(created.status).toBe(201);

        const res = await api(`/api/sessions/${created.body.session.id}/bank`, {
            method: 'POST', cookie, body: '{}',
        });

        expect(res.status).toBe(409);
        expect(String(res.body.statusMessage)).toContain('no Offering');
    });
});

describe('locked Sessions must be unlocked first', () => {
    it('refuses to bank a locked Session', async () => {
        // Re-seed puts test-session-a back to its ordinary placed state,
        // and invalidates the account row `cookie` was issued for, so a
        // fresh login is not optional here.
        await seed();
        ({ cookie } = await login(ACCOUNTS.adminA, TEST_PASSWORD));

        await api(`/api/sessions/${SESSION}/lock`, { method: 'POST', cookie, body: '{}' });

        const res = await api(`/api/sessions/${SESSION}/bank`, { method: 'POST', cookie, body: '{}' });

        expect(res.status).toBe(409);
        expect(String(res.body.statusMessage)).toContain('Unlock');
    });
});

describe('permission', () => {
    it('refuses a viewer, who has no session.bank', async () => {
        await seed();
        const { cookie: viewer } = await login(ACCOUNTS.viewerA, TEST_PASSWORD);

        const res = await api(`/api/sessions/${SESSION}/bank`, { method: 'POST', cookie: viewer, body: '{}' });

        expect(res.status).toBe(403);

        const row = await ownerDb.session.findUniqueOrThrow({ where: { id: SESSION } });

        expect(row.termWeek).not.toBeNull();
    });
});
