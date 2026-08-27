import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, TEST_PASSWORD, ownerDb, seed, teardown } from './helpers/seed';
import { api, login } from './helpers/client';

/**
 * The tenant-facing Account API — the LOGIN plane, which is not a Person.
 *
 * Until this, creating a Person in the management area created no way for them to
 * sign in, and the only tools that could were operator CLIs which answered "a
 * Person with this email already exists" and stopped. So the point of this file
 * is not that CRUD works; it is the four rules that make a credential plane
 * safe to expose to a tenant admin at all, each of which a plain CRUD suite
 * would pass without testing:
 *
 *   1. VISIBILITY IS THE JOIN. `account` has no `tenant_id` and no RLS, so
 *      "which logins are mine" is `account_person` → `person.tenant_id` and
 *      nothing else. A cross-tenant id must read as 404.
 *   2. A SHARED LOGIN'S CREDENTIAL IS NOBODY'S TO TAKE. One Account can act in
 *      several tenants; letting tenant A reset its password would be
 *      cross-tenant account takeover. Refused — and the negative cases here are
 *      the only thing separating this build from one where it is not.
 *   3. AN ORPHAN IS UNREPRESENTABLE. An Account with no `account_person` row is
 *      invisible to every tenant while its password still works, so the last
 *      identity cannot be detached and a Person holding a login cannot be
 *      deleted.
 *   4. AN EXISTING EMAIL IS AN OFFER. The 409 carries `accountExists` so the
 *      form can offer to attach instead, which is the actual gap this closed.
 */
const TENANT_A = 'test-tenant-a';

const cookies: Record<string, string> = {};

/** Ids of people created for this file, so each test starts from a known shape. */
const people: Record<string, string> = {};

interface AccountRow {
    id: string;
    email: string;
    personId: string;
    personName: string;
    isActive: boolean;
    mustChangePassword: boolean;
    activeSessions: number;
    otherTenantCount: number;
    isSoleTenant: boolean;
}

/**
 * Emails this file mints logins under.
 *
 * DELETED EXPLICITLY, because `account` is the pre-tenant plane: it carries no
 * `tenant_id`, so the fixture teardown's `DELETE FROM tenant` cascade never
 * reaches it. Without this, the second run of the suite finds `fresh@a.test`
 * already taken and reports a 409 that looks like a bug in the code under test.
 */
const MINTED = [
    'fresh@a.test',
    'owned@a.test',
    'short@a.test',
    'second@a.test',
    'reaching@a.test',
    'stolen@a.test',
    'disposable@a.test',
];

async function clearMinted() {
    await ownerDb.account.deleteMany({ where: { email: { in: MINTED } } });
}

async function makePerson(key: string, email: string) {
    const person = await ownerDb.person.create({
        data: { tenantId: TENANT_A, givenName: 'Test', familyName: key, email },
    });

    people[key] = person.id;

    return person.id;
}

beforeAll(async () => {
    await seed();
    // Also before, not only after: a run that crashed mid-file leaves the
    // accounts behind, and the next run's failure would name the wrong cause.
    await clearMinted();

    // Three roster entries with no login, one per creation path exercised below.
    await makePerson('fresh', 'fresh@a.test');
    await makePerson('attach', 'attach@a.test');
    await makePerson('spare', 'spare@a.test');

    cookies.adminA = (await login(ACCOUNTS.adminA, TEST_PASSWORD, 'test-a')).cookie;
    cookies.viewerA = (await login(ACCOUNTS.viewerA, TEST_PASSWORD, 'test-a')).cookie;
    cookies.adminB = (await login(ACCOUNTS.adminB, TEST_PASSWORD, 'test-b')).cookie;
}, 60_000);

afterAll(async () => {
    await clearMinted();
    await teardown();
    await ownerDb.$disconnect();
});

describe('permissions', () => {
    it('hides the section from a role holding only session.read', async () => {
        const res = await api('/api/accounts?limit=50', { cookie: cookies.viewerA });

        expect(res.status).toBe(403);
        // Names every acceptable permission, so a tenant admin reading the
        // message configures the right role rather than the first one listed.
        expect(JSON.stringify(res.body)).toContain('account.read');
    });

    it('refuses a viewer the candidates list too', async () => {
        const res = await api('/api/accounts/candidates', { cookie: cookies.viewerA });

        expect(res.status).toBe(403);
    });
});

