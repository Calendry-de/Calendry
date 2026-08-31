import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, TEST_PASSWORD, seed, teardown } from './helpers/seed';
import { api, login } from './helpers/client';

/**
 * OfferingTemplate (issue #8): a reusable Offering SHAPE, copied onto a new
 * Offering once at creation — never a live link.
 *
 * THE ASSERTION THAT MATTERS is `copies the shape, then diverges from the
 * template`: an Offering created from a template must keep its own field
 * values after the template is edited, or deleted, or both. Everything else
 * here is the ordinary CRUD + permission shape every other resource test
 * follows (see tests/api-token.test.ts).
 */
let adminCookie = '';
let viewerCookie = '';
let ids: Awaited<ReturnType<typeof seed>>;

interface TemplateRow {
    id: string;
    name: string;
    title: string | null;
    kindId: string | null;
    frequency: number | null;
    durationBlocks: number | null;
}

interface OfferingRow {
    id: string;
    title: string;
    frequency: number;
    durationBlocks: number;
    createdFromTemplateId: string | null;
}

beforeAll(async () => {
    ids = await seed();

    adminCookie = (await login(ACCOUNTS.adminA, TEST_PASSWORD)).cookie;
    viewerCookie = (await login(ACCOUNTS.viewerA, TEST_PASSWORD)).cookie;
});

afterAll(teardown);

describe('offering-templates: ordinary CRUD', () => {
    it('creates, lists, reads, updates and deletes a template', async () => {
        const create = await api<TemplateRow>('/api/offering-templates', {
            method: 'POST',
            cookie: adminCookie,
            body: JSON.stringify({
                name: 'Maths — 4x/week',
                title: 'Mathematics',
                frequency: 4,
                durationBlocks: 1,
            }),
        });

        expect(create.status).toBe(201);
        expect(create.body.name).toBe('Maths — 4x/week');

        const list = await api<TemplateRow[]>('/api/offering-templates', { cookie: adminCookie });

        expect(list.status).toBe(200);
        expect(list.body.some((row) => row.id === create.body.id)).toBe(true);

        const read = await api<TemplateRow>(`/api/offering-templates/${create.body.id}`, { cookie: adminCookie });

        expect(read.status).toBe(200);
        expect(read.body.frequency).toBe(4);

        const patch = await api<TemplateRow>(`/api/offering-templates/${create.body.id}`, {
            method: 'PATCH',
            cookie: adminCookie,
            body: JSON.stringify({ frequency: 5 }),
        });

        expect(patch.status).toBe(200);
        expect(patch.body.frequency).toBe(5);

        const del = await api(`/api/offering-templates/${create.body.id}`, {
            method: 'DELETE',
            cookie: adminCookie,
        });

        expect(del.status).toBe(204);
    });

    it('refuses a caller without offering_template.read', async () => {
        // viewerA holds only session.read, per the fixture.
        const res = await api('/api/offering-templates', { cookie: viewerCookie });

        expect(res.status).toBe(403);
    });
});

describe('copy-not-link: an Offering keeps its own shape after the template changes', () => {
    it('copies the shape, then diverges from the template', async () => {
        const template = await api<TemplateRow>('/api/offering-templates', {
            method: 'POST',
            cookie: adminCookie,
            body: JSON.stringify({
                name: 'Chemistry — 3x/week',
                title: 'Chemistry',
                frequency: 3,
                durationBlocks: 2,
            }),
        });

        expect(template.status).toBe(201);

        // The client's `apply()` step happens before this request — this body
        // is exactly what it would send: the template's values, copied onto
        // the create payload, plus the provenance id.
        const offering = await api<OfferingRow>('/api/offerings', {
            method: 'POST',
            cookie: adminCookie,
            body: JSON.stringify({
                termId: ids.termA,
                kindId: `test-kind-a`,
                title: template.body.title,
                frequency: template.body.frequency,
                durationBlocks: template.body.durationBlocks,
                createdFromTemplateId: template.body.id,
            }),
        });

        expect(offering.status).toBe(201);
        expect(offering.body.frequency).toBe(3);
        expect(offering.body.durationBlocks).toBe(2);
        expect(offering.body.createdFromTemplateId).toBe(template.body.id);

        // Edit the template AFTER the Offering was created from it.
        const editTemplate = await api<TemplateRow>(`/api/offering-templates/${template.body.id}`, {
            method: 'PATCH',
            cookie: adminCookie,
            body: JSON.stringify({ frequency: 9, durationBlocks: 9, title: 'Renamed' }),
        });

        expect(editTemplate.status).toBe(200);
        expect(editTemplate.body.frequency).toBe(9);

        // The earlier Offering must be completely unaffected by that edit —
        // this is the whole point of "copied, not linked".
        const reread = await api<OfferingRow>(`/api/offerings/${offering.body.id}`, { cookie: adminCookie });

        expect(reread.status).toBe(200);
        expect(reread.body.frequency).toBe(3);
        expect(reread.body.durationBlocks).toBe(2);
        expect(reread.body.title).toBe('Chemistry');
        // Provenance survives the template's edit.
        expect(reread.body.createdFromTemplateId).toBe(template.body.id);

        // Deleting the template must not touch the Offering's fields either —
        // only the (informational) provenance link is cleared.
        const deleteTemplate = await api(`/api/offering-templates/${template.body.id}`, {
            method: 'DELETE',
            cookie: adminCookie,
        });

        expect(deleteTemplate.status).toBe(204);

        const final = await api<OfferingRow>(`/api/offerings/${offering.body.id}`, { cookie: adminCookie });

        expect(final.status).toBe(200);
        expect(final.body.frequency).toBe(3);
        expect(final.body.durationBlocks).toBe(2);
        expect(final.body.createdFromTemplateId).toBeNull();

        // Clean up the Offering fixture created in this test.
        await api(`/api/offerings/${offering.body.id}`, { method: 'DELETE', cookie: adminCookie });
    });
});
