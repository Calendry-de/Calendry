import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Fixtures, ownerDb, seed, teardown } from './helpers/seed';
import { assembleSolverInput } from '../server/utils/solverInput';

/**
 * How a BANKED Session (issue #22, cancel-to-spare-bank) reaches
 * `assembleSolverInput`.
 *
 * TWO PROPERTIES, and neither is "the row survives" — that half is covered at
 * the HTTP layer (`tests/session-spare-bank.test.ts`). This is the half only a
 * direct call can see:
 *
 *   1. NOT SENT AS OCCUPANCY. A banked Session has no placement to put on the
 *      wire — sending one would crash `toWireSession` on a null `termWeek`
 *      the proto has no way to represent.
 *
 *   2. STILL COUNTS TOWARD `requiredSessionCount`. Omitting it from
 *      `existingSessions` without correcting the count would tell the solver
 *      the Offering is short by one MORE Session than it actually is — and
 *      the solver would invent a brand-new one to fill a gap banking exists
 *      to hold open, doubling the teaching the moment anyone next solves.
 *
 * `test-offering-a` has `frequency: 2` and exactly one Session
 * (`test-session-a`) in the fixture, so banking it is expected to drop
 * `requiredSessionCount` from 2 to 1 — not to 2 (uncorrected) and not to 0.
 */
let f: Fixtures;

beforeAll(async () => {
    f = await seed();
});

afterAll(async () => {
    await teardown();
    await ownerDb.$disconnect();
});

const assemble = () => ownerDb.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL calendry.tenant_id = '${f.tenantA}'`);

    return assembleSolverInput(tx as never, { tenantId: f.tenantA, termId: f.termA, now: new Date('2026-10-05') });
});

const bank = () => ownerDb.session.update({
    where: { id: f.sessionA },
    data: { termWeek: null, dayOfWeek: null, blockIndex: null },
});

const place = () => ownerDb.session.update({
    where: { id: f.sessionA },
    data: { termWeek: 1, dayOfWeek: 2, blockIndex: 0 },
});

describe('before banking', () => {
    it('sends the Session as occupancy and the frequency uncorrected', async () => {
        const { input } = await assemble();

        expect(input.existingSessions.some((s) => s.id === f.sessionA)).toBe(true);
        expect(input.offerings.find((o) => o.id === 'test-offering-a')?.requiredSessionCount).toBe(2);
    });
});

describe('after banking', () => {
    it('omits it from existingSessions', async () => {
        await bank();

        const { input } = await assemble();

        expect(input.existingSessions.some((s) => s.id === f.sessionA)).toBe(false);

        await place();
    });

    it('reduces requiredSessionCount by exactly the banked count, never below zero', async () => {
        await bank();

        const { input } = await assemble();

        expect(input.offerings.find((o) => o.id === 'test-offering-a')?.requiredSessionCount).toBe(1);

        await place();
    });

    it('restores the uncorrected count once placed again', async () => {
        await bank();
        await place();

        const { input } = await assemble();

        expect(input.offerings.find((o) => o.id === 'test-offering-a')?.requiredSessionCount).toBe(2);
        expect(input.existingSessions.some((s) => s.id === f.sessionA)).toBe(true);
    });
});
