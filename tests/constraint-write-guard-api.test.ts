import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, TEST_PASSWORD, ownerDb, seed, teardown } from './helpers/seed';
import { api, login } from './helpers/client';

/**
 * The constraint write guard over HTTP.
 *
 * `constraint-write-guard.test.ts` pins the rules; this pins that both write
 * PATHS actually apply them, which is a separate question and was the whole
 * defect: the rule builder enforced these and the generic CRUD API did not, so
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
 * two paths blame the same FIELD, so the helper normalises the shapes rather
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
            // Not JSON: leave it; the assertion will report the empty list.
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

describe('POST: the create refinement', () => {
    it('refuses a negative weight and blames the weight field', async () => {
        const res = await create({
            type: 'minimize_online_sessions', name: 'Negative', severity: 'SOFT', weight: -5,
        });

        expect(res.status).toBe(400);
        expect(blamedFields(res.body)).toEqual(['weight']);
    });

    it('accepts weight zero', async () => {
        // The counter-example. Without it, a guard that rejected every weight
        // would pass the test above, and zero is a real configuration the
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

describe('PATCH: beforeUpdate, and the row it must not trap', () => {
    it('lets a legacy bad row be DISABLED', async () => {
        // The trap. Validating the merged row would refuse this: the guard
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

/**
 * PARAMETERS over HTTP.
 *
 * The reason this is not left to the unit suite: the issue has to arrive blamed
 * on the PARAMETER's key, not on `params`. `params` is a registered `custom`
 * field the rule builder never renders an error for, so `path: ['params']`
 * would set `fieldErrors.params` on nothing, `applyError` would skip its orphan
 * banner, and the save would fail with no visible cause. Only a call can show
 * which key the response actually names.
 */
describe('parameters, on both write paths', () => {
    it('refuses a weekdays value that is not a list, and blames the parameter', async () => {
        const res = await create({
            type: 'minimize_specifc_day',
            name: 'Bad days',
            severity: 'SOFT',
            weight: 2,
            params: { days: 'monday' },
        });

        expect(res.status).toBe(400);
        // `days`, NOT `params`: see this block's note.
        expect(blamedFields(res.body)).toEqual(['days']);
    });

    it('refuses a non-numeric percent', async () => {
        // HARD with a null weight, because the catalogue pins this type HARD and
        // the DB CHECK pairs HARD with NULL. Getting that wrong made the first
        // version of this test blame two fields and prove nothing about params.
        const res = await create({
            type: 'max_online_ratio_per_group',
            name: 'Bad ratio',
            severity: 'HARD',
            weight: null,
            params: { maxRatio: 'thirty', window: 'SHARE_WINDOW_PER_TERM' },
        });

        expect(res.status).toBe(400);
        expect(blamedFields(res.body)).toEqual(['maxRatio']);
    });

    it('accepts the same rule with valid parameters', async () => {
        // The counter-example: without it, a guard rejecting every params
        // payload would pass both tests above.
        const res = await create({
            type: 'max_online_ratio_per_group',
            name: 'Good ratio',
            severity: 'HARD',
            weight: null,
            params: { maxRatio: 30, window: 'SHARE_WINDOW_PER_WEEK' },
        });

        expect(res.status).toBe(201);
    });

    it('refuses bad parameters on PATCH too, reading the STORED type', async () => {
        // The update path has no `type` in the payload at all, so this only
        // works if `beforeUpdate` reads the row: the same asymmetry the
        // severity and weight cases exist to pin.
        const created = await create({
            type: 'minimize_specifc_day',
            name: 'Patchable',
            severity: 'SOFT',
            weight: 2,
            params: { days: [1] },
        });

        expect(created.status).toBe(201);

        const id = (created.body as { id: string }).id;
        const res = await api(`/api/constraints/${id}`, {
            method: 'PATCH', cookie, body: JSON.stringify({ params: { days: [9] } }),
        });

        expect(res.status).toBe(400);
        expect(blamedFields(res.body)).toEqual(['days']);

        // And it wrote nothing.
        const read = await api(`/api/constraints/${id}`, { cookie });

        expect((read.body as { params: unknown }).params).toEqual({ days: [1] });
    });

    it('lets a row whose params it dislikes still be disabled', async () => {
        // The legacy-row trap, in the params dimension. A row written before
        // this guard existed must stay neutralisable: `params` is not in the
        // patch, so the guard has nothing to say about it.
        await ownerDb.$executeRawUnsafe(
            `INSERT INTO constraint_def (id, tenant_id, type, name, severity, weight, params, updated_at)
             VALUES ($1, $2, 'minimize_specifc_day', 'Legacy params', 'SOFT', 2, '{"days":"monday"}'::jsonb, now())`,
            'test-legacy-params', TENANT,
        );

        const res = await api('/api/constraints/test-legacy-params', {
            method: 'PATCH', cookie, body: JSON.stringify({ isEnabled: false }),
        });

        expect(res.status).toBe(200);
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
