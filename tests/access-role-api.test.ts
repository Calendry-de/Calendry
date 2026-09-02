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
 *      `person.update`; otherwise anyone who may edit a person may make
 *      themselves an administrator.
 *
 * The negative cases carry that second point. A suite that only asserted "an
 * admin can assign a role" would pass just as well against a build where the
 * relation defaulted to `person.update`.
 */
const TENANT_A = 'test-tenant-a';

/** Everything a person editor holds, and deliberately not the assign capability. */
const PERSON_EDITOR = 'person-editor@test.local';
/** Holds `person_access_role.assign` and nothing else: the registrar case. */
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
 * against the person editor's own Person, which stripped the very permissions
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
        // long as that request takes, and nothing at all if it fails.
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
        // rather than "empty", the same rule constraint scopes follow.
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
        const clash = await api<{ message?: string }>('/api/access-roles', {
            method: 'POST',
            cookie: cookies.admin,
            body: JSON.stringify({
                key: 'timetabler',
                name: 'Another Timetabler',
                permissions: [{ permissionKey: 'session.read' }],
            }),
        });

        // Never an upsert. A second row that looks like the first is worse than
        // an error: the mislabelled constraint duplicate taught this project
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
         * does, this would be a 200, and anyone who may edit a person could
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

describe('a tenant cannot write away its own administration', () => {
    /**
     * The one invariant with no in-application recovery. Every other permission
     * can be re-granted by an administrator; these two ARE the administrator, so
     * losing the last holder means an operator with the owner database URL and
     * two CLI runs.
     *
     * Three routes reach it and all three are checked, because closing one is
     * exactly the shape of fix that leaves the other two open.
     */
    /**
     * The fixture gives tenant A TWO administrators (Ada and Mel), which is
     * realistic and makes "the last one" untestable: the first draft of this
     * block revoked Ada's grant, got a correct 200 because Mel still held it,
     * and then failed three later assertions with 403s that looked like a broken
     * guard rather than a broken premise.
     *
     * So the extra assignments are lifted for the duration and put back after.
     * Owner-side: this is arranging the world the tests observe, not exercising
     * a route.
     */
    let liftedAdmins: { personId: string; accessRoleId: string }[] = [];

    beforeAll(async () => {
        const adminRole = await ownerDb.accessRole.findFirstOrThrow({
            where: { tenantId: TENANT_A, key: 'tenant-admin' },
        });

        const holders = await ownerDb.personAccessRole.findMany({
            where: { tenantId: TENANT_A, accessRoleId: adminRole.id },
            orderBy: { personId: 'asc' },
        });

        liftedAdmins = holders.slice(1).map((row) => ({ personId: row.personId, accessRoleId: row.accessRoleId }));

        await ownerDb.personAccessRole.deleteMany({
            where: { accessRoleId: adminRole.id, personId: { in: liftedAdmins.map((row) => row.personId) } },
        });
    });

    afterAll(async () => {
        for (const row of liftedAdmins) {
            await ownerDb.personAccessRole.upsert({
                where: { personId_accessRoleId: { personId: row.personId, accessRoleId: row.accessRoleId } },
                create: { ...row, tenantId: TENANT_A },
                update: {},
            });
        }
    });

    it('refuses an edit that would strip the last access_role.manage', async () => {
        const admin = await ownerDb.accessRole.findFirstOrThrow({
            where: { tenantId: TENANT_A, key: 'tenant-admin' },
        });

        const stripped = await api<{ message?: string }>(`/api/access-roles/${admin.id}`, {
            method: 'PATCH',
            cookie: cookies.admin,
            body: JSON.stringify({ permissions: [{ permissionKey: 'session.read' }] }),
        });

        expect(stripped.status).toBe(422);
        expect(JSON.stringify(stripped.body)).toContain('access_role.manage');

        // Rolled back, not partially applied: the guard runs inside the write
        // transaction, so the grants it objected to were never left in place.
        const held = await ownerDb.accessRolePermission.count({ where: { accessRoleId: admin.id } });

        expect(held).toBeGreaterThan(1);
    });

    it('refuses revoking the last administrator\'s assignment', async () => {
        const adminPerson = await ownerDb.personAccessRole.findFirstOrThrow({
            where: { tenantId: TENANT_A, accessRole: { key: 'tenant-admin' } },
        });

        const revoked = await api<{ message?: string }>(
            `/api/persons/${adminPerson.personId}/access-roles`,
            { method: 'PUT', cookie: cookies.admin, body: JSON.stringify([]) },
        );

        expect(revoked.status).toBe(422);

        // The relation is a delete-then-insert; a guard that ran outside the
        // transaction would leave the row deleted and report a refusal.
        const still = await ownerDb.personAccessRole.count({
            where: { personId: adminPerson.personId, accessRoleId: adminPerson.accessRoleId },
        });

        expect(still).toBe(1);
    });

    it('allows stepping back while somebody else still holds it', async () => {
        const adminRole = await ownerDb.accessRole.findFirstOrThrow({
            where: { tenantId: TENANT_A, key: 'tenant-admin' },
        });

        // Two holders now, so one of them leaving is an ordinary handover rather
        // than a lockout. Refusing this would be the guard inventing a rule
        // nobody asked for.
        await ownerDb.personAccessRole.create({
            data: { personId: grantTargetId, accessRoleId: adminRole.id, tenantId: TENANT_A },
        });

        const original = await ownerDb.personAccessRole.findFirstOrThrow({
            where: { tenantId: TENANT_A, accessRoleId: adminRole.id, personId: { not: grantTargetId } },
        });

        const stepped = await api(`/api/persons/${original.personId}/access-roles`, {
            method: 'PUT',
            cookie: cookies.admin,
            body: JSON.stringify([]),
        });

        expect(stepped.status).toBe(200);

        // Put it back: later assertions in this file act as that administrator.
        await ownerDb.personAccessRole.create({
            data: { personId: original.personId, accessRoleId: adminRole.id, tenantId: TENANT_A },
        });
        await ownerDb.personAccessRole.deleteMany({
            where: { personId: grantTargetId, accessRoleId: adminRole.id },
        });
    });

    it('refuses deleting the provisioned tenant-admin role at all', async () => {
        const admin = await ownerDb.accessRole.findFirstOrThrow({
            where: { tenantId: TENANT_A, key: 'tenant-admin' },
        });

        const removed = await api<{ message?: string }>(`/api/access-roles/${admin.id}`, {
            method: 'DELETE',
            cookie: cookies.admin,
        });

        /*
         * 409, not 403: the caller holds `access_role.manage`; what refuses this
         * is the row. Until Step 14 the button was merely hidden and this request
         * succeeded, which for the system role is the shortest path to a tenant
         * that cannot administer itself.
         */
        expect(removed.status).toBe(409);
        expect(await ownerDb.accessRole.count({ where: { id: admin.id } })).toBe(1);
    });

    it('refuses deleting a system domain Role too, which was equally unguarded', async () => {
        const role = await ownerDb.role.create({
            data: { tenantId: TENANT_A, key: 'system-lecturer', name: 'Lecturer', isSystem: true },
        });

        const removed = await api(`/api/roles/${role.id}`, { method: 'DELETE', cookie: cookies.admin });

        expect(removed.status).toBe(409);

        await ownerDb.role.delete({ where: { id: role.id } });
    });
});
