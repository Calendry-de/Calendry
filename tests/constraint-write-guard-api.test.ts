import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, TEST_PASSWORD, ownerDb, seed, teardown } from './helpers/seed';
import { api, login } from './helpers/client';

/**
 * The constraint write guard over HTTP.
 *
 * `constraint-write-guard.test.ts` pins the rules; this pins that both write
 * PATHS actually apply them, which is a separate question and was the whole
 * defect — the rule builder enforced these and the generic CRUD API did not, so
 * anything not going through the form wrote whatever it liked.
 *
 * The two paths differ in what they can see and therefore in mechanism:
 * CREATE has `type` in the payload and uses a zod refinement; UPDATE has no
 * `type` at all (it is create-only) and must read the stored row, so it uses
 * `beforeUpdate`. Testing one would leave the other unpinned.
 */
const TENANT = 'test-tenant-a';
const LEGACY = 'test-legacy-constraint';

let cookie: string | null;

/** A row that predates the guard: pinned HARD by the catalogue, stored SOFT. */
async function insertLegacyRow() {
    await ownerDb.$executeRawUnsafe(
        `INSERT INTO constraint_def (id, tenant_id, type, name, severity, weight, updated_at)
         VALUES ($1, $2, 'no_double_booking_room', 'Legacy mislabelled', 'SOFT', 7, now())`,
        LEGACY, TENANT,
    );
}

const patch = (body: unknown) => api(`/api/constraints/${LEGACY}`, {
    method: 'PATCH', cookie, body: JSON.stringify(body),
});

const create = (body: unknown) => api('/api/constraints', {
    method: 'POST', cookie, body: JSON.stringify(body),
});

/**
 * Field names the response blames.
 *
 * TWO SHAPES, DELIBERATELY BOTH ACCEPTED. The create path's issues come from
 * `readValidatedBody`, which hands back a ZodError whose `message` is the JSON
 * issue array; `beforeUpdate` throws `data.issues` directly. `entityForm`'s
 * `extractIssues` already reads both, and the point of this suite is that the
 * two paths blame the same FIELD — so the helper normalises the shapes rather
 * than pinning one and quietly passing the other.
 */
function blamedFields(body: unknown): string[] {
    const data = (body as { data?: unknown })?.data as
        { issues?: unknown; name?: string; message?: unknown } | undefined;

    const candidates: unknown[] = [data?.issues];

    if (data?.name === 'ZodError' && typeof data.message === 'string') {
        try {
            candidates.push(JSON.parse(data.message));
        } catch {
            // Not JSON — leave it; the assertion will report the empty list.
        }
    }

    const issues = candidates.find(Array.isArray) as { path?: unknown[] }[] | undefined;

    return (issues ?? []).map((i) => String(i.path?.[0] ?? '')).sort();
}

beforeAll(async () => {
    await seed();
    ({ cookie } = await login(ACCOUNTS.adminA, TEST_PASSWORD));
});

afterEach(async () => {
    await ownerDb.$executeRawUnsafe(`DELETE FROM constraint_def WHERE tenant_id = $1`, TENANT);
});

afterAll(async () => {
    await teardown();
    await ownerDb.$disconnect();
});

describe('POST — the create refinement', () => {
    it('refuses a negative weight and blames the weight field', async () => {
        const res = await create({
            type: 'minimize_online_sessions', name: 'Negative', severity: 'SOFT', weight: -5,
        });

        expect(res.status).toBe(400);
        expect(blamedFields(res.body)).toEqual(['weight']);
    });

    it('accepts weight zero', async () => {
        // The counter-example. Without it, a guard that rejected every weight
        // would pass the test above — and zero is a real configuration the
        // solver honours ("report the count, do not steer").
        const res = await create({
            type: 'minimize_online_sessions', name: 'Zero', severity: 'SOFT', weight: 0,
        });

        expect(res.status).toBe(201);
    });

    it('refuses a severity the catalogue contradicts', async () => {
        const res = await create({
            type: 'no_double_booking_room', name: 'Wrong severity', severity: 'SOFT', weight: 3,
        });

        expect(res.status).toBe(400);
        expect(blamedFields(res.body)).toEqual(['severity']);
    });

    it('still accepts an ordinary, correct constraint', async () => {
        const res = await create({
            type: 'no_double_booking_group', name: 'Fine', severity: 'HARD',
        });

        expect(res.status).toBe(201);
    });
});

describe('PATCH — beforeUpdate, and the row it must not trap', () => {
    it('lets a legacy bad row be DISABLED', async () => {
        // The trap. Validating the merged row would refuse this — the guard
        // would block the one action that neutralises the row it objects to.
        await insertLegacyRow();

        expect((await patch({ isEnabled: false })).status).toBe(200);
    });

    it('lets a legacy bad row be RENAMED', async () => {
        await insertLegacyRow();

        expect((await patch({ name: 'Renamed' })).status).toBe(200);
    });

    it('lets a legacy bad row take a valid weight', async () => {
        await insertLegacyRow();

        expect((await patch({ weight: 3 })).status).toBe(200);
    });

    it('lets a legacy bad row be REPAIRED to its catalogue severity', async () => {
        await insertLegacyRow();

        // Weight must go too: the pre-existing CHECK pairs HARD with a null
        // weight. Repair is one PATCH, not an impossible two-step.
        expect((await patch({ severity: 'HARD', weight: null })).status).toBe(200);

        const read = await api(`/api/constraints/${LEGACY}`, { cookie });

        expect(read.body).toMatchObject({ severity: 'HARD', weight: null });
    });

    it('refuses a negative weight on that same legacy row', async () => {
        await insertLegacyRow();

        const res = await patch({ weight: -5 });

        expect(res.status).toBe(400);
        expect(blamedFields(res.body)).toEqual(['weight']);
    });

    it('refuses re-asserting the contradicting severity', async () => {
        await insertLegacyRow();

        const res = await patch({ severity: 'SOFT' });

        expect(res.status).toBe(400);
        expect(blamedFields(res.body)).toEqual(['severity']);
    });

    it('writes nothing when it refuses', async () => {
        await insertLegacyRow();
        await patch({ weight: -5 });

        const read = await api(`/api/constraints/${LEGACY}`, { cookie });

        // beforeUpdate throws inside the transaction, before the update runs.
        expect(read.body).toMatchObject({ weight: 7 });
    });
});

describe('the database CHECK backs the API up', () => {
    it('refuses a negative weight written directly, bypassing the API entirely', async () => {
        // `provision-tenant.ts` writes constraints with `tx.constraint.createMany`
        // and never touches RESOURCES, so a guard living only in the resource
        // schema is one a script walks around. This is the backstop.
        await expect(ownerDb.$executeRawUnsafe(
            `INSERT INTO constraint_def (id, tenant_id, type, name, severity, weight, updated_at)
             VALUES ('raw-neg', $1, 'minimize_online_sessions', 'Raw', 'SOFT', -5, now())`,
            TENANT,
        )).rejects.toThrow(/constraint_weight_non_negative/);
    });

    it('permits zero through the same path', async () => {
        await expect(ownerDb.$executeRawUnsafe(
            `INSERT INTO constraint_def (id, tenant_id, type, name, severity, weight, updated_at)
             VALUES ('raw-zero', $1, 'minimize_online_sessions', 'Raw zero', 'SOFT', 0, now())`,
            TENANT,
        )).resolves.toBeDefined();
    });
});
