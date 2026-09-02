import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, TEST_PASSWORD, ownerDb, seed, teardown } from './helpers/seed';
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
 *
 * PERMISSION FIXTURES. Managing tokens now needs `api_token.manage_own`, so
 * the file needs three shapes rather than two:
 *
 *   adminA   the whole catalogue, so it holds the key: the default caller here.
 *   viewerA  exactly `session.read`, pinned by `auth-permissions.test.ts` and
 *            shared by two dozen suites, so deliberately NOT widened. It
 *            stands in for "may not manage tokens at all".
 *   scoped   a file-local Person holding TWO AccessRoles, one carrying
 *            `api_token.manage_own` and one carrying `session.read`, so the
 *            two can be revoked INDEPENDENTLY. That separation is the whole
 *            point: it is what lets this file assert that losing the right to
 *            MANAGE tokens leaves an already-minted token working, and that
 *            losing the permission BEHIND that token is what narrows it. One
 *            role holding both keys could not tell those two apart.
 *
 * `scoped` replaces `viewerA` wherever a test needs somebody who can mint a
 * token but holds almost nothing, which is a role `viewerA` played until the
 * gate existed and now cannot.
 */
let adminCookie = '';
let viewerCookie = '';
let scopedCookie = '';
let ids: Awaited<ReturnType<typeof seed>>;

const SCOPED_EMAIL = 'api-token-scoped@test.local';

/**
 * `scoped`'s SCHEDULE-READING AccessRole id. Its token-managing role is
 * deliberately not held here: every mutation below removes roles rather than
 * adding them, so what a test needs to name is what SURVIVES the removal.
 */
let readRoleId = '';
let scopedPersonId = '';

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

/**
 * A Person holding `api_token.manage_own` and `session.read` through two
 * SEPARATE AccessRoles, plus their own Account.
 *
 * Written with the owner connection, the way every fixture is: this creates
 * rows in a tenant no request could reach across, and the tests themselves
 * then go over HTTP as the app role.
 */
async function seedScoped(tenantId: string) {
    await ownerDb.$executeRawUnsafe(`DELETE FROM account WHERE email = '${ SCOPED_EMAIL }'`);

    const manageRole = await ownerDb.accessRole.create({
        data: { tenantId, key: 'api-token-manager', name: 'May manage own API tokens' },
    });

    await ownerDb.accessRolePermission.create({
        data: { accessRoleId: manageRole.id, permissionKey: 'api_token.manage_own', tenantId },
    });

    const readRole = await ownerDb.accessRole.create({
        data: { tenantId, key: 'api-token-reader', name: 'May read the schedule' },
    });

    await ownerDb.accessRolePermission.create({
        data: { accessRoleId: readRole.id, permissionKey: 'session.read', tenantId },
    });

    const person = await ownerDb.person.create({
        data: { tenantId, givenName: 'Scoped', familyName: 'Minter', email: 'scoped-minter@a.test' },
    });

    await ownerDb.personAccessRole.createMany({
        data: [
            { personId: person.id, accessRoleId: manageRole.id, tenantId },
            { personId: person.id, accessRoleId: readRole.id, tenantId },
        ],
    });

    const template = await ownerDb.account.findFirstOrThrow({ where: { email: ACCOUNTS.adminA } });
    const account = await ownerDb.account.create({
        data: { email: SCOPED_EMAIL, passwordHash: template.passwordHash },
    });

    await ownerDb.accountPerson.create({ data: { accountId: account.id, personId: person.id } });

    readRoleId = readRole.id;
    scopedPersonId = person.id;
}

/** Replaces `scoped`'s AccessRole set, as the admin, over the real route. */
async function setScopedRoles(roleIds: readonly string[]) {
    const res = await api(`/api/persons/${ scopedPersonId }/access-roles`, {
        method: 'PUT',
        cookie: adminCookie,
        body: JSON.stringify(roleIds.map((accessRoleId) => ({ accessRoleId }))),
    });

    expect(res.status, 'the fixture mutation itself must succeed').toBe(200);
}

beforeAll(async () => {
    ids = await seed();

    adminCookie = (await login(ACCOUNTS.adminA, TEST_PASSWORD)).cookie;
    viewerCookie = (await login(ACCOUNTS.viewerA, TEST_PASSWORD)).cookie;

    await seedScoped(ids.tenantA);
    scopedCookie = (await login(SCOPED_EMAIL, TEST_PASSWORD)).cookie;
});

