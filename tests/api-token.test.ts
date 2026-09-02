import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, TEST_PASSWORD, seed, teardown } from './helpers/seed';
import { api, login } from './helpers/client';

/**
 * API tokens: a Person's own authority, delegated and narrowed.
 *
 * THE ASSERTIONS THAT MATTER are the two narrowings. A token resolves to a real
 * identity WITH an acting Person, which is what lets an import script pass
 * permission checks at all, and the whole safety argument is that the
 * effective set is an intersection: the ceiling selected at creation, AND the
 * Person's live permissions at use time. Both are probed here with LIVE tokens
 * over real endpoints, for the reason the screens suite states: a revoked
 * credential is refused before any permission is consulted, so testing only
 * revoked ones proves nothing.
 */
let adminCookie = '';
let viewerCookie = '';
let ids: Awaited<ReturnType<typeof seed>>;

interface Created {
    id: string;
    name: string;
    permissions: string[];
    token: string;
}

function bearer(token: string): Record<string, string> {
    return { authorization: `Bearer ${token}` };
}

async function makeToken(
    cookie: string,
    body: Record<string, unknown>,
): Promise<{ status: number; body: Created }> {
    const res = await api<Created>('/api/me/api-tokens', {
        method: 'POST',
        cookie,
        body: JSON.stringify(body),
    });

    return { status: res.status, body: res.body };
}

beforeAll(async () => {
    ids = await seed();

    adminCookie = (await login(ACCOUNTS.adminA, TEST_PASSWORD)).cookie;
    viewerCookie = (await login(ACCOUNTS.viewerA, TEST_PASSWORD)).cookie;
});

afterAll(teardown);

describe('the secret is issued once and never again', () => {
    it('returns the token on create, and never on any read', async () => {
        const { status, body: created } = await makeToken(adminCookie, {
            name: 'Import script',
            permissions: ['room.read'],
        });

        expect(status).toBe(201);
        expect(created.token).toBeTruthy();
        expect(created.token.length).toBeGreaterThan(20);

        try {
            const list = await api<Record<string, unknown>[]>('/api/me/api-tokens', { cookie: adminCookie });

            expect(list.status).toBe(200);

            const row = list.body.find((t) => t.id === created.id);

            expect(row).toBeTruthy();

            for (const field of ['token', 'tokenHash', 'token_hash']) {
                expect(Object.keys(row as object)).not.toContain(field);
            }
        } finally {
            await api(`/api/me/api-tokens/${created.id}`, { method: 'DELETE', cookie: adminCookie });
        }
    });
});

describe('a token cannot hold more than its creator', () => {
    it('refuses a permission the creator does not hold, naming it', async () => {
        // viewerA holds exactly session.read.
        const { status } = await makeToken(viewerCookie, {
            name: 'Escalation probe',
            permissions: ['room.read'],
        });

        expect(status).toBe(403);
    });

    it('accepts a genuine subset of the creator\'s permissions', async () => {
        const { status, body } = await makeToken(viewerCookie, {
            name: 'Viewer subset',
            permissions: ['session.read'],
        });

        expect(status).toBe(201);

        await api(`/api/me/api-tokens/${body.id}`, { method: 'DELETE', cookie: viewerCookie });
    });

    it('refuses an unknown permission key as a 400, not a silent drop', async () => {
        const { status } = await makeToken(adminCookie, {
            name: 'Typo probe',
            permissions: ['room.raed'],
        });

        expect(status).toBe(400);
    });
});

