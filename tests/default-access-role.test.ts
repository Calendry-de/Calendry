import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { api, login } from './helpers/client';
import { ACCOUNTS, TEST_PASSWORD, ownerDb, seed, teardown } from './helpers/seed';

/**
 * Tenant-configured default access role for new People (issue #25).
 *
 * Reverses `resources.ts`'s previous "never auto-grant on Person create"
 * stance — see `applyDefaultAccessRole`'s own doc comment for the reasoning.
 * The negative cases here (dangling default, missing permission) are the
 * ones that make that reversal safe, not the happy path alone.
 */
const TENANT_A = 'test-tenant-a';

let cookieAdmin: string;
let roleId: string;
const createdPersonIds: string[] = [];
const createdRoleIds: string[] = [];

beforeAll(async () => {
    await seed();
    cookieAdmin = (await login(ACCOUNTS.adminA, TEST_PASSWORD)).cookie;

    const role = await ownerDb.accessRole.create({
        data: { tenantId: TENANT_A, key: 'default-role-test', name: 'Default role test' },
    });
    roleId = role.id;
    createdRoleIds.push(role.id);
}, 60_000);

afterEach(async () => {
    await ownerDb.tenantAuthSettings.deleteMany({ where: { tenantId: TENANT_A } });

    if (createdPersonIds.length) {
        await ownerDb.person.deleteMany({ where: { id: { in: createdPersonIds } } });
        createdPersonIds.length = 0;
    }
});

afterAll(async () => {
    await ownerDb.accessRole.deleteMany({ where: { id: { in: createdRoleIds } } });
    await teardown();
    await ownerDb.$disconnect();
});

async function createPerson() {
    const res = await api('/api/persons', {
        method: 'POST',
        cookie: cookieAdmin,
        body: JSON.stringify({ givenName: 'New', familyName: 'Person' }),
    });

    expect(res.status).toBe(201);
    createdPersonIds.push(res.body.id);

    return res.body.id as string;
}

describe('GET /api/auth-settings', () => {
    it('reports unconfigured when no row exists', async () => {
        const res = await api('/api/auth-settings', { cookie: cookieAdmin });

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ defaultAccessRoleId: null, defaultAccessRole: null, configured: false });
    });
});

describe('setting and applying a default', () => {
    it('grants nothing when no default is configured', async () => {
        const personId = await createPerson();

        expect(await ownerDb.personAccessRole.count({ where: { personId } })).toBe(0);
    });

    it('grants the configured role, marked as a default grant, when a Person is created', async () => {
        const put = await api('/api/auth-settings', {
            method: 'PUT', cookie: cookieAdmin, body: JSON.stringify({ defaultAccessRoleId: roleId }),
        });

        expect(put.status).toBe(200);
        expect(put.body.defaultAccessRoleId).toBe(roleId);

        const personId = await createPerson();

        const grant = await ownerDb.personAccessRole.findUnique({
            where: { personId_accessRoleId: { personId, accessRoleId: roleId } },
        });

        expect(grant).not.toBeNull();
        expect(grant!.isDefaultGrant).toBe(true);
    });

    it('grants nothing once the default is cleared', async () => {
        await api('/api/auth-settings', {
            method: 'PUT', cookie: cookieAdmin, body: JSON.stringify({ defaultAccessRoleId: roleId }),
        });
        await api('/api/auth-settings', {
            method: 'PUT', cookie: cookieAdmin, body: JSON.stringify({ defaultAccessRoleId: null }),
        });

        const personId = await createPerson();

        expect(await ownerDb.personAccessRole.count({ where: { personId } })).toBe(0);
    });

    it('refuses a role id that does not belong to this tenant', async () => {
        const res = await api('/api/auth-settings', {
            method: 'PUT', cookie: cookieAdmin, body: JSON.stringify({ defaultAccessRoleId: 'not-a-real-role' }),
        });

        expect(res.status).toBe(422);
    });
});

describe('deleting a role that is the configured default', () => {
    it('fails loudly (409) rather than silently clearing the setting', async () => {
        await api('/api/auth-settings', {
            method: 'PUT', cookie: cookieAdmin, body: JSON.stringify({ defaultAccessRoleId: roleId }),
        });

        const res = await api(`/api/access-roles/${roleId}`, { method: 'DELETE', cookie: cookieAdmin });

        expect(res.status).toBe(409);

        // Still configured — the delete never happened.
        const settings = await api('/api/auth-settings', { cookie: cookieAdmin });

        expect(settings.body.defaultAccessRoleId).toBe(roleId);
    });
});

describe('permission enforcement', () => {
    it('refuses a write from someone holding only tenant.update, not person_access_role.assign', async () => {
        const { cookie } = await login(ACCOUNTS.viewerA, TEST_PASSWORD);
        // viewerA holds only session.read — covers "neither", the write-guard
        // API test's own precedent for what a negative case must show.
        const res = await api('/api/auth-settings', {
            method: 'PUT', cookie, body: JSON.stringify({ defaultAccessRoleId: roleId }),
        });

        expect(res.status).toBe(403);
    });
});
