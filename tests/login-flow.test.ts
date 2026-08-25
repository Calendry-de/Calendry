import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, cookieFrom, login } from './helpers/client';
import { ACCOUNTS, type Fixtures, TEST_PASSWORD, ownerDb, seed, teardown } from './helpers/seed';

/**
 * Page-level routing for the login flow.
 *
 * The route guard is a convenience, not a security boundary — the API enforces
 * auth independently. It is still worth testing, because a guard that silently
 * lets an unauthenticated visitor onto a page produces a broken screen full of
 * failed requests, and one that bounces a signed-in user produces a redirect
 * loop.
 */
const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:8080';

let f: Fixtures;

/** Pages must be fetched without following redirects, to observe them. */
async function page(path: string, cookie?: string) {
    const res = await fetch(`${BASE}${path}`, {
        redirect: 'manual',
        headers: cookie ? { cookie } : {},
    });

    return { status: res.status, location: res.headers.get('location'), html: await res.text() };
}

beforeAll(async () => {
    f = await seed();
}, 60_000);

afterAll(async () => {
    await teardown();
    await ownerDb.$disconnect();
});

describe('unauthenticated routing', () => {
    it('redirects a protected page to /login', async () => {
        // `/` is the PUBLIC landing page, so the protected home is /dashboard —
        // and this assertion has to name it, or the suite would be testing the
        // guard against a route the guard deliberately ignores.
        const res = await page('/dashboard');

        expect(res.status).toBe(302);
        expect(res.location).toContain('/login');
    });

    it('serves the public landing page at / without a session', async () => {
        const res = await page('/');

        expect(res.status).toBe(200);
        expect(res.html).toContain('In active development');
    });

    it('preserves the intended destination as ?redirect', async () => {
        const res = await page('/schedule');

        expect(res.status).toBe(302);
        expect(res.location).toContain('redirect=/schedule');
    });

    it('serves the login page itself', async () => {
        const res = await page('/login');

        expect(res.status).toBe(200);
        expect(res.html).toContain('Sign in to continue');
        // No self-service signup exists by design; the page says so.
        expect(res.html).toContain('no self-service sign-up');
    });
});

describe('authenticated routing', () => {
    it('lets a signed-in user onto the home page', async () => {
        const { cookie } = await login(ACCOUNTS.adminA, TEST_PASSWORD);
        const res = await page('/dashboard', cookie);

        expect(res.status).toBe(200);
        expect(res.html).toContain('Tenant A');
        expect(res.html).toContain('Ada Alpha');
    });

    it('bounces a signed-in user away from /login, to the signed-in home', async () => {
        const { cookie } = await login(ACCOUNTS.adminA, TEST_PASSWORD);
        const res = await page('/login', cookie);

        expect(res.status).toBe(302);
        // Not `/`: bouncing a signed-in user onto the marketing page would be a
        // redirect loop's worth of confusion, and HOME_ROUTE exists to keep the
        // guard and the login page agreeing about this one path.
        expect(res.location).toBe('/dashboard');
    });

    it('honours ?redirect after signing in', async () => {
        const { cookie } = await login(ACCOUNTS.adminA, TEST_PASSWORD);
        const res = await page('/login?redirect=/violations', cookie);

        expect(res.status).toBe(302);
        expect(res.location).toBe('/violations');
    });

    it('refuses an off-site ?redirect', async () => {
        const { cookie } = await login(ACCOUNTS.adminA, TEST_PASSWORD);
        const res = await page('/login?redirect=//evil.example.com/x', cookie);

        // Protocol-relative URLs are the classic open-redirect vector.
        expect(res.status).toBe(302);
        expect(res.location).toBe('/dashboard');
    });

    it('still allows /login?select=1 so a signed-in user can switch tenant', async () => {
        const { cookie } = await login(ACCOUNTS.multi, TEST_PASSWORD, 'test-a');
        const res = await page('/login?select=1', cookie);

        expect(res.status).toBe(200);
        expect(res.html).toContain('more than one institution');
    });
});

describe('tenant selection gate', () => {
    it('keeps a selection-pending session off protected pages', async () => {
        const res = await api<{ tenantSelectionRequired: boolean }>('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email: ACCOUNTS.multi, password: TEST_PASSWORD }),
        });

        expect(res.body.tenantSelectionRequired).toBe(true);

        const cookie = cookieFrom(res.setCookie);

        // Authenticated but not situated in a tenant: the guard must not treat
        // this as signed in, or the home page would render with no tenant.
        const home = await page('/dashboard', cookie);

        expect(home.status).toBe(302);
        expect(home.location).toContain('/login');

        // ...and the login page must let it stay, so selection can finish.
        expect((await page('/login', cookie)).status).toBe(200);

        await api('/api/auth/select-tenant', {
            method: 'POST',
            cookie,
            body: JSON.stringify({ tenantId: f.tenantB }),
        });

        const after = await page('/dashboard', cookie);

        expect(after.status).toBe(200);
        expect(after.html).toContain('Tenant B');
    });
});
