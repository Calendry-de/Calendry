import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, TEST_PASSWORD, ownerDb, seed, teardown } from './helpers/seed';
import { api, login } from './helpers/client';

/**
 * The tenant-facing AccessRole API (Step 14).
 *
 * Until this, `access_role`, `access_role_permission` and `person_access_role`
 * had no route at all: `provision:tenant` minted one role and the operator CLIs
 * were the only way to make another. `access_role.manage` and
 * `person_access_role.assign` sat in the catalogue, granted to every
 * tenant-admin, checked by nothing.
 *
 * Two things here are not ordinary CRUD assertions and are the reason the file
 * exists:
 *
 *   1. the permissions are `access_role.manage`, not four CRUD verbs, and
 *      READING the role list additionally accepts `person_access_role.assign`
 *      so the Person page's picker is not blank for a registrar;
 *   2. granting a role is behind `person_access_role.assign` and NOT behind
 *      `person.update` — otherwise anyone who may edit a person may make
 *      themselves an administrator.
 *
 * The negative cases carry that second point. A suite that only asserted "an
 * admin can assign a role" would pass just as well against a build where the
 * relation defaulted to `person.update`.
 */
const TENANT_A = 'test-tenant-a';

/** Everything a person editor holds, and deliberately not the assign capability. */
const PERSON_EDITOR = 'person-editor@test.local';
/** Holds `person_access_role.assign` and nothing else — the registrar case. */
const REGISTRAR = 'registrar@test.local';

const cookies: Record<string, string> = {};

async function seedAccount(email: string, key: string, name: string, permissions: string[]) {
    await ownerDb.$executeRawUnsafe(`DELETE FROM account WHERE email = '${email}'`);

    const role = await ownerDb.accessRole.create({ data: { tenantId: TENANT_A, key, name } });

    await ownerDb.accessRolePermission.createMany({
        data: permissions.map((permissionKey) => ({ accessRoleId: role.id, permissionKey, tenantId: TENANT_A })),
    });

    const person = await ownerDb.person.create({
        data: { tenantId: TENANT_A, givenName: 'Fix', familyName: key, email: `${key}@a.test` },
    });

    await ownerDb.personAccessRole.create({
        data: { personId: person.id, accessRoleId: role.id, tenantId: TENANT_A },
    });

    // The same hash every fixture account uses, so TEST_PASSWORD logs in.
    const template = await ownerDb.account.findFirstOrThrow({ where: { email: ACCOUNTS.adminA } });
    const account = await ownerDb.account.create({ data: { email, passwordHash: template.passwordHash } });

    await ownerDb.accountPerson.create({ data: { accountId: account.id, personId: person.id } });

    return { roleId: role.id, personId: person.id };
}

/**
 * A plain Person with no account, used as the GRANT TARGET.
 *
 * Deliberately not one of the acting accounts: revoking a set includes revoking
 * it from yourself, and an earlier draft of this file granted-then-revoked
 * against the person editor's own Person — which stripped the very permissions
 * the next assertion depended on, and reported it as an unrelated 403.
 */
let grantTargetId = '';

beforeAll(async () => {
    await seed();

    grantTargetId = (await ownerDb.person.create({
        data: { tenantId: TENANT_A, givenName: 'Tara', familyName: 'Target', email: 'tara@a.test' },
    })).id;

    await seedAccount(
        PERSON_EDITOR,
        'person-editor',
        'Person Editor',
        ['person.read', 'person.create', 'person.update', 'person.delete'],
    );

    await seedAccount(REGISTRAR, 'registrar', 'Registrar', ['person_access_role.assign']);

    for (const [name, email] of [
        ['admin', ACCOUNTS.adminA],
        ['viewer', ACCOUNTS.viewerA],
        ['personEditor', PERSON_EDITOR],
        ['registrar', REGISTRAR],
    ] as const) {
        cookies[name] = (await login(email, TEST_PASSWORD)).cookie;
    }
});

afterAll(async () => {
    for (const email of [PERSON_EDITOR, REGISTRAR]) {
        await ownerDb.$executeRawUnsafe(`DELETE FROM account WHERE email = '${email}'`);
    }

    await teardown();
    await ownerDb.$disconnect();
});

interface RoleRow {
    id: string;
    key: string;
    name: string;
    isSystem: boolean;
    permissions: { permissionKey: string }[];
}

