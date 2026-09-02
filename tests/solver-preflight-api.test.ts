import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { api, login } from './helpers/client';
import { ACCOUNTS, type Fixtures, TEST_PASSWORD, ownerDb, seed, teardown } from './helpers/seed';

/**
 * The real bug: `minimize_block_usage` seeded/configured enabled with no
 * block selection reached the solver, which rejected the whole run with
 * `INVALID_ARGUMENT` 68ms after the `solver_run` row was created — an instant
 * failure indistinguishable from a broken button, because nothing before the
 * gRPC call could see it coming.
 *
 * Exercised over real HTTP, never through a completed run: the pre-flight
 * check runs and SHORT-CIRCUITS before `POST /api/solver/runs` ever calls the
 * solver (`server/api/solver/runs/index.post.ts`), so this is safe to assert
 * without a live solver connection — unlike a run that actually starts, which
 * `tests/solver-input-snapshot.test.ts`'s own comment says needs one.
 */
let f: Fixtures;

beforeAll(async () => {
    f = await seed();
}, 60_000);

afterEach(async () => {
    await ownerDb.constraint.deleteMany({ where: { tenantId: f.tenantA, type: 'minimize_block_usage' } });
});

afterAll(async () => {
    await teardown();
    await ownerDb.$disconnect();
});

describe('GET /api/solver/preflight', () => {
    it('reports nothing wrong when every enabled constraint can be sent', async () => {
        const { cookie } = await login(ACCOUNTS.adminA, TEST_PASSWORD);
        const res = await api(`/api/solver/preflight?termId=${f.termA}`, { cookie });

        expect(res.status).toBe(200);
        expect(res.body.issues).toEqual([]);
    });

    it('names the specific constraint and the specific fix for the production bug\'s exact row shape', async () => {
        const broken = await ownerDb.constraint.create({
            data: {
                tenantId: f.tenantA,
                type: 'minimize_block_usage',
                name: 'Avoid particular blocks',
                severity: 'SOFT',
                weight: 5,
                isEnabled: true,
                params: {},
            },
        });

        const { cookie } = await login(ACCOUNTS.adminA, TEST_PASSWORD);
        const res = await api(`/api/solver/preflight?termId=${f.termA}`, { cookie });

        expect(res.status).toBe(200);
        expect(res.body.issues).toEqual([expect.objectContaining({
            constraintId: broken.id,
            constraintName: 'Avoid particular blocks',
            constraintType: 'minimize_block_usage',
            severity: 'SOFT',
            code: 'EMPTY_BLOCK_SELECTION',
        })]);
    });

    it('ignores a DISABLED constraint of the same broken shape', async () => {
        await ownerDb.constraint.create({
            data: {
                tenantId: f.tenantA,
                type: 'minimize_block_usage',
                name: 'Avoid particular blocks (off)',
                severity: 'SOFT',
                weight: 5,
                isEnabled: false,
                params: {},
            },
        });

        const { cookie } = await login(ACCOUNTS.adminA, TEST_PASSWORD);
        const res = await api(`/api/solver/preflight?termId=${f.termA}`, { cookie });

        expect(res.body.issues).toEqual([]);
    });
});

describe('POST /api/solver/runs: pre-flight blocks the run', () => {
    it('returns 422 SOLVER_PRECONDITION_FAILED and creates no solver_run row', async () => {
        await ownerDb.constraint.create({
            data: {
                tenantId: f.tenantA,
                type: 'minimize_block_usage',
                name: 'Avoid particular blocks',
                severity: 'SOFT',
                weight: 5,
                isEnabled: true,
                params: {},
            },
        });

        const before = await ownerDb.solverRun.count({ where: { tenantId: f.tenantA, termId: f.termA } });

        const { cookie } = await login(ACCOUNTS.adminA, TEST_PASSWORD);
        const res = await api('/api/solver/runs', {
            method: 'POST',
            cookie,
            body: JSON.stringify({ termId: f.termA }),
        });

        expect(res.status).toBe(422);
        expect(res.body.data).toMatchObject({ error: 'SOLVER_PRECONDITION_FAILED' });
        expect(res.body.data.issues).toEqual([expect.objectContaining({
            constraintName: 'Avoid particular blocks',
            code: 'EMPTY_BLOCK_SELECTION',
        })]);

        const after = await ownerDb.solverRun.count({ where: { tenantId: f.tenantA, termId: f.termA } });

        expect(after).toBe(before);
    });
});