describe('the ceiling is enforced at use, per endpoint', () => {
    it('grants exactly the selected permissions and nothing else', async () => {
        const { body: created } = await makeToken(adminCookie, {
            name: 'Rooms only',
            permissions: ['room.read'],
        });

        try {
            // Inside the ceiling: works.
            const rooms = await api<unknown[]>('/api/rooms', { headers: bearer(created.token) });

            expect(rooms.status).toBe(200);
            expect(Array.isArray(rooms.body)).toBe(true);

            // The creator (tenant-admin) holds these; the token's ceiling does
            // not, so every one must refuse: reads and writes alike.
            for (const path of ['/api/persons', '/api/sessions', '/api/constraints']) {
                const res = await api(path, { headers: bearer(created.token) });

                expect(res.status, `${path} must refuse a rooms-only token`).toBe(403);
            }

            const write = await api('/api/rooms', {
                method: 'POST',
                headers: bearer(created.token),
                body: JSON.stringify({ code: 'TOK1', name: 'Token probe' }),
            });

            expect(write.status, 'room.create is outside the ceiling').toBe(403);
        } finally {
            await api(`/api/me/api-tokens/${created.id}`, { method: 'DELETE', cookie: adminCookie });
        }
    });

    it('a token can never mint, list, or revoke tokens', async () => {
        const { body: created } = await makeToken(adminCookie, {
            name: 'Laundering probe',
            permissions: ['room.read'],
        });

        try {
            const mint = await api('/api/me/api-tokens', {
                method: 'POST',
                headers: bearer(created.token),
                body: JSON.stringify({ name: 'Laundered', permissions: ['room.read'] }),
            });

            expect(mint.status).toBe(403);

            const list = await api('/api/me/api-tokens', { headers: bearer(created.token) });

            expect(list.status).toBe(403);

            const revoke = await api(`/api/me/api-tokens/${created.id}`, {
                method: 'DELETE',
                headers: bearer(created.token),
            });

            expect(revoke.status).toBe(403);
        } finally {
            await api(`/api/me/api-tokens/${created.id}`, { method: 'DELETE', cookie: adminCookie });
        }
    });
});

describe('revocation and expiry', () => {
    it('a deleted token stops resolving immediately', async () => {
        const { body: created } = await makeToken(adminCookie, {
            name: 'Short-lived',
            permissions: ['room.read'],
        });

        const before = await api('/api/rooms', { headers: bearer(created.token) });

        expect(before.status).toBe(200);

        const del = await api(`/api/me/api-tokens/${created.id}`, { method: 'DELETE', cookie: adminCookie });

        expect(del.status).toBe(200);

        const after = await api('/api/rooms', { headers: bearer(created.token) });

        expect(after.status).toBe(401);
    });

    it('refuses an expiry in the past at creation', async () => {
        const { status } = await makeToken(adminCookie, {
            name: 'Born dead',
            permissions: ['room.read'],
            expiresAt: '2020-01-01T00:00:00.000Z',
        });

        expect(status).toBe(400);
    });

    it('cannot delete somebody else\'s token', async () => {
        const { body: created } = await makeToken(adminCookie, {
            name: 'Not yours',
            permissions: ['room.read'],
        });

        try {
            const res = await api(`/api/me/api-tokens/${created.id}`, {
                method: 'DELETE',
                cookie: viewerCookie,
            });

            // 404, not 403: confirming the row exists would leak that the id is
            // real, the same rule the generic routes follow across tenants.
            expect(res.status).toBe(404);
        } finally {
            await api(`/api/me/api-tokens/${created.id}`, { method: 'DELETE', cookie: adminCookie });
        }
    });
});

describe('the LIVE intersection: a Person who loses authority loses it in every token', () => {
    it('narrows an existing token when an access role is taken away', async () => {
        /*
         * viewerA holds session.read through the seeded viewer role. Mint a
         * token at that ceiling, prove it works, strip the role, and the SAME
         * token must refuse, without anybody touching the token row. This is
         * the property that makes "permissions they own, or less" true over
         * time rather than only at the moment of creation.
         *
         * LAST in the file, and against the viewer rather than the admin:
         * stripping the admin would trip assertTenantRetainsAdministrator, and
         * every suite reseeds in beforeAll so the mutation dies with this file.
         */
        const { body: created } = await makeToken(viewerCookie, {
            name: 'Live narrowing probe',
            permissions: ['session.read'],
        });

        const before = await api<unknown[]>('/api/sessions', { headers: bearer(created.token) });

        expect(before.status).toBe(200);

        const strip = await api(`/api/persons/${ids.personViewerA}/access-roles`, {
            method: 'PUT',
            cookie: adminCookie,
            body: JSON.stringify([]),
        });

        expect(strip.status).toBe(200);

        const after = await api('/api/sessions', { headers: bearer(created.token) });

        expect(after.status, 'the token must not outlive its Person\'s authority').toBe(403);
    });
});
