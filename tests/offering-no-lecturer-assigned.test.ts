import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { type Fixtures, ownerDb, seed, teardown } from './helpers/seed';
import { assembleSolverInput } from '../server/utils/solverInput';
import { RESOURCES } from '../server/utils/resources';

/**
 * `offeringsWithNoLecturerAssigned` (issue #130).
 *
 * An empty `offering_lecturer` pool and a genuinely lecturer-free kind
 * (self-directed study) produce the IDENTICAL wire value:
 * `candidateLecturerIds: []`, `requiredLecturerCount: 0`
 * (`requiredLecturerCount ?? Math.min(1, pool.length)`, pool 0 either way).
 * The solver cannot tell "nobody has staffed this yet" from "this kind never
 * needs one" — both read as "requires zero lecturers" — so the distinction has
 * to be drawn here, from `SessionKind.requiresLecturer`, before the wire
 * collapses it.
 *
 * Disjoint from `offeringsWithInsufficientLecturers`
 * (`offering-required-lecturers.test.ts`): that entry fires on an explicit,
 * too-large `requiredLecturerCount`. This one fires ONLY when the count was
 * never set at all, so an explicit `requiredLecturerCount: 0` — a deliberate
 * per-Offering statement, distinct from the kind's default — is silent too.
 */
let f: Fixtures;

beforeAll(async () => {
    f = await seed();
});

afterAll(async () => {
    await teardown();
    await ownerDb.$disconnect();
});

afterEach(async () => {
    await ownerDb.offeringLecturer.deleteMany({ where: { offeringId: 'test-offering-a' } });
    await ownerDb.offering.update({
        where: { id: 'test-offering-a' },
        data: { requiredLecturerCount: null },
    });
    await ownerDb.sessionKind.update({
        where: { id: 'test-kind-a' },
        data: { requiresLecturer: true },
    });
});

const assemble = () => ownerDb.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL calendry.tenant_id = '${f.tenantA}'`);

    return assembleSolverInput(tx as never, { tenantId: f.tenantA, termId: f.termA });
});

const attachLecturers = (personIds: string[]) => ownerDb.offeringLecturer.createMany({
    data: personIds.map((personId) => ({ offeringId: 'test-offering-a', personId, tenantId: f.tenantA })),
});

const setCount = (value: number | null) => ownerDb.offering.update({
    where: { id: 'test-offering-a' },
    data: { requiredLecturerCount: value },
});

const setKindRequiresLecturer = (value: boolean) => ownerDb.sessionKind.update({
    where: { id: 'test-kind-a' },
    data: { requiresLecturer: value },
});

describe('a kind that requires a lecturer (the default)', () => {
    it('reports an offering with no pool and no explicit count', async () => {
        const { report } = await assemble();

        expect(report.offeringsWithNoLecturerAssigned).toEqual([{
            id: 'test-offering-a',
            title: 'Databases',
        }]);
    });

    it('says nothing once a lecturer is attached', async () => {
        await attachLecturers([f.personA]);

        const { report } = await assemble();

        expect(report.offeringsWithNoLecturerAssigned).toEqual([]);
    });

    it('says nothing for an explicit requiredLecturerCount: 0 — a deliberate statement, not a gap', async () => {
        await setCount(0);

        const { report } = await assemble();

        expect(report.offeringsWithNoLecturerAssigned).toEqual([]);
    });

    it('does not double-report alongside offeringsWithInsufficientLecturers', async () => {
        // An explicit, too-large count with an empty pool is a DIFFERENT
        // question ("this demand can't be met") and already has its own entry.
        await setCount(2);

        const { report } = await assemble();

        expect(report.offeringsWithNoLecturerAssigned).toEqual([]);
        expect(report.offeringsWithInsufficientLecturers).toEqual([{
            id: 'test-offering-a',
            title: 'Databases',
            required: 2,
            available: 0,
        }]);
    });
});

describe('a kind that does not require a lecturer (self-directed study)', () => {
    it('says nothing for an empty pool, permanently rather than as a gap', async () => {
        await setKindRequiresLecturer(false);

        const { report } = await assemble();

        expect(report.offeringsWithNoLecturerAssigned).toEqual([]);
    });
});

describe('the write schema', () => {
    const schemas: [string, { parse: (v: unknown) => unknown }][] = [
        ['create', RESOURCES['session-kinds']!.create!],
        ['update', RESOURCES['session-kinds']!.update!],
    ];

    it('accepts requiresLecturer on both schemas, and defaults to nothing stated', () => {
        for (const [name, schema] of schemas) {
            const body = name === 'create'
                ? { key: 'study', name: 'Study', requiresLecturer: false }
                : { requiresLecturer: false };

            expect(() => schema.parse(body), name).not.toThrow();
            expect(() => schema.parse(name === 'create' ? { key: 'study', name: 'Study' } : {}), name)
                .not.toThrow();
        }
    });
});
