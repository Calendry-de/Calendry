import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, type Fixtures, TEST_PASSWORD, ownerDb, seed, teardown } from './helpers/seed';
import { api, login } from './helpers/client';

/**
 * Tenant-wide erasure (issue #84): `DELETE /api/staff/tenants/:id`, staff
 * only, via `calendry_internal.staff_erase_tenant()`.
 *
 * A THROWAWAY TENANT, never `tenantA`/`tenantB`: every other file in this
 * suite reseeds from the shared fixture in its own `beforeAll`, and this one
 * is about to delete a tenant outright; reusing either shared one would
 * break every test file that runs after it in the same `vitest` process
 * (`fileParallelism: false`, so ordering matters).
 */
const STAFF_EMAIL = 'erasure-staff@calendry.test';
const TENANT_ID = 'test-erasure-tenant';
const TENANT_SLUG = 'test-erasure';
const PERSON_SOLE_ID = 'test-erasure-person-sole';
const PERSON_SHARED_ID = 'test-erasure-person-shared';
const GROUP_ID = 'test-erasure-group';
/** A Person in tenantA (the shared fixture) with no account of its own, purely so the shared account below has somewhere to survive. */
const PERSON_EXTRA_TENANT_A_ID = 'test-erasure-person-extra-a';
const SOLE_ACCOUNT_EMAIL = 'erasure-sole@test.local';
const SHARED_ACCOUNT_EMAIL = 'erasure-shared@test.local';

let staffCookie = '';
let adminACookie = '';
let sharedAccountId = '';

function staffCookieFrom(setCookie: string | null): string {
    const match = setCookie?.match(/(?:^|;\s*|,\s*)calendry_staff_session=([^;,]*)/);

    if (!match) {
        throw new Error(`Expected a calendry_staff_session cookie but got: ${setCookie}`);
    }

    return `calendry_staff_session=${match[1]}`;
}

async function seedThrowawayTenant(f: Fixtures) {
    await ownerDb.tenant.create({ data: { id: TENANT_ID, slug: TENANT_SLUG, name: 'Erasure Test Institution' } });
    await ownerDb.person.createMany({
        data: [
            { id: PERSON_SOLE_ID, tenantId: TENANT_ID, givenName: 'Solo', familyName: 'Sole', email: 'sole@erasure.test' },
            { id: PERSON_SHARED_ID, tenantId: TENANT_ID, givenName: 'Shar', familyName: 'Shared', email: 'shared@erasure.test' },
        ],
    });
    await ownerDb.group.create({ data: { id: GROUP_ID, tenantId: TENANT_ID, name: 'Erasure Group' } });
    await ownerDb.membership.create({ data: { tenantId: TENANT_ID, personId: PERSON_SOLE_ID, groupId: GROUP_ID } });

    const template = await ownerDb.account.findFirstOrThrow({ where: { email: ACCOUNTS.adminA } });

    const soleAccount = await ownerDb.account.create({
        data: { email: SOLE_ACCOUNT_EMAIL, passwordHash: template.passwordHash },
    });
    await ownerDb.accountPerson.create({ data: { accountId: soleAccount.id, personId: PERSON_SOLE_ID } });

    // Shared across this throwaway tenant AND the shared fixture's tenantA:
    // the account this test expects to SURVIVE erasure. A FRESH Person in
    // tenantA, not one of the fixture's own: every fixture Person already
    // has its own Account, and `account_person` is `@@unique([personId])`.
    await ownerDb.person.create({
        data: { id: PERSON_EXTRA_TENANT_A_ID, tenantId: f.tenantA, givenName: 'Extra', familyName: 'InA', email: 'extra@a.test' },
    });

    const sharedAccount = await ownerDb.account.create({
        data: { email: SHARED_ACCOUNT_EMAIL, passwordHash: template.passwordHash },
    });

    await ownerDb.accountPerson.createMany({
        data: [
            { accountId: sharedAccount.id, personId: PERSON_SHARED_ID },
            { accountId: sharedAccount.id, personId: PERSON_EXTRA_TENANT_A_ID },
        ],
    });
    sharedAccountId = sharedAccount.id;

    await ownerDb.auditLog.create({
        data: { action: 'test.seed', outcome: 'SUCCESS', tenantId: TENANT_ID, target: 'seed marker' },
    });

    await ownerDb.$executeRawUnsafe(`DELETE FROM staff_account WHERE email = '${STAFF_EMAIL}'`);
    await ownerDb.staffAccount.create({
        data: { email: STAFF_EMAIL, passwordHash: template.passwordHash, mustChangePassword: false },
    });
}