afterAll(async () => {
    await ownerDb.$executeRawUnsafe(`DELETE FROM account WHERE email = '${ SCOPED_EMAIL }'`);
    await teardown();
});

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
    /*
     * `scoped`, not `viewerA`, throughout this block. Both hold almost
     * nothing, which is what these cases need, but only `scoped` may reach
     * the route at all now: `viewerA` would 403 on the GATE and every
     * assertion here would pass for the wrong reason, testing nothing about
     * the subset check it names.
     */
    it('refuses a permission the creator does not hold, naming it', async () => {
        // `scoped` holds api_token.manage_own and session.read, never room.read.
        const res = await api<{ message?: string }>('/api/me/api-tokens', {
            method: 'POST',
            cookie: scopedCookie,
            body: JSON.stringify({ name: 'Escalation probe', permissions: ['room.read'] }),
        });

        expect(res.status).toBe(403);
        // `message`, not `statusMessage` (i18n/CONVENTIONS.md), and the KEY
        // has to appear: a 403 that does not say which permission is missing
        // sends the reader to guess at the catalogue.
        expect(res.body.message).toContain('room.read');
    });

    it('accepts a genuine subset of the creator\'s permissions', async () => {
        const { status, body } = await makeToken(scopedCookie, {
            name: 'Scoped subset',
            permissions: ['session.read'],
        });

        expect(status).toBe(201);

        await api(`/api/me/api-tokens/${body.id}`, { method: 'DELETE', cookie: scopedCookie });
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
            /*
             * `scoped`, who HOLDS `api_token.manage_own`: the gate has to be
             * satisfied for this case to reach the row lookup at all, or the
             * 404-not-403 property it exists to pin would be masked by the
             * permission 403. (`viewerA` refusing is a different assertion,
             * made in the gating block below.)
             */
            const res = await api(`/api/me/api-tokens/${created.id}`, {
                method: 'DELETE',
                cookie: scopedCookie,
            });

            // 404, not 403: confirming the row exists would leak that the id is
            // real, the same rule the generic routes follow across tenants.
            expect(res.status).toBe(404);
        } finally {
            await api(`/api/me/api-tokens/${created.id}`, { method: 'DELETE', cookie: adminCookie });
        }
    });
});

describe('managing a token needs api_token.manage_own', () => {
    /*
     * THE GATE, in the narrowing direction. Until this key existed, any
     * signed-in Person could mint a bearer credential; an institution now
     * decides who may automate (DECISIONS.md § "API tokens gain a
     * permission"). `viewerA` holds exactly `session.read`, so it holds the
     * key nowhere, and all three verbs must refuse it.
     */
    it('refuses a caller without the permission on create', async () => {
        const res = await api<{ message?: string }>('/api/me/api-tokens', {
            method: 'POST',
            cookie: viewerCookie,
            body: JSON.stringify({ name: 'Ungated', permissions: ['session.read'] }),
        });

        expect(res.status).toBe(403);
        // The key is named, so a tenant admin reading the message knows what
        // to grant. `message`, not `statusMessage`: see i18n/CONVENTIONS.md.
        expect(res.body.message).toContain('api_token.manage_own');
    });

    it('refuses a caller without the permission on list', async () => {
        const res = await api<{ message?: string }>('/api/me/api-tokens', { cookie: viewerCookie });

        expect(res.status).toBe(403);
        expect(res.body.message).toContain('api_token.manage_own');
    });

    it('refuses a caller without the permission on revoke, before the row lookup', async () => {
        const { body: created } = await makeToken(adminCookie, {
            name: 'Gate probe',
            permissions: ['room.read'],
        });

        try {
            const res = await api<{ message?: string }>(`/api/me/api-tokens/${created.id}`, {
                method: 'DELETE',
                cookie: viewerCookie,
            });

            /*
             * 403 AND NOT 404, which is the opposite of the "somebody else's
             * token" case above and deliberately so: the gate runs before the
             * `deleteMany`, so a caller who may not manage tokens is told
             * that, rather than being told the id does not exist. Both
             * statuses are correct answers to different questions, and a
             * single assertion of "not 200" could not tell them apart.
             */
            expect(res.status).toBe(403);
            expect(res.body.message).toContain('api_token.manage_own');
        } finally {
            await api(`/api/me/api-tokens/${created.id}`, { method: 'DELETE', cookie: adminCookie });
        }
    });

    it('a token still cannot mint one even with the key inside its own ceiling', async () => {
        /*
         * THE LAUNDERING GUARD, probed at its worst case. The earlier "a token
         * can never mint, list, or revoke tokens" case uses a rooms-only
         * ceiling, so it would still pass if somebody reordered the two checks
         * in those handlers: the permission check would refuse it for the
         * wrong reason. This one puts `api_token.manage_own` IN the ceiling,
         * held genuinely by the creator, so the only thing that can refuse it
         * is the `identity.kind !== 'account'` check running FIRST. If that
         * ordering is ever inverted, a leaked token launders itself into a
         * permanent one and this is the assertion that says so.
         */
        const { status, body: created } = await makeToken(adminCookie, {
            name: 'Ceiling laundering probe',
            permissions: ['api_token.manage_own', 'room.read'],
        });

        expect(status, 'the key is a real catalogue key the admin holds').toBe(201);
        expect(created.permissions).toContain('api_token.manage_own');

        try {
            const headers = bearer(created.token);

            const mint = await api<{ message?: string }>('/api/me/api-tokens', {
                method: 'POST',
                headers,
                body: JSON.stringify({ name: 'Laundered', permissions: ['room.read'] }),
            });

            expect(mint.status).toBe(403);
            // The SESSION message, not a permission one: proof of which check
            // refused it, which is the entire point of this case.
            expect(mint.body.message).toContain('signed-in session');

            const list = await api<{ message?: string }>('/api/me/api-tokens', { headers });

            expect(list.status).toBe(403);
            expect(list.body.message).toContain('signed-in session');

            const revoke = await api<{ message?: string }>(`/api/me/api-tokens/${created.id}`, {
                method: 'DELETE',
                headers,
            });

            expect(revoke.status).toBe(403);
            expect(revoke.body.message).toContain('signed-in session');
        } finally {
            await api(`/api/me/api-tokens/${created.id}`, { method: 'DELETE', cookie: adminCookie });
        }
    });
});

