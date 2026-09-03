import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, type Fixtures, TEST_PASSWORD, ownerDb, seed, teardown } from './helpers/seed';
import { api, login } from './helpers/client';

/**
 * `GET /api/staff/audit-log`: the first READER of the persisted audit log
 * (issue #78). Staff-only, cross-tenant, paged, filtered; a row about an
 * erased tenant keeps its id and simply has no label.
 */
const STAFF_EMAIL = 'audit-staff@calendry.test';

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

interface Row {
    id: string;
    action: string;
    outcome: string;
    actorLabel: string | null;
    target: string | null;
    tenantId: string | null;
    tenant: { slug: string; name: string } | null;
    detail: Record<string, unknown>;
    createdAt: string;
}

interface Page { rows: Row[]; total: number; actions: string[] }

const MARK = 'audit-test-';

beforeAll(async () => {
    f = await seed();

    await ownerDb.$executeRawUnsafe(`DELETE FROM staff_account WHERE email = '${STAFF_EMAIL}'`);
    const template = await ownerDb.account.findFirstOrThrow({ where: { email: ACCOUNTS.adminA } });

    await ownerDb.staffAccount.create({
        data: { email: STAFF_EMAIL, passwordHash: template.passwordHash, mustChangePassword: false },
    });

    tenantCookie = (await login(ACCOUNTS.adminA, TEST_PASSWORD)).cookie;

    const staffLogin = await api<unknown>('/api/staff-auth/login', {
        method: 'POST', body: JSON.stringify({ email: STAFF_EMAIL, password: TEST_PASSWORD }),
    });

    staffCookie = staffCookieFrom(staffLogin.setCookie);

    // Rows the filters can single out, spread across both tenants and an
    // erased one. Written directly: the writer never throws, so seeding
    // through it would hide a failed insert.
    await ownerDb.auditLog.createMany({
        data: [
            { action: `${MARK}login.failure`, outcome: 'FAILURE', actorLabel: 'mallory@example.test', target: null, tenantId: null, detail: { reason: 'wrong_password' } },
            { action: `${MARK}access.denied_cross_tenant`, outcome: 'DENIED', actorLabel: 'Ann Admin', target: '/api/rooms', tenantId: f.tenantB, detail: { route: '/api/rooms' } },
            { action: `${MARK}account.updated`, outcome: 'SUCCESS', actorLabel: 'Ann Admin', target: 'bob@a.test', tenantId: f.tenantA, detail: {} },
            { action: `${MARK}tenant.erased`, outcome: 'SUCCESS', actorLabel: 'staff', target: 'gone-tenant', tenantId: 'erased-tenant-id', detail: {} },
        ],
    });
});

afterAll(async () => {
    await ownerDb.auditLog.deleteMany({ where: { action: { startsWith: MARK } } });
    await ownerDb.$executeRawUnsafe(`DELETE FROM staff_account WHERE email = '${STAFF_EMAIL}'`);
    await teardown();
    await ownerDb.$disconnect();
});

const get = (qs: string, cookie: string = staffCookie) => api<Page>(`/api/staff/audit-log${qs}`, { cookie });

describe('who may read it', () => {
    it('refuses a tenant Account session: staff only', async () => {
        expect((await get('', tenantCookie)).status).toBe(403);
    });

    it('refuses a request with no session at all', async () => {
        const res = await api<unknown>('/api/staff/audit-log', {});

        expect([401, 403]).toContain(res.status);
    });
});

describe('the page', () => {
    it('answers { rows, total, actions }, newest first, with every action key listed', async () => {
        const res = await get('?limit=200');

        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(res.body.total).toBeGreaterThanOrEqual(4);
        expect(res.body.rows.length).toBeLessThanOrEqual(200);
        expect(res.body.actions).toEqual(expect.arrayContaining([`${MARK}login.failure`, `${MARK}tenant.erased`]));

        const times = res.body.rows.map((row) => new Date(row.createdAt).getTime());

        expect([...times].sort((a, b) => b - a)).toEqual(times);
    });

    it('labels a live tenant and keeps an erased tenant\'s id with no label', async () => {
        const live = (await get(`?action=${MARK}account.updated`)).body.rows[0]!;
        const gone = (await get(`?action=${MARK}tenant.erased`)).body.rows[0]!;

        expect(live.tenant).toEqual({ slug: 'test-a', name: expect.any(String) });
        expect(gone.tenantId).toBe('erased-tenant-id');
        expect(gone.tenant).toBeNull();
    });

    it('filters by outcome, tenant and a case-insensitive actor/target substring', async () => {
        const denied = await get(`?outcome=DENIED&q=${MARK.slice(0, 0)}ann%20admin`);

        expect(denied.body.rows.every((row) => row.outcome === 'DENIED')).toBe(true);
        expect(denied.body.rows.some((row) => row.action === `${MARK}access.denied_cross_tenant`)).toBe(true);

        const byTenant = await get(`?tenantId=${f.tenantB}`);

        expect(byTenant.body.rows.every((row) => row.tenantId === f.tenantB)).toBe(true);
        expect(byTenant.body.total).toBeGreaterThanOrEqual(1);

        const byTarget = await get('?q=BOB@A.TEST');

        expect(byTarget.body.rows.map((row) => row.action)).toContain(`${MARK}account.updated`);
    });

    it('pages with limit and offset, total unchanged across pages', async () => {
        const first = await get('?limit=2');
        const second = await get('?limit=2&offset=2');

        expect(first.body.rows).toHaveLength(2);
        expect(second.body.total).toBe(first.body.total);
        expect(second.body.rows.map((row) => row.id)).not.toContain(first.body.rows[0]!.id);
    });

    it('refuses an outcome outside the enum and a limit above 200', async () => {
        expect((await get('?outcome=MAYBE')).status).toBe(400);
        expect((await get('?limit=201')).status).toBe(400);
    });
});