describe('listing', () => {
    it('reports the person each login acts as', async () => {
        const res = await api<{ rows: AccountRow[]; total: number }>(
            '/api/accounts?limit=50',
            { cookie: cookies.adminA },
        );

        expect(res.status).toBe(200);

        const emails = res.body.rows.map((row) => row.email);

        expect(emails).toContain(ACCOUNTS.adminA);
        expect(emails).toContain(ACCOUNTS.viewerA);
        expect(emails).toContain(ACCOUNTS.multi);

        // Tenant B's admin has no identity here, so the join must not reach it.
        expect(emails).not.toContain(ACCOUNTS.adminB);

        const admin = res.body.rows.find((row) => row.email === ACCOUNTS.adminA);

        expect(admin?.personName).toBe('Ada Alpha');
    });

    /**
     * The shared-login flag has to survive being computed inside a tenant
     * transaction. Read through a join to `person` it would be 1 for everybody
     * — RLS hides the other tenant's row — and every refusal downstream would
     * silently stop refusing. This is the assertion that catches that.
     */
    it('counts the other institutions a shared login serves', async () => {
        const res = await api<{ rows: AccountRow[] }>(
            '/api/accounts?limit=50',
            { cookie: cookies.adminA },
        );

        const multi = res.body.rows.find((row) => row.email === ACCOUNTS.multi);
        const sole = res.body.rows.find((row) => row.email === ACCOUNTS.adminA);

        expect(multi?.otherTenantCount).toBe(1);
        expect(multi?.isSoleTenant).toBe(false);
        expect(sole?.otherTenantCount).toBe(0);
        expect(sole?.isSoleTenant).toBe(true);
    });

    it('offers only people without a login as candidates', async () => {
        const res = await api<{ id: string }[]>(
            '/api/accounts/candidates',
            { cookie: cookies.adminA },
        );

        expect(res.status).toBe(200);

        const ids = res.body.map((row) => row.id);

        expect(ids).toContain(people.fresh);
        // Ada Alpha holds adminA's login, so offering her would produce a 409
        // from `@@unique([personId])` after the form had been filled in.
        expect(ids).not.toContain('test-person-a');
    });
});

describe('cross-tenant', () => {
    it('reads another tenant’s login as not found, never as forbidden', async () => {
        const other = await ownerDb.account.findFirstOrThrow({ where: { email: ACCOUNTS.adminB } });

        const res = await api(`/api/accounts/${other.id}`, { cookie: cookies.adminA });

        // 404 and not 403: whether an id names an account somewhere in the
        // deployment is not a question a tenant is entitled to an answer to.
        expect(res.status).toBe(404);
    });

    it('refuses to attach a person from another tenant', async () => {
        const res = await api('/api/accounts', {
            method: 'POST',
            cookie: cookies.adminA,
            body: JSON.stringify({
                email: 'reaching@a.test',
                personId: 'test-person-b',
                password: 'a-perfectly-long-password',
            }),
        });

        expect(res.status).toBe(422);
    });
});