describe('access roles: composing a role', () => {
    it('creates a role with its grants in ONE request', async () => {
        const created = await api<RoleRow>('/api/access-roles', {
            method: 'POST',
            cookie: cookies.admin,
            body: JSON.stringify({
                key: 'timetabler',
                name: 'Timetabler',
                description: 'May run the solver.',
                permissions: [{ permissionKey: 'session.read' }, { permissionKey: 'solver.trigger' }],
            }),
        });

        expect(created.status).toBe(201);

        // The grants must exist the moment the role does. A role created empty
        // and populated by a second request is a role that grants nothing for as
        // long as that request takes — and nothing at all if it fails.
        const read = await api<RoleRow>(`/api/access-roles/${created.body.id}`, { cookie: cookies.admin });

        expect(read.status).toBe(200);
        expect(read.body.permissions.map((p) => p.permissionKey).sort())
            .toEqual(['session.read', 'solver.trigger']);
        expect(read.body.isSystem).toBe(false);
    });

    it('replaces the grant set wholesale on update', async () => {
        const role = await ownerDb.accessRole.findFirstOrThrow({ where: { tenantId: TENANT_A, key: 'timetabler' } });

        const patched = await api<RoleRow>(`/api/access-roles/${role.id}`, {
            method: 'PATCH',
            cookie: cookies.admin,
            body: JSON.stringify({
                name: 'Timetabler (senior)',
                permissions: [{ permissionKey: 'session.read' }, { permissionKey: 'session.move' }],
            }),
        });

        expect(patched.status).toBe(200);

        const held = await ownerDb.accessRolePermission.findMany({
            where: { accessRoleId: role.id },
            select: { permissionKey: true },
        });

        expect(held.map((p) => p.permissionKey).sort()).toEqual(['session.move', 'session.read']);
    });

    it('leaves the grants alone when the patch does not mention them', async () => {
        const role = await ownerDb.accessRole.findFirstOrThrow({ where: { tenantId: TENANT_A, key: 'timetabler' } });

        // Renaming a role must not silently strip it. `permissions` is optional
        // on the update schema precisely so an omitted key means "unchanged"
        // rather than "empty" — the same rule constraint scopes follow.
        const patched = await api(`/api/access-roles/${role.id}`, {
            method: 'PATCH',
            cookie: cookies.admin,
            body: JSON.stringify({ description: 'Renamed only.' }),
        });

        expect(patched.status).toBe(200);
        expect(await ownerDb.accessRolePermission.count({ where: { accessRoleId: role.id } })).toBe(2);
    });

    it('refuses a role that would hold nothing', async () => {
        const empty = await api('/api/access-roles', {
            method: 'POST',
            cookie: cookies.admin,
            body: JSON.stringify({ key: 'hollow', name: 'Hollow', permissions: [] }),
        });

        // 400 from the schema: a role holding nothing is a role that does
        // nothing, and it will be assigned to somebody who then cannot act and
        // has no way to see why. `create:role` refuses the same thing on the CLI.
        expect(empty.status).toBe(400);
        expect(await ownerDb.accessRole.count({ where: { tenantId: TENANT_A, key: 'hollow' } })).toBe(0);
    });

    it('refuses a permission key the catalogue does not have, naming the field', async () => {
        const bogus = await api<{ data?: { issues?: { path: string[] }[] } }>('/api/access-roles', {
            method: 'POST',
            cookie: cookies.admin,
            body: JSON.stringify({
                key: 'bogus',
                name: 'Bogus',
                permissions: [{ permissionKey: 'session.teleport' }],
            }),
        });

        // A foreign-key violation would also refuse it, as a 409 saying nothing
        // about which key was wrong. Rejected at the boundary instead, against
        // the same catalogue the seed writes from.
        expect(bogus.status).toBe(400);
        expect(JSON.stringify(bogus.body)).toContain('permissions');
    });

    it('refuses a duplicate key and names the incumbent', async () => {
        const clash = await api<{ statusMessage?: string; message?: string }>('/api/access-roles', {
            method: 'POST',
            cookie: cookies.admin,
            body: JSON.stringify({
                key: 'timetabler',
                name: 'Another Timetabler',
                permissions: [{ permissionKey: 'session.read' }],
            }),
        });

        // Never an upsert. A second row that looks like the first is worse than
        // an error — the mislabelled constraint duplicate taught this project
        // that once already.
        expect(clash.status).toBe(409);
        expect(JSON.stringify(clash.body)).toContain('Timetabler');
        expect(await ownerDb.accessRole.count({ where: { tenantId: TENANT_A, key: 'timetabler' } })).toBe(1);
    });

    it('deletes a role, and the grants go with it', async () => {
        const created = await api<RoleRow>('/api/access-roles', {
            method: 'POST',
            cookie: cookies.admin,
            body: JSON.stringify({
                key: 'ephemeral',
                name: 'Ephemeral',
                permissions: [{ permissionKey: 'room.read' }],
            }),
        });

        const removed = await api(`/api/access-roles/${created.body.id}`, {
            method: 'DELETE',
            cookie: cookies.admin,
        });

        expect(removed.status).toBe(204);
        expect(await ownerDb.accessRolePermission.count({ where: { accessRoleId: created.body.id } })).toBe(0);
    });
});

