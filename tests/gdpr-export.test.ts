import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, type Fixtures, TEST_PASSWORD, seed, teardown } from './helpers/seed';
import { api, login } from './helpers/client';

/**
 * GDPR data export (issue #84): per-Person (self-service and admin) and
 * tenant-wide. Erasure lives in its own file (`gdpr-erasure.test.ts`): it
 * needs a throwaway tenant, never the shared fixture every other file here
 * depends on.
 */
let f: Fixtures;
let adminACookie = '';
let viewerACookie = '';
let adminBCookie = '';

beforeAll(async () => {
    f = await seed();
    adminACookie = (await login(ACCOUNTS.adminA, TEST_PASSWORD)).cookie;
    viewerACookie = (await login(ACCOUNTS.viewerA, TEST_PASSWORD)).cookie;
    adminBCookie = (await login(ACCOUNTS.adminB, TEST_PASSWORD)).cookie;
});

afterAll(async () => {
    await teardown();
});

interface PersonExportBundle {
    person: { id: string; email: string | null };
    groupMemberships: { groupId: string }[];
    sessionsAttended: { sessionId: string }[];
}

describe('GET /api/me/export', () => {
    it('exports the caller\'s own data: profile, groups and sessions included', async () => {
        const res = await api<PersonExportBundle>('/api/me/export', { cookie: adminACookie });

        expect(res.status).toBe(200);
        expect(res.body.person.id).toBe(f.personA);
        expect(res.body.groupMemberships.map((g) => g.groupId)).toContain(f.groupSeminarA);
        expect(res.body.sessionsAttended.map((s) => s.sessionId)).toContain(f.sessionA);
    });

    it('serves an .xlsx workbook on ?format=xlsx', async () => {
        const res = await api('/api/me/export?format=xlsx', { cookie: adminACookie });

        expect(res.status).toBe(200);
    });
});

describe('GET /api/person-export/:id', () => {
    it('refuses a caller without person.export', async () => {
        const res = await api(`/api/person-export/${f.personViewerA}`, { cookie: viewerACookie });

        expect(res.status).toBe(403);
    });

    it('exports another Person in the same tenant, for a caller holding person.export', async () => {
        const res = await api<PersonExportBundle>(`/api/person-export/${f.personViewerA}`, { cookie: adminACookie });

        expect(res.status).toBe(200);
        expect(res.body.person.id).toBe(f.personViewerA);
    });

    it('404s a Person in a different tenant: cross-tenant ids are invisible, not forbidden', async () => {
        const res = await api(`/api/person-export/${f.personB}`, { cookie: adminACookie });

        expect(res.status).toBe(404);
    });

    it('still leaves the generic /api/persons CRUD route fully intact', async () => {
        const list = await api('/api/persons', { cookie: adminACookie });

        expect(list.status).toBe(200);

        const byId = await api(`/api/persons/${f.personViewerA}`, { cookie: adminACookie });

        expect(byId.status).toBe(200);
    });
});

interface TenantExportBundle {
    persons: { id: string }[];
}

describe('GET /api/tenant/export', () => {
    it('refuses a caller without tenant.export', async () => {
        const res = await api('/api/tenant/export', { cookie: viewerACookie });

        expect(res.status).toBe(403);
    });

    it('exports this tenant\'s whole dataset, scoped to the caller\'s own tenant', async () => {
        const res = await api<TenantExportBundle>('/api/tenant/export', { cookie: adminACookie });

        expect(res.status).toBe(200);
        const ids = res.body.persons.map((p) => p.id);

        expect(ids).toContain(f.personA);
        expect(ids).not.toContain(f.personB);
    });

    it('serves an .xlsx workbook on ?format=xlsx', async () => {
        const res = await api('/api/tenant/export?format=xlsx', { cookie: adminBCookie });

        expect(res.status).toBe(200);
    });
});