async function teardownThrowawayTenant() {
    await ownerDb.$executeRawUnsafe(`DELETE FROM staff_account WHERE email = '${STAFF_EMAIL}'`);
    await ownerDb.$executeRawUnsafe(`DELETE FROM account WHERE email IN ('${SOLE_ACCOUNT_EMAIL}','${SHARED_ACCOUNT_EMAIL}')`);
    await ownerDb.$executeRawUnsafe(`DELETE FROM audit_log WHERE tenant_id = '${TENANT_ID}'`);
    await ownerDb.$executeRawUnsafe(`DELETE FROM tenant WHERE id = '${TENANT_ID}'`);
}

beforeAll(async () => {
    const f = await seed();
    await seedThrowawayTenant(f);

    adminACookie = (await login(ACCOUNTS.adminA, TEST_PASSWORD)).cookie;

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
    await teardownThrowawayTenant();
    await teardown();
    await ownerDb.$disconnect();
});

describe('DELETE /api/staff/tenants/:id', () => {
    it('refuses a tenant Account session, staff only', async () => {
        const res = await api(`/api/staff/tenants/${TENANT_ID}`, {
            method: 'DELETE',
            cookie: adminACookie,
            body: JSON.stringify({ confirmSlug: TENANT_SLUG }),
        });

        expect(res.status).toBe(403);
    });

    it('404s an unknown tenant id', async () => {
        const res = await api('/api/staff/tenants/does-not-exist', {
            method: 'DELETE',
            cookie: staffCookie,
            body: JSON.stringify({ confirmSlug: 'anything' }),
        });

        expect(res.status).toBe(404);
    });

    it('409s and deletes nothing when confirmSlug does not match', async () => {
        const res = await api(`/api/staff/tenants/${TENANT_ID}`, {
            method: 'DELETE',
            cookie: staffCookie,
            body: JSON.stringify({ confirmSlug: 'wrong-slug' }),
        });

        expect(res.status).toBe(409);

        const stillThere = await ownerDb.tenant.findUnique({ where: { id: TENANT_ID } });

        expect(stillThere).not.toBeNull();
    });

    it('erases the tenant and everything cascaded from it, cleans up the sole-tenant account, and keeps the shared one', async () => {
        const res = await api<{ tenant: { id: string }; personCount: number; accountsErased: number }>(
            `/api/staff/tenants/${TENANT_ID}`,
            { method: 'DELETE', cookie: staffCookie, body: JSON.stringify({ confirmSlug: TENANT_SLUG }) },
        );

        expect(res.status).toBe(200);
        expect(res.body.personCount).toBe(2);
        expect(res.body.accountsErased).toBe(1);

        expect(await ownerDb.tenant.findUnique({ where: { id: TENANT_ID } })).toBeNull();
        expect(await ownerDb.person.findUnique({ where: { id: PERSON_SOLE_ID } })).toBeNull();
        expect(await ownerDb.group.findUnique({ where: { id: GROUP_ID } })).toBeNull();

        // The sole-tenant account is gone: nothing else referenced it.
        expect(await ownerDb.account.findFirst({ where: { email: SOLE_ACCOUNT_EMAIL } })).toBeNull();

        // The shared account survives: tenantA's admin Person still holds it.
        const shared = await ownerDb.account.findUnique({ where: { id: sharedAccountId } });

        expect(shared).not.toBeNull();

        // This tenant's own audit trail (the seed marker) was purged …
        const seedMarker = await ownerDb.auditLog.findFirst({ where: { tenantId: TENANT_ID, action: 'test.seed' } });

        expect(seedMarker).toBeNull();

        // … while the erasure itself left exactly one durable record behind.
        const erasedRecord = await ownerDb.auditLog.findFirst({ where: { tenantId: TENANT_ID, action: 'tenant.erased' } });

        expect(erasedRecord).not.toBeNull();
        expect(erasedRecord?.target).toBe(TENANT_SLUG);
    });
});
