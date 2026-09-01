import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, type Fixtures, TEST_PASSWORD, ownerDb, seed, teardown } from './helpers/seed';
import { api, login } from './helpers/client';

/**
 * Federation management from the staff panel — issue #64's UI half.
 *
 * `POST /api/staff/federations` and `PATCH /api/staff/tenants/:id` call
 * `calendry_internal.staff_create_federation()` /
 * `staff_set_tenant_federation()` — narrow SECURITY DEFINER functions, the
 * same technique issue #105 used for tenant creation — through the ORDINARY
 * `calendry_app` role. `federation`'s own RLS policy (`federation_member_read`)
 * would otherwise make it invisible to a staff request, which opens no
 * tenant/federation context at all.
 */
const STAFF_EMAIL = 'federations-staff@calendry.test';
const NEW_FEDERATION_SLUG = 'test-new-federation';

let f: Fixtures;
let staffCookie = '';
let tenantCookie = '';

function staffCookieFrom(setCookie: string | null): string {
    const match = setCookie?.match(/(?:^|;\s*|,\s*)calendry_staff_session=([^;,]*)/);

    if (!match) {
        throw new Error(`Expected a calendry_staff_session cookie but got: ${setCookie}`);
    }

    return `calendry_staff_session=${match[1]}`;
}

async function seedStaffAccount() {
    await ownerDb.$executeRawUnsafe(`DELETE FROM staff_account WHERE email = '${STAFF_EMAIL}'`);

    const template = await ownerDb.account.findFirstOrThrow({ where: { email: ACCOUNTS.adminA } });

    await ownerDb.staffAccount.create({
        data: { email: STAFF_EMAIL, passwordHash: template.passwordHash, mustChangePassword: false },
    });
}

beforeAll(async () => {
    f = await seed();
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
    await ownerDb.$executeRawUnsafe(`DELETE FROM federation WHERE slug = '${NEW_FEDERATION_SLUG}'`);
    await teardown();
    await ownerDb.$disconnect();
});

interface CreateFederationResult {
    federation: { id: string; slug: string; name: string };
    alreadyExisted: boolean;
}

describe('creating a Federation', () => {
    it('refuses a tenant Account session — staff only', async () => {
        const res = await api('/api/staff/federations', {
            method: 'POST',
            cookie: tenantCookie,
            body: JSON.stringify({ slug: NEW_FEDERATION_SLUG, name: 'New Federation' }),
        });

        expect(res.status).toBe(403);
    });

    it('creates a Federation', async () => {
        const res = await api<CreateFederationResult>('/api/staff/federations', {
            method: 'POST',
            cookie: staffCookie,
            body: JSON.stringify({ slug: NEW_FEDERATION_SLUG, name: 'New Federation' }),
        });

        expect(res.status).toBe(200);
        expect(res.body.alreadyExisted).toBe(false);
        expect(res.body.federation.slug).toBe(NEW_FEDERATION_SLUG);
    });

    it('is idempotent by slug — a second create reports alreadyExisted, never renames', async () => {
        const res = await api<CreateFederationResult>('/api/staff/federations', {
            method: 'POST',
            cookie: staffCookie,
            body: JSON.stringify({ slug: NEW_FEDERATION_SLUG, name: 'A different name entirely' }),
        });

        expect(res.status).toBe(200);
        expect(res.body.alreadyExisted).toBe(true);
        expect(res.body.federation.name).toBe('New Federation');
    });

    it('lists it, with no member tenants yet', async () => {
        const res = await api<{ rows: { slug: string; tenants: { slug: string }[] }[] }>(
            '/api/staff/federations',
            { cookie: staffCookie },
        );

        expect(res.status).toBe(200);
        const row = res.body.rows.find((r) => r.slug === NEW_FEDERATION_SLUG);

        expect(row).toBeTruthy();
        expect(row?.tenants).toEqual([]);
    });
});

describe('attaching and detaching a Tenant', () => {
    it('refuses a tenant Account session — staff only', async () => {
        const res = await api(`/api/staff/tenants/${f.tenantA}`, {
            method: 'PATCH',
            cookie: tenantCookie,
            body: JSON.stringify({ federationId: null }),
        });

        expect(res.status).toBe(403);
    });

    it('404s an unknown tenant id', async () => {
        const res = await api('/api/staff/tenants/does-not-exist', {
            method: 'PATCH',
            cookie: staffCookie,
            body: JSON.stringify({ federationId: null }),
        });

        expect(res.status).toBe(404);
    });

    it('404s an unknown federation id', async () => {
        const res = await api(`/api/staff/tenants/${f.tenantA}`, {
            method: 'PATCH',
            cookie: staffCookie,
            body: JSON.stringify({ federationId: 'does-not-exist' }),
        });

        expect(res.status).toBe(404);
    });

    it('moves a Tenant from one Federation to another, then detaches it', async () => {
        // The shared fixture (tests/helpers/seed.ts) starts tenantA attached
        // to `test-fed` — moving it here and detaching it at the end is safe
        // because every OTHER test file reseeds from scratch via its own
        // `beforeAll`/`teardown()` pair; nothing in THIS file depends on
        // tenantA staying on `test-fed` past this point.
        const created = await api<CreateFederationResult>('/api/staff/federations', {
            cookie: staffCookie,
            method: 'POST',
            body: JSON.stringify({ slug: NEW_FEDERATION_SLUG, name: 'New Federation' }),
        });

        const attach = await api<{ tenantId: string; federationId: string | null }>(
            `/api/staff/tenants/${f.tenantA}`,
            { method: 'PATCH', cookie: staffCookie, body: JSON.stringify({ federationId: created.body.federation.id }) },
        );

        expect(attach.status).toBe(200);
        expect(attach.body.federationId).toBe(created.body.federation.id);

        const listed = await api<{ rows: { id: string; federation: { slug: string } | null }[] }>(
            '/api/staff/tenants',
            { cookie: staffCookie },
        );
        const tenantRow = listed.body.rows.find((r) => r.id === f.tenantA);

        expect(tenantRow?.federation?.slug).toBe(NEW_FEDERATION_SLUG);

        const detach = await api<{ federationId: string | null }>(`/api/staff/tenants/${f.tenantA}`, {
            method: 'PATCH',
            cookie: staffCookie,
            body: JSON.stringify({ federationId: null }),
        });

        expect(detach.status).toBe(200);
        expect(detach.body.federationId).toBeNull();
    });
});