describe('creating a login', () => {
    it('issues one that can sign in, and requires a password change first', async () => {
        const res = await api<AccountRow & { oneTimePassword: string; attached: boolean }>(
            '/api/accounts',
            {
                method: 'POST',
                cookie: cookies.adminA,
                body: JSON.stringify({ email: 'fresh@a.test', personId: people.fresh }),
            },
        );

        expect(res.status).toBe(201);
        expect(res.body.attached).toBe(false);
        expect(res.body.personId).toBe(people.fresh);
        expect(res.body.mustChangePassword).toBe(true);

        // The password is legible exactly once, in this response. Proving it
        // WORKS is the only assertion that distinguishes a real credential from
        // a row that looks like one.
        const attempt = await api<{ requiresPasswordChange: boolean }>('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email: 'fresh@a.test', password: res.body.oneTimePassword }),
        });

        expect(attempt.status).toBe(200);
        expect(attempt.body.requiresPasswordChange).toBe(true);
    });

    it('refuses a password under the shared floor', async () => {
        const res = await api('/api/accounts', {
            method: 'POST',
            cookie: cookies.adminA,
            body: JSON.stringify({ email: 'short@a.test', personId: people.spare, password: 'short' }),
        });

        expect(res.status).toBe(400);
    });

    it('refuses a person who already holds a login', async () => {
        const res = await api('/api/accounts', {
            method: 'POST',
            cookie: cookies.adminA,
            body: JSON.stringify({ email: 'second@a.test', personId: 'test-person-a' }),
        });

        expect(res.status).toBe(409);
    });

    /**
     * The gap this whole feature closed. An address that already has a login is
     * the ordinary case for somebody arriving from a partner institution, and the
     * answer has to be an offer rather than a wall — carried as a FLAG, so the
     * form does not have to match on the sentence.
     */
    it('reports an existing address with a machine-readable flag, then attaches on consent', async () => {
        const refused = await api<{ data?: { accountExists?: boolean } }>('/api/accounts', {
            method: 'POST',
            cookie: cookies.adminA,
            body: JSON.stringify({ email: ACCOUNTS.adminB, personId: people.attach }),
        });

        expect(refused.status).toBe(409);
        expect(refused.body.data?.accountExists).toBe(true);

        const attached = await api<AccountRow & { oneTimePassword: string | null; attached: boolean }>(
            '/api/accounts',
            {
                method: 'POST',
                cookie: cookies.adminA,
                body: JSON.stringify({
                    email: ACCOUNTS.adminB,
                    personId: people.attach,
                    attachExisting: true,
                }),
            },
        );

        expect(attached.status).toBe(201);
        expect(attached.body.attached).toBe(true);
        // No password was set, so none is echoed. A placeholder here would read
        // as "this is their password".
        expect(attached.body.oneTimePassword).toBeNull();
        // It now serves two institutions, which is what removes this tenant's
        // authority over the credential.
        expect(attached.body.isSoleTenant).toBe(false);

        // And the other institution's own password still works, untouched.
        const stillWorks = await api('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email: ACCOUNTS.adminB, password: TEST_PASSWORD, tenantSlug: 'test-b' }),
        });

        expect(stillWorks.status).toBe(200);
    });
});

describe('a login this institution solely owns', () => {
    let account: AccountRow;

    beforeAll(async () => {
        const res = await api<AccountRow & { oneTimePassword: string }>('/api/accounts', {
            method: 'POST',
            cookie: cookies.adminA,
            body: JSON.stringify({ email: 'owned@a.test', personId: people.spare }),
        });

        account = res.body;
    });

    it('issues a new password and revokes every session', async () => {
        // A live session to revoke, so `sessionsRevoked` is a measurement rather
        // than a zero that would pass either way.
        await ownerDb.authSession.create({
            data: {
                accountId: account.id,
                tokenHash: `test-hash-${account.id}`,
                expiresAt: new Date(Date.now() + 3_600_000),
            },
        });

        const res = await api<{ oneTimePassword: string; sessionsRevoked: number }>(
            `/api/accounts/${account.id}/reset-password`,
            { method: 'POST', cookie: cookies.adminA, body: JSON.stringify({}) },
        );

        expect(res.status).toBe(200);
        expect(res.body.sessionsRevoked).toBe(1);

        const attempt = await api<{ requiresPasswordChange: boolean }>('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email: 'owned@a.test', password: res.body.oneTimePassword }),
        });

        expect(attempt.body.requiresPasswordChange).toBe(true);
    });

    it('refuses to detach its only identity', async () => {
        const res = await api(`/api/accounts/${account.id}/detach`, {
            method: 'POST',
            cookie: cookies.adminA,
        });

        // Not a warning. A detached last identity is a working password no
        // tenant can see, list or revoke.
        expect(res.status).toBe(409);
    });

    it('refuses to clear the person through the ordinary save path', async () => {
        const res = await api(`/api/accounts/${account.id}`, {
            method: 'PATCH',
            cookie: cookies.adminA,
            body: JSON.stringify({ personId: null }),
        });

        expect(res.status).toBe(422);
    });

    it('reassigns which person it acts as', async () => {
        const target = await makePerson('reassigned', 'reassigned@a.test');

        const res = await api<AccountRow>(`/api/accounts/${account.id}`, {
            method: 'PATCH',
            cookie: cookies.adminA,
            body: JSON.stringify({ personId: target }),
        });

        expect(res.status).toBe(200);
        expect(res.body.personId).toBe(target);

        // The person it left is free to be given a login again.
        const candidates = await api<{ id: string }[]>('/api/accounts/candidates', {
            cookie: cookies.adminA,
        });

        expect(candidates.body.map((row) => row.id)).toContain(people.spare);
    });

    it('deletes the login and keeps the person', async () => {
        const res = await api(`/api/accounts/${account.id}`, {
            method: 'DELETE',
            cookie: cookies.adminA,
        });

        expect(res.status).toBe(204);

        const person = await ownerDb.person.findUnique({ where: { id: people.reassigned } });

        expect(person).not.toBeNull();
    });
});

