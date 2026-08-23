import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, TEST_PASSWORD, ownerDb, seed, teardown } from './helpers/seed';
import { api, login } from './helpers/client';

/**
 * `DELETE /api/sessions/:id` — removing an Event.
 *
 * WHY THE ROUTE REFUSES A REAL SESSION. An Offering-linked Session is demand
 * made concrete: its Offering declares how many times it must happen, so
 * deleting one leaves `frequency` unmet and the next solve places it again. The
 * delete would appear to work and silently undo itself. Removing one properly
 * is the deferred cancel-to-spare-bank feature, and this route deliberately
 * does not build half of it.
 *
 * The refusal is 409 rather than 404 on purpose: "belongs to an Offering" and
 * "no such Session" are different facts, and collapsing them would make a
 * mis-typed id indistinguishable from the rule working.
 */
const TENANT = 'test-tenant-a';
const TERM = 'test-term-a';
const KIND = 'test-kind-a';

let cookie: string | null;

async function makeEvent(over: Record<string, unknown> = {}) {
    const res = await api('/api/sessions', {
        method: 'POST',
        cookie,
        body: JSON.stringify({
            termId: TERM, kindId: KIND, termWeek: 1, dayOfWeek: 1, blockIndex: 0, ...over,
        }),
    });

    expect(res.status).toBe(201);

    return res.body.session as { id: string; offeringId: string | null };
}

beforeAll(async () => {
    await seed();
    ({ cookie } = await login(ACCOUNTS.adminA, TEST_PASSWORD));
});

afterAll(async () => {
    await teardown();
    await ownerDb.$disconnect();
});

describe('deleting an Event', () => {
    it('removes the row', async () => {
        const created = await makeEvent();

        const res = await api(`/api/sessions/${created.id}`, { method: 'DELETE', cookie });

        expect(res.status).toBe(200);
        expect(res.body.deleted).toBe(created.id);
        expect(await ownerDb.session.findUnique({ where: { id: created.id } })).toBeNull();
    });

    it('emits a DELETE event whose payload survives the row', async () => {
        const created = await makeEvent({ dayOfWeek: 2, blockIndex: 1 });

        await api(`/api/sessions/${created.id}`, { method: 'DELETE', cookie });

        const events = await ownerDb.sessionEvent.findMany({
            where: { tenantId: TENANT, type: 'DELETE' },
            orderBy: { seq: 'desc' },
            take: 1,
        });

        expect(events).toHaveLength(1);

        // NULL because the FK is ON DELETE SET NULL and the row is gone — the
        // designed behaviour, and exactly why the placement has to live in the
        // payload rather than be looked up through the pointer.
        expect(events[0].sessionId).toBeNull();

        const payload = events[0].payload as Record<string, unknown>;

        expect(payload.reason).toBe('deleted_by_user');
        expect(payload.isEvent).toBe(true);
        expect(payload.from).toMatchObject({ dayOfWeek: 2, blockIndex: 1 });
    });

    it('cascades its join rows', async () => {
        const room = await ownerDb.room.findFirstOrThrow({ where: { tenantId: TENANT } });
        const created = await makeEvent({ roomIds: [room.id] });

        expect(await ownerDb.sessionRoom.count({ where: { sessionId: created.id } })).toBe(1);

        await api(`/api/sessions/${created.id}`, { method: 'DELETE', cookie });

        expect(await ownerDb.sessionRoom.count({ where: { sessionId: created.id } })).toBe(0);
    });
});

describe('the Events-only boundary', () => {
    it('REFUSES an Offering-linked Session with 409, and leaves it alone', async () => {
        const created = await makeEvent({ offeringId: 'test-offering-a', dayOfWeek: 3 });

        expect(created.offeringId).toBe('test-offering-a');

        const res = await api(`/api/sessions/${created.id}`, { method: 'DELETE', cookie });

        expect(res.status).toBe(409);
        expect(String(res.body.statusMessage)).toContain('belongs to an Offering');

        // The refusal must not be a partial delete: the row and its event log
        // both stay intact.
        expect(await ownerDb.session.findUnique({ where: { id: created.id } })).not.toBeNull();
    });

    it('404s an unknown id, distinguishably from the 409 above', async () => {
        const res = await api('/api/sessions/does-not-exist', { method: 'DELETE', cookie });

        expect(res.status).toBe(404);
    });

    it("404s another tenant's Session rather than refusing it", async () => {
        const res = await api('/api/sessions/test-session-b', { method: 'DELETE', cookie });

        // Not 409: tenant B's row must not even be acknowledged to exist.
        expect(res.status).toBe(404);
    });
});

describe('permission', () => {
    it('refuses a viewer, who has no session.delete', async () => {
        const created = await makeEvent({ dayOfWeek: 4 });
        const { cookie: viewer } = await login(ACCOUNTS.viewerA, TEST_PASSWORD);

        const res = await api(`/api/sessions/${created.id}`, { method: 'DELETE', cookie: viewer });

        expect(res.status).toBe(403);
        expect(await ownerDb.session.findUnique({ where: { id: created.id } })).not.toBeNull();
    });
});