/**
 * The two revocations that must NOT be the same thing.
 *
 * Ordered, sharing one token, and LAST in the file, for the reason the block
 * it replaces gave: these `it`s strip `scoped`'s AccessRoles one at a time, so
 * they run against a fixture nothing else still needs, and the mutation dies
 * with this file (every suite reseeds in `beforeAll`). Splitting them into
 * independent tests would mean re-minting a token after the permission to
 * mint has already been taken away, which is exactly the thing being asserted
 * as impossible.
 */
describe('losing api_token.manage_own is not losing the tokens', () => {
    let live: Created;

    it('mints a token as its holder', async () => {
        const { status, body } = await makeToken(scopedCookie, {
            name: 'Survives its minting right',
            permissions: ['session.read'],
        });

        expect(status).toBe(201);

        live = body;

        const before = await api<unknown[]>('/api/sessions', { headers: bearer(live.token) });

        expect(before.status).toBe(200);
    });

    it('keeps the token working when its owner loses the right to manage tokens', async () => {
        // Drop the manage role, KEEP the session.read one: the permission
        // behind the token is untouched, only the authority to mint is gone.
        await setScopedRoles([readRoleId]);

        const stillWorks = await api<unknown[]>('/api/sessions', { headers: bearer(live.token) });

        expect(
            stillWorks.status,
            'an integration must not break because its owner may no longer mint NEW tokens',
        ).toBe(200);

        // ...and the three management verbs are now refused for that Person.
        const list = await api('/api/me/api-tokens', { cookie: scopedCookie });

        expect(list.status).toBe(403);

        const mint = await api('/api/me/api-tokens', {
            method: 'POST',
            cookie: scopedCookie,
            body: JSON.stringify({ name: 'No longer allowed', permissions: ['session.read'] }),
        });

        expect(mint.status).toBe(403);

        const revoke = await api(`/api/me/api-tokens/${live.id}`, {
            method: 'DELETE',
            cookie: scopedCookie,
        });

        expect(revoke.status, 'revoking is management too, and goes with minting').toBe(403);
    });

    it('narrows the token when the permission BEHIND it is taken away', async () => {
        /*
         * The pre-existing property, unchanged and now measured against the
         * same token as the case above, which is what makes the pair
         * meaningful: one revocation leaves the token working, the other does
         * not, and the difference is which permission was revoked. Nobody
         * touches the token row in either.
         */
        await setScopedRoles([]);

        const after = await api('/api/sessions', { headers: bearer(live.token) });

        expect(after.status, 'the token must not outlive its Person\'s authority').toBe(403);
    });
});