describe('a login shared with another institution', () => {
    let shared: AccountRow;

    beforeAll(async () => {
        const res = await api<{ rows: AccountRow[] }>('/api/accounts?limit=50', {
            cookie: cookies.adminA,
        });

        shared = res.body.rows.find((row) => row.email === ACCOUNTS.multi) as AccountRow;
    });

    it('is visible, and says so', () => {
        expect(shared.isSoleTenant).toBe(false);
        expect(shared.otherTenantCount).toBe(1);
    });

    it('refuses a password reset', async () => {
        const res = await api(`/api/accounts/${shared.id}/reset-password`, {
            method: 'POST',
            cookie: cookies.adminA,
            body: JSON.stringify({}),
        });

        // The takeover this rule exists to prevent: tenant A sets a password,
        // signs in, and picks tenant B's identity.
        expect(res.status).toBe(409);

        const stillWorks = await api('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email: ACCOUNTS.multi, password: TEST_PASSWORD, tenantSlug: 'test-b' }),
        });

        expect(stillWorks.status).toBe(200);
    });

    it('refuses a rename, a deactivation and a deletion', async () => {
        const renamed = await api(`/api/accounts/${shared.id}`, {
            method: 'PATCH',
            cookie: cookies.adminA,
            body: JSON.stringify({ email: 'stolen@a.test' }),
        });

        expect(renamed.status).toBe(409);

        const deactivated = await api(`/api/accounts/${shared.id}`, {
            method: 'PATCH',
            cookie: cookies.adminA,
            body: JSON.stringify({ isActive: false }),
        });

        expect(deactivated.status).toBe(409);

        const deleted = await api(`/api/accounts/${shared.id}`, {
            method: 'DELETE',
            cookie: cookies.adminA,
        });

        expect(deleted.status).toBe(409);
    });

    /**
     * A save that TOUCHES nothing must not be refused. The management form
     * PATCHes every field it renders on every save, so a guard keyed on presence
     * rather than on change would make the one editable thing — who the login
     * acts as — unreachable through the form that edits it.
     */
    it('accepts a save that changes nothing about the credential', async () => {
        const res = await api<AccountRow>(`/api/accounts/${shared.id}`, {
            method: 'PATCH',
            cookie: cookies.adminA,
            body: JSON.stringify({
                email: shared.email,
                isActive: shared.isActive,
                mustChangePassword: shared.mustChangePassword,
                personId: shared.personId,
            }),
        });

        expect(res.status).toBe(200);
    });

    it('detaches from this institution and keeps working at the other', async () => {
        const res = await api(`/api/accounts/${shared.id}/detach`, {
            method: 'POST',
            cookie: cookies.adminA,
        });

        expect(res.status).toBe(204);

        // Gone from this institution's list...
        const after = await api<{ rows: AccountRow[] }>('/api/accounts?limit=50', {
            cookie: cookies.adminA,
        });

        expect(after.body.rows.map((row) => row.email)).not.toContain(ACCOUNTS.multi);

        // ...and still a working login at the other.
        const stillWorks = await api('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email: ACCOUNTS.multi, password: TEST_PASSWORD, tenantSlug: 'test-b' }),
        });

        expect(stillWorks.status).toBe(200);
    });
});

