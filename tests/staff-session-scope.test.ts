import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, TEST_PASSWORD, ownerDb, seed, teardown } from './helpers/seed';
import { api, login } from './helpers/client';

/**
 * A browser can legitimately carry BOTH a `calendry_staff_session` cookie and
 * a `calendry_session` cookie at once: a Calendry staff member who is ALSO a
 * signed-in tenant user, in the same browser. Before this fix,
 * `tenantResolver.ts`'s `activeResolver` tried the staff cookie FIRST for
 * EVERY `/api/*` route: `??` short-circuits on the first successful
 * resolver, so a valid staff cookie always won and `sessionCookieResolver`
 * was never even reached. `withRequestTenant()` correctly refuses
 * `kind === 'staff'`, so the visible symptom was every tenant-scoped route
 * 403ing with "A staff session cannot access tenant-scoped routes" for a
 * request whose tenant cookie was entirely valid, reported live as "the
 * frontend tells you you can't access the stuff, even though you have a
 * legitimate normal session cookie".
 *
 * The fix restricts the staff resolver to `/api/staff/*`/`/api/staff-auth/*`
 * paths (`isStaffPath`), so a dual-cookie browser now resolves as `staff` on
 * staff routes and as its tenant identity everywhere else, exactly what
 * both cookies actually describe.
 */
const STAFF_EMAIL = 'dual-cookie-staff@calendry.test';

let tenantCookie = '';
let staffCookie = '';

/** Same idiom as `client.ts`'s `cookieFrom`, for the staff plane's cookie name instead. */
function staffCookieFrom(setCookie: string | null): string {
    const match = setCookie?.match(/(?:^|;\s*|,\s*)calendry_staff_session=([^;,]*)/);

    if (!match) {
        throw new Error(`Expected a calendry_staff_session cookie but got: ${setCookie}`);
    }

    return `calendry_staff_session=${match[1]}`;
}

async function seedStaffAccount() {
    await ownerDb.$executeRawUnsafe(`DELETE FROM staff_account WHERE email = '${STAFF_EMAIL}'`);

    // Reuses `adminA`'s own hash, same technique `ics-links.test.ts`'s
    // `seedOwnOnly` and `form-reference-wave.test.ts`'s `seedOfferingEditor`
    // use: `verifyPassword` recomputes scrypt from the stored salt, so the
    // same hash string verifies the same plaintext (`TEST_PASSWORD`)
    // regardless of which table it was copied into.
    const template = await ownerDb.account.findFirstOrThrow({ where: { email: ACCOUNTS.adminA } });

    // `mustChangePassword: false`: this fixture is standing in for an
    // ALREADY-ONBOARDED staff account, not exercising `provision-staff.ts`'s
    // own forced-reset behavior (that is `scripts/provision-staff.ts`'s own
    // concern, not this suite's).
    await ownerDb.staffAccount.create({
        data: { email: STAFF_EMAIL, passwordHash: template.passwordHash, mustChangePassword: false },
    });
}

beforeAll(async () => {
    await seed();
    await seedStaffAccount();

    tenantCookie = (await login(ACCOUNTS.adminA, TEST_PASSWORD)).cookie;

    const staffLogin = await api<{ requiresPasswordChange?: boolean }>('/api/staff-auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: STAFF_EMAIL, password: TEST_PASSWORD }),
    });

    if (staffLogin.status !== 200) {
        throw new Error(`Staff login failed: ${staffLogin.status} ${JSON.stringify(staffLogin.body)}`);
    }

    staffCookie = staffCookieFrom(staffLogin.setCookie);
});

afterAll(async () => {
    await ownerDb.$executeRawUnsafe(`DELETE FROM staff_account WHERE email = '${STAFF_EMAIL}'`);
    await teardown();
    await ownerDb.$disconnect();
});

describe('a browser holding both a staff and a tenant session cookie', () => {
    it('resolves as the TENANT identity on a tenant-scoped route, not staff', async () => {
        // The exact regression: before the fix, this 403'd with "A staff
        // session cannot access tenant-scoped routes" despite `tenantCookie`
        // being entirely valid on its own.
        const res = await api('/api/me/api-tokens', { cookie: `${staffCookie}; ${tenantCookie}` });

        expect(res.status).toBe(200);
    });

    it('still resolves as STAFF on a staff-scoped route, cookie order reversed', async () => {
        const res = await api('/api/staff/tenants', { cookie: `${tenantCookie}; ${staffCookie}` });

        expect(res.status).toBe(200);
    });

    it('the tenant session alone still works on the tenant route (sanity)', async () => {
        const res = await api('/api/me/api-tokens', { cookie: tenantCookie });

        expect(res.status).toBe(200);
    });

    it('the staff session alone still works on the staff route (sanity)', async () => {
        const res = await api('/api/staff/tenants', { cookie: staffCookie });

        expect(res.status).toBe(200);
    });

    it('the staff cookie alone cannot reach a tenant-scoped route', async () => {
        // `isStaffPath` is false here, so the staff resolver never even
        // runs, so this now resolves NO identity at all (401 "Authentication
        // required"), not the old 403 "A staff session cannot access
        // tenant-scoped routes" (which required the staff cookie to have
        // resolved first). A plain 401 is the more honest answer for a
        // staff-only browser on a tenant route: it isn't signed in AS A
        // TENANT at all, which is what this route actually asks.
        const res = await api('/api/me/api-tokens', { cookie: staffCookie });

        expect(res.status).toBe(401);
    });

    it('the tenant cookie alone cannot reach a staff-scoped route', async () => {
        // Resolves as its (valid) tenant identity: `isStaffPath` only ever
        // narrows which resolver runs FIRST, it doesn't forbid a tenant
        // identity from resolving on a staff path, and is refused by
        // `requireStaffIdentity` inside the route handler itself, same as
        // before this fix; this case was never affected by it.
        const res = await api('/api/staff/tenants', { cookie: tenantCookie });

        expect(res.status).toBe(403);
    });
});
