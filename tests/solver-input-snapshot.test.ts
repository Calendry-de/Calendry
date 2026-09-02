import { gunzipSync, gzipSync } from 'node:zlib';
import { SolverInput } from '@calendry-de/calendry-proto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, login } from './helpers/client';
import { ACCOUNTS, type Fixtures, TEST_PASSWORD, ownerDb, seed, teardown } from './helpers/seed';
import { assembleSolverInput, encodeInput } from '../server/utils/solverInput';

/**
 * SolverInputSnapshot (issue #24): the full `SolverInput` a run sent, not
 * just its hash. Exercised at the data layer (round-trip through gzip +
 * RLS) and through the real `GET /api/solver/runs/[id]/snapshot` route
 * (permission gate, 404 shapes), never through a real `POST /api/solver/runs`,
 * which would need a live solver run to complete.
 */
let f: Fixtures;

beforeAll(async () => {
    f = await seed();
}, 60_000);

afterAll(async () => {
    await teardown();
    await ownerDb.$disconnect();
});

const assemble = () => ownerDb.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL calendry.tenant_id = '${f.tenantA}'`);

    return assembleSolverInput(tx as never, { tenantId: f.tenantA, termId: f.termA });
});

describe('storing and reading a snapshot', () => {
    it('round-trips the exact input through gzip', async () => {
        const { input, inputHash } = await assemble();

        // Terminal status: a run left PENDING/QUEUED/RUNNING would collide
        // with `solver_run_one_active_per_term` the moment another test in
        // this file creates a run for the same term.
        const run = await ownerDb.solverRun.create({
            data: { tenantId: f.tenantA, termId: f.termA, status: 'SUCCEEDED', inputHash },
        });

        const snapshot = await ownerDb.solverInputSnapshot.create({
            data: {
                tenantId: f.tenantA,
                solverRunId: run.id,
                compressedInput: gzipSync(encodeInput(input)),
            },
        });

        const decoded = SolverInput.decode(gunzipSync(snapshot.compressedInput));

        expect(SolverInput.encode(decoded).finish()).toEqual(SolverInput.encode(input).finish());

        await ownerDb.solverRun.delete({ where: { id: run.id } });
    });

    it('is deleted when its SolverRun is (cascade)', async () => {
        const { input, inputHash } = await assemble();

        const run = await ownerDb.solverRun.create({
            data: { tenantId: f.tenantA, termId: f.termA, status: 'SUCCEEDED', inputHash },
        });

        await ownerDb.solverInputSnapshot.create({
            data: { tenantId: f.tenantA, solverRunId: run.id, compressedInput: gzipSync(encodeInput(input)) },
        });

        await ownerDb.solverRun.delete({ where: { id: run.id } });

        expect(await ownerDb.solverInputSnapshot.findUnique({ where: { solverRunId: run.id } })).toBeNull();
    });
});

describe('GET /api/solver/runs/[id]/snapshot', () => {
    it('returns the decoded input for a holder of solver.snapshot.read', async () => {
        const { input, inputHash } = await assemble();

        const run = await ownerDb.solverRun.create({
            data: { tenantId: f.tenantA, termId: f.termA, status: 'SUCCEEDED', inputHash },
        });

        await ownerDb.solverInputSnapshot.create({
            data: { tenantId: f.tenantA, solverRunId: run.id, compressedInput: gzipSync(encodeInput(input)) },
        });

        const { cookie } = await login(ACCOUNTS.adminA, TEST_PASSWORD);
        const res = await api(`/api/solver/runs/${run.id}/snapshot`, { cookie });

        expect(res.status).toBe(200);
        expect(res.body.runId).toBe(run.id);
        // `toJSON` round-trips through the wire encoding, which is the fact
        // this endpoint exists to prove, not a structural-equality accident.
        expect(SolverInput.encode(SolverInput.fromJSON(res.body.input)).finish())
            .toEqual(SolverInput.encode(input).finish());

        await ownerDb.solverRun.delete({ where: { id: run.id } });
    });

    it('refuses a holder without solver.snapshot.read', async () => {
        const run = await ownerDb.solverRun.create({
            data: { tenantId: f.tenantA, termId: f.termA, status: 'SUCCEEDED', inputHash: 'x' },
        });

        const { cookie } = await login(ACCOUNTS.viewerA, TEST_PASSWORD);
        const res = await api(`/api/solver/runs/${run.id}/snapshot`, { cookie });

        expect(res.status).toBe(403);

        await ownerDb.solverRun.delete({ where: { id: run.id } });
    });

    it('404s for tenant B fetching tenant A\'s run, not 403 or 200', async () => {
        const run = await ownerDb.solverRun.create({
            data: { tenantId: f.tenantA, termId: f.termA, status: 'SUCCEEDED', inputHash: 'x' },
        });

        await ownerDb.solverInputSnapshot.create({
            data: { tenantId: f.tenantA, solverRunId: run.id, compressedInput: gzipSync(Buffer.from('x')) },
        });

        const { cookie } = await login(ACCOUNTS.adminB, TEST_PASSWORD);
        const res = await api(`/api/solver/runs/${run.id}/snapshot`, { cookie });

        // Through the real app-role connection, not `ownerDb` (a superuser,
        // which bypasses RLS regardless of FORCE and so cannot exercise it):
        // the route's own `tenantId` filter on `solverRun.findFirst` is the
        // thing under test here, RLS is the second layer behind it.
        expect(res.status).toBe(404);

        await ownerDb.solverRun.delete({ where: { id: run.id } });
    });

    it('404s for an unknown run', async () => {
        const { cookie } = await login(ACCOUNTS.adminA, TEST_PASSWORD);
        const res = await api('/api/solver/runs/not-a-real-id/snapshot', { cookie });

        expect(res.status).toBe(404);
    });

    it('404s distinctly for a real run with no stored snapshot', async () => {
        const run = await ownerDb.solverRun.create({
            data: { tenantId: f.tenantA, termId: f.termA, status: 'SUCCEEDED', inputHash: 'x' },
        });

        const { cookie } = await login(ACCOUNTS.adminA, TEST_PASSWORD);
        const res = await api(`/api/solver/runs/${run.id}/snapshot`, { cookie });

        expect(res.status).toBe(404);
        expect(res.body.message).toMatch(/no snapshot/i);

        await ownerDb.solverRun.delete({ where: { id: run.id } });
    });
});