describe('access roles: who may do what', () => {
    it('refuses a viewer every write, and the read too', async () => {
        const list = await api('/api/access-roles', { cookie: cookies.viewer });
        const create = await api('/api/access-roles', {
            method: 'POST',
            cookie: cookies.viewer,
            body: JSON.stringify({ key: 'x', name: 'X', permissions: [{ permissionKey: 'session.read' }] }),
        });

        expect(list.status).toBe(403);
        expect(create.status).toBe(403);
    });

    it('lets a registrar READ the roles, holding only person_access_role.assign', async () => {
        const list = await api<RoleRow[]>('/api/access-roles', { cookie: cookies.registrar });

        /*
         * This is the whole reason the read accepts either permission. The
         * registrar's job is to grant existing roles; gating the list on
         * `access_role.manage` would leave their picker empty, which reads as
         * "this tenant has no roles" rather than "you may not see them".
         */
        expect(list.status).toBe(200);
        expect(list.body.length).toBeGreaterThan(0);
    });

    it('refuses that registrar every WRITE to a role', async () => {
        const role = await ownerDb.accessRole.findFirstOrThrow({ where: { tenantId: TENANT_A, key: 'viewer' } });

        const create = await api('/api/access-roles', {
            method: 'POST',
            cookie: cookies.registrar,
            body: JSON.stringify({ key: 'y', name: 'Y', permissions: [{ permissionKey: 'session.read' }] }),
        });
        const patch = await api(`/api/access-roles/${role.id}`, {
            method: 'PATCH',
            cookie: cookies.registrar,
            body: JSON.stringify({ name: 'Renamed by a registrar' }),
        });

        // Reading the list is not authority to compose one. Otherwise the
        // narrower capability would silently be the wider one.
        expect(create.status).toBe(403);
        expect(patch.status).toBe(403);
    });
});

describe('granting a role to a person', () => {
    it('is behind person_access_role.assign, NOT person.update', async () => {
        const role = await ownerDb.accessRole.findFirstOrThrow({ where: { tenantId: TENANT_A, key: 'viewer' } });

        /*
         * The person editor holds all four `person.*` permissions. If this
         * relation defaulted to the parent's `.update`, as every other relation
         * does, this would be a 200 — and anyone who may edit a person could
         * make themselves an administrator.
         */
        const denied = await api(`/api/persons/${grantTargetId}/access-roles`, {
            method: 'PUT',
            cookie: cookies.personEditor,
            body: JSON.stringify([{ accessRoleId: role.id }]),
        });

        expect(denied.status).toBe(403);
        expect(JSON.stringify(denied.body)).toContain('person_access_role.assign');
    });

    it('lets the registrar grant and revoke', async () => {
        const role = await ownerDb.accessRole.findFirstOrThrow({ where: { tenantId: TENANT_A, key: 'viewer' } });

        const granted = await api<{ accessRoleId: string }[]>(
            `/api/persons/${grantTargetId}/access-roles`,
            { method: 'PUT', cookie: cookies.registrar, body: JSON.stringify([{ accessRoleId: role.id }]) },
        );

        expect(granted.status).toBe(200);
        expect(granted.body.map((row) => row.accessRoleId)).toContain(role.id);

        const revoked = await api<{ accessRoleId: string }[]>(
            `/api/persons/${grantTargetId}/access-roles`,
            { method: 'PUT', cookie: cookies.registrar, body: JSON.stringify([]) },
        );

        expect(revoked.status).toBe(200);
        expect(revoked.body).toEqual([]);
    });

    it('reads the current grants under the parent\'s own person.read', async () => {
        // Deliberately NOT behind the assign capability: seeing who holds which
        // role inside your own tenant is not privileged, and gating it would
        // blank the Person page for anyone who may edit people.
        const read = await api(`/api/persons/${grantTargetId}/access-roles`, {
            cookie: cookies.personEditor,
        });

        expect(read.status).toBe(200);
    });
});
