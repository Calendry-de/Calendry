import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, TEST_PASSWORD, type Fixtures, ownerDb, seed, teardown } from './helpers/seed';
import { api, login } from './helpers/client';

/**
 * `PUT /api/offerings/:id/rooms` (issue #123), over HTTP.
 *
 * WHY THIS CALLS THE ROUTE instead of testing the registry entry. CLAUDE.md's
 * `/api/[resource]` rule: the list route switches response shape on `limit`
 * while `[relation].put.ts` takes a BARE ARRAY as its body, `request<T>()` is
 * an unchecked assertion about what the server sends, and three bugs in one
 * hour came from assuming the envelope with a green typecheck throughout. A new
 * relation is pinned by calling it.
 *
 * The other half is the permission and tenant boundary. The relation declares
 * no `writePermission`, so it rides on `offering.update`, and the parent lookup
 * is tenant-scoped: both are properties nothing in the registry states.
 */
let f: Fixtures;
let adminCookie = '';
let viewerCookie = '';
let roomA = '';
let roomB = '';

const OFFERING = 'test-offering-a';

beforeAll(async () => {
    f = await seed();

    adminCookie = (await login(ACCOUNTS.adminA, TEST_PASSWORD)).cookie;
    viewerCookie = (await login(ACCOUNTS.viewerA, TEST_PASSWORD)).cookie;

    roomA = f.roomPrivateA;
    roomB = f.roomSharedFederation;
});

afterAll(async () => {
    await teardown();
    await ownerDb.$disconnect();
});

const put = (body: unknown, cookie: string = adminCookie) => api<unknown>(
    `/api/offerings/${OFFERING}/rooms`,
    { method: 'PUT', cookie, body: JSON.stringify(body) },
);

describe('the pin over HTTP', () => {
    it('starts empty, which is what "any eligible room" looks like', async () => {
        const res = await api<unknown>(`/api/offerings/${OFFERING}/rooms`, { cookie: adminCookie });

        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);
    });

    it('replaces the whole set from a BARE ARRAY body and answers with a bare array', async () => {
        const res = await put([{ roomId: roomA }]);

        expect(res.status, JSON.stringify(res.body)).toBe(200);
        // Not `{ rows }`: this relation declares no `warnAfterWrite`, so the
        // response is the bare array every other consumer of these routes reads.
        expect(res.body).toEqual([{ roomId: roomA }]);
    });

    it('accepts a FEDERATION-owned room the offering’s tenant can merely read', async () => {
        // The shared lecture hall is exactly the room a consortium member wants
        // to pin, and it belongs to no tenant at all. The join row carries the
        // OFFERING's tenant, so RLS is satisfied without the Room being owned.
        const res = await put([{ roomId: roomA }, { roomId: roomB }]);

        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect((res.body as { roomId: string }[]).map((r) => r.roomId).sort()).toEqual([roomA, roomB].sort());
    });

    it('clears back to "any eligible room" on an empty array', async () => {
        const res = await put([]);

        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);
        expect(await ownerDb.offeringRoom.count({ where: { offeringId: OFFERING } })).toBe(0);
    });

    it('rejects a body that is not an array of { roomId }', async () => {
        expect((await put({ rows: [{ roomId: roomA }] })).status).toBe(400);
        expect((await put([{ room: roomA }])).status).toBe(400);
    });

    it('needs offering.update, not merely offering.read', async () => {
        expect((await put([{ roomId: roomA }], viewerCookie)).status).toBe(403);
    });

    it('404s for an offering in another tenant rather than writing nothing quietly', async () => {
        const res = await api<unknown>('/api/offerings/test-offering-b/rooms', {
            method: 'PUT',
            cookie: adminCookie,
            body: JSON.stringify([{ roomId: roomA }]),
        });

        expect(res.status).toBe(404);
        expect(await ownerDb.offeringRoom.count({ where: { offeringId: 'test-offering-b' } })).toBe(0);
    });
});

describe('the online mode over HTTP', () => {
    it('PATCHes to REQUIRED and reads back, the enum having replaced the boolean', async () => {
        const res = await api<{ onlineMode?: string; allowOnline?: unknown }>(
            `/api/offerings/${OFFERING}`,
            { method: 'PATCH', cookie: adminCookie, body: JSON.stringify({ onlineMode: 'REQUIRED' }) },
        );

        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(res.body.onlineMode).toBe('REQUIRED');
        // The boolean is gone, not merely unused: a response still carrying it
        // would mean the column survived the migration somewhere.
        expect(res.body.allowOnline).toBeUndefined();

        await api(`/api/offerings/${OFFERING}`, {
            method: 'PATCH', cookie: adminCookie, body: JSON.stringify({ onlineMode: 'FORBIDDEN' }),
        });
    });

    it('refuses a value outside the three', async () => {
        const res = await api(`/api/offerings/${OFFERING}`, {
            method: 'PATCH', cookie: adminCookie, body: JSON.stringify({ onlineMode: 'SOMETIMES' }),
        });

        expect(res.status).toBe(400);
    });

    it('reads the select’s blank submission as FORBIDDEN rather than rejecting it', async () => {
        // A `<select>` cannot send "absent"; it sends ''. Left unmapped, the
        // one control the form renders would be the one value that cannot save.
        const res = await api<{ onlineMode?: string }>(`/api/offerings/${OFFERING}`, {
            method: 'PATCH', cookie: adminCookie, body: JSON.stringify({ onlineMode: '' }),
        });

        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(res.body.onlineMode).toBe('FORBIDDEN');
    });
});
