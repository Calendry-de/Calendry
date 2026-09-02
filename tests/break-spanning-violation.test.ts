import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Fixtures, ownerDb, seed, teardown } from './helpers/seed';
import { refreshViolations } from '../server/utils/violations';

/**
 * "Report a break-spanning Session as a violation": issue #27.
 *
 * A PER-SESSION CHECK, not a pairwise one, the first of its kind in this
 * evaluator. `no_session_spanning_break` needs no counterpart Session, only
 * the TimeGrid its own placement sits in, which is why it lives in
 * `PER_SESSION_CONSTRAINT_TYPES` rather than the pairwise structural list
 * `describeCollision` dispatches.
 *
 * NEEDS NO SOLVER, NO WIRE FIELD. `gapsWithinSpan` is a pure function of
 * placement + grid data the app already has, so this is buildable regardless
 * of #26 (the solver LEARNING to avoid this shape), which is still blocked on
 * the wire carrying break structure at all. This card only makes an EXISTING,
 * already-drawn fact queryable.
 */
let f: Fixtures;

beforeAll(async () => {
    f = await seed();

    // A named break after block 1, so a 2-block Session starting at block 1
    // spans it and one starting at block 3 does not.
    await ownerDb.timeGridBreak.create({
        data: {
            tenantId: f.tenantA, timeGridId: 'test-grid-a',
            afterBlockIndex: 1, durationMinutes: 15, label: 'Pause',
        },
    });

    // Enabled by default for a freshly-provisioned tenant, but this fixture
    // hand-seeds rather than provisions, so the row is created explicitly,
    // matching how other test files in this suite already do for constraints
    // the seed itself does not configure.
    await ownerDb.constraint.create({
        data: {
            tenantId: f.tenantA, type: 'no_session_spanning_break', name: 'Break-spanning sessions',
            severity: 'SOFT', weight: 5, isDefault: true, isEnabled: true,
        },
    });
});

afterAll(async () => {
    await teardown();
    await ownerDb.$disconnect();
});

const asOwner = <T>(fn: (tx: typeof ownerDb) => Promise<T>) => ownerDb.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL calendry.tenant_id = '${f.tenantA}'`);

    return fn(tx as never);
});

describe('a session spanning a named break', () => {
    it('is reported, with the gap named', async () => {
        const session = await ownerDb.session.create({
            data: {
                tenantId: f.tenantA, termId: 'test-term-a', kindId: 'test-kind-a',
                timeGridId: 'test-grid-a', termWeek: 1, dayOfWeek: 1, blockIndex: 1,
                durationBlocks: 2, generationId: 'test-generation-a',
            },
        });

        await asOwner((tx) => refreshViolations(tx, {
            tenantId: f.tenantA, sessionIds: [session.id],
        }));

        const violations = await ownerDb.constraintViolation.findMany({
            where: { tenantId: f.tenantA, sessionId: session.id },
        });

        expect(violations).toHaveLength(1);
        expect(violations[0]?.severity).toBe('SOFT');
        // Penalty IS the weight for a SOFT violation, the same mechanism a
        // solver-priced soft rule uses, even though nothing here is solver-priced.
        expect(violations[0]?.penalty).toBe(5);

        const detail = violations[0]?.detail as { reason: string; gaps: { afterBlockIndex: number }[] };

        expect(detail.reason).toBe('session_spans_break');
        expect(detail.gaps.map((g) => g.afterBlockIndex)).toEqual([1]);
    });
});

describe('a session that does not span the break', () => {
    it('is not reported', async () => {
        const session = await ownerDb.session.create({
            data: {
                tenantId: f.tenantA, termId: 'test-term-a', kindId: 'test-kind-a',
                timeGridId: 'test-grid-a', termWeek: 1, dayOfWeek: 1, blockIndex: 3,
                durationBlocks: 2, generationId: 'test-generation-a',
            },
        });

        await asOwner((tx) => refreshViolations(tx, {
            tenantId: f.tenantA, sessionIds: [session.id],
        }));

        const violations = await ownerDb.constraintViolation.findMany({
            where: { tenantId: f.tenantA, sessionId: session.id },
        });

        expect(violations).toHaveLength(0);
    });
});

describe('a single-block session', () => {
    it('can never span a break, so is never checked against one', async () => {
        const session = await ownerDb.session.create({
            data: {
                tenantId: f.tenantA, termId: 'test-term-a', kindId: 'test-kind-a',
                timeGridId: 'test-grid-a', termWeek: 1, dayOfWeek: 1, blockIndex: 1,
                durationBlocks: 1, generationId: 'test-generation-a',
            },
        });

        await asOwner((tx) => refreshViolations(tx, {
            tenantId: f.tenantA, sessionIds: [session.id],
        }));

        expect(await ownerDb.constraintViolation.count({
            where: { tenantId: f.tenantA, sessionId: session.id },
        })).toBe(0);
    });
});

describe('disabling the rule', () => {
    it('clears any previously-recorded violation', async () => {
        const session = await ownerDb.session.create({
            data: {
                tenantId: f.tenantA, termId: 'test-term-a', kindId: 'test-kind-a',
                timeGridId: 'test-grid-a', termWeek: 2, dayOfWeek: 1, blockIndex: 1,
                durationBlocks: 2, generationId: 'test-generation-a',
            },
        });

        await asOwner((tx) => refreshViolations(tx, {
            tenantId: f.tenantA, sessionIds: [session.id],
        }));
        expect(await ownerDb.constraintViolation.count({ where: { sessionId: session.id } })).toBe(1);

        await ownerDb.constraint.updateMany({
            where: { tenantId: f.tenantA, type: 'no_session_spanning_break' },
            data: { isEnabled: false },
        });

        await asOwner((tx) => refreshViolations(tx, {
            tenantId: f.tenantA, sessionIds: [session.id],
        }));

        expect(await ownerDb.constraintViolation.count({ where: { sessionId: session.id } })).toBe(0);

        await ownerDb.constraint.updateMany({
            where: { tenantId: f.tenantA, type: 'no_session_spanning_break' },
            data: { isEnabled: true },
        });
    });
});

describe('the catalogue', () => {
    it('provisions this row enabled by default, matching the pairwise structural rows', async () => {
        const { defaultConstraintRow, findConstraintType } = await import('../shared/constraintTypes');
        const type = findConstraintType('no_session_spanning_break')!;

        expect(defaultConstraintRow(type).isEnabled).toBe(true);
    });

    it('has no wire field: this is the reporting half only, #26 is unbuilt', async () => {
        const { findConstraintType } = await import('../shared/constraintTypes');

        expect(findConstraintType('no_session_spanning_break')?.wireField).toBeUndefined();
    });
});