describe('deleting a person who holds a login', () => {
    /**
     * `account_person.person_id` is ON DELETE CASCADE, so the database accepts
     * this happily and leaves an Account with no identity anywhere: invisible to
     * every list, unreachable by every reset route, still holding a working
     * password. The generic delete route grew a `beforeDelete` hook for exactly
     * this, and it has to run BEFORE the row goes — after it, the evidence is
     * gone too.
     */
    it('is refused, naming the login', async () => {
        const res = await api<{ statusMessage?: string }>('/api/persons/test-person-a', {
            method: 'DELETE',
            cookie: cookies.adminA,
        });

        expect(res.status).toBe(409);
        expect(JSON.stringify(res.body)).toContain(ACCOUNTS.adminA);

        const person = await ownerDb.person.findUnique({ where: { id: 'test-person-a' } });

        expect(person).not.toBeNull();
    });

    it('does not leak that another tenant’s person holds one', async () => {
        const res = await api('/api/persons/test-person-b', {
            method: 'DELETE',
            cookie: cookies.adminA,
        });

        // 404, exactly as before this hook existed. `account_person` has no RLS,
        // so a guard querying it directly would have answered 409 and named
        // tenant B's login.
        expect(res.status).toBe(404);
    });

    it('allows the delete once the login is gone', async () => {
        const person = await makePerson('disposable', 'disposable@a.test');

        const created = await api<AccountRow>('/api/accounts', {
            method: 'POST',
            cookie: cookies.adminA,
            body: JSON.stringify({ email: 'disposable@a.test', personId: person }),
        });

        expect(created.status).toBe(201);

        const blocked = await api(`/api/persons/${person}`, {
            method: 'DELETE',
            cookie: cookies.adminA,
        });

        expect(blocked.status).toBe(409);

        await api(`/api/accounts/${created.body.id}`, { method: 'DELETE', cookie: cookies.adminA });

        const allowed = await api(`/api/persons/${person}`, {
            method: 'DELETE',
            cookie: cookies.adminA,
        });

        expect(allowed.status).toBe(204);
    });
});

/**
 * The three pages, rendered SERVER-SIDE and checked for CONTENT.
 *
 * Not element counts and not "did not 500": the failure this codebase keeps
 * meeting is a page that renders its shell over an empty state, which passes
 * every check that does not read the values. And an absence assertion is
 * paired with a positive one every time — "the reset button is not there" is
 * true of a blank page too.
 *
 * The rendered body only, with the hydration payload cut off: that JSON carries
 * the whole registry, so matching against it would pass for a page that drew
 * nothing.
 */
describe('the pages', () => {
    const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:8080';

    async function body(path: string, cookie: string): Promise<string> {
        const html = await fetch(`${BASE}${path}`, { headers: { cookie } }).then((res) => res.text());

        return html.split('<script type="application/json"')[0] ?? '';
    }

    it('lists logins with the person each acts as', async () => {
        const html = await body('/manage/accounts?limit=50', cookies.adminA);

        expect(html).toContain('Logins');
        expect(html).toContain(ACCOUNTS.adminA);
        expect(html).toContain('Ada Alpha');
    });

    it('renders the create form with its password control', async () => {
        const html = await body('/manage/accounts/new', cookies.adminA);

        expect(html).toContain('Initial password');
        expect(html).toContain('Acts as');
        // The picker's own empty-state warning must NOT be the first thing a
        // server render says: the candidates list is fetched on the client, and
        // "not yet looked" is not "found nobody".
        expect(html).not.toContain('already has a login, or there is nobody');
    });

    it('renders a login’s detail with its credential panel', async () => {
        const list = await api<{ rows: AccountRow[] }>('/api/accounts?limit=50', {
            cookie: cookies.adminA,
        });
        const own = list.body.rows.find((row) => row.email === ACCOUNTS.viewerA) as AccountRow;

        const html = await body(`/manage/accounts/${own.id}`, cookies.adminA);

        expect(html).toContain(ACCOUNTS.viewerA);
        // The value, not just the label — a static "Acts as" over an unresolved
        // id is exactly the render this asserts against.
        expect(html).toContain('Vic Viewer');
        expect(html).toContain('Issue a new password');
        expect(html).toContain('Sign out everywhere');
    });

    it('redirects a role without account.read away, and renders for one with it', async () => {
        const res = await fetch(`${BASE}/manage/accounts`, {
            headers: { cookie: cookies.viewerA },
            redirect: 'manual',
        });

        expect(res.status).toBe(302);
        expect(res.headers.get('location')).toBe('/manage');
    });
});
