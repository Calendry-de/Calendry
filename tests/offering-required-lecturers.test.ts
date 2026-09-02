import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { type Fixtures, ownerDb, seed, teardown } from './helpers/seed';
import { assembleSolverInput } from '../server/utils/solverInput';
import { RESOURCES } from '../server/utils/resources';
import { MANAGE_ENTITIES } from '../app/utils/manageRegistry';

/**
 * `Offering.requiredLecturerCount`: "Who leads it" is a CANDIDATE POOL, not
 * a co-teaching roster.
 *
 * Before this column existed, `assembleSolverInput` sent
 * `requiredLecturerCount: offering.lecturers.length` unconditionally, which
 * makes the wire's own FIXED-assignment case (`candidate_lecturer_ids.len()
 * == required_lecturer_count`) true for every Offering, always: attaching
 * two eligible lecturers forced both onto every generated Session together.
 * See DECISIONS.md § "Lecturer candidate pools: `requiredLecturerCount`
 * decouples eligibility from assignment".
 *
 * NULL is the derived state (every Offering nobody has touched): one
 * lecturer, chosen by the solver from the pool. An explicit value is a
 * deliberate co-teaching requirement.
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

const sentOffering = async () => (await assemble()).input.offerings
    .find((offering) => offering.id === 'test-offering-a')!;

describe('what reaches the wire', () => {
    it('one attached lecturer, unset count: sends the one, requires one', async () => {
        await attachLecturers([f.personA]);

        const offering = await sentOffering();

        expect(offering.candidateLecturerIds).toEqual([f.personA]);
        expect(offering.requiredLecturerCount).toBe(1);
    });

    it('two attached lecturers, unset count: both are candidates, only one is required (the fix)', async () => {
        await attachLecturers([f.personA, f.personViewerA]);

        const offering = await sentOffering();

        expect(offering.candidateLecturerIds).toHaveLength(2);
        expect(offering.requiredLecturerCount).toBe(1);
    });

    it('no attached lecturers, unset count: requires none (unchanged from before this column existed)', async () => {
        const offering = await sentOffering();

        expect(offering.candidateLecturerIds).toEqual([]);
        expect(offering.requiredLecturerCount).toBe(0);
    });

    it('an explicit count is a deliberate co-teaching requirement, sent as-is', async () => {
        await attachLecturers([f.personA, f.personViewerA]);
        await setCount(2);

        const offering = await sentOffering();

        expect(offering.requiredLecturerCount).toBe(2);
    });
});

describe('a demand the pool cannot meet', () => {
    it('clamps the wire value to the pool and reports the mismatch by name', async () => {
        await attachLecturers([f.personA, f.personViewerA]);
        await setCount(3);

        const { report, input } = await assemble();
        const offering = input.offerings.find((o) => o.id === 'test-offering-a')!;

        expect(offering.requiredLecturerCount).toBe(2);
        expect(report.offeringsWithInsufficientLecturers).toHaveLength(1);
        expect(report.offeringsWithInsufficientLecturers[0]).toMatchObject({
            id: 'test-offering-a',
            required: 3,
            available: 2,
        });
    });

    it('is empty when nothing is over-required', async () => {
        await attachLecturers([f.personA]);

        const { report } = await assemble();

        expect(report.offeringsWithInsufficientLecturers).toEqual([]);
    });
});

describe('the write schema', () => {
    /**
     * BOTH SCHEMAS: see `offering-required-rooms.test.ts` for why. `offerings`
     * declares `create` and `update` separately, so a bound present on one and
     * absent on the other is a hole nothing else would report.
     */
    const schemas: [string, { parse: (v: unknown) => unknown }][] = [
        ['create', RESOURCES.offerings!.create!],
        ['update', RESOURCES.offerings!.update!],
    ];

    const body = (schema: string, value: number | null) => (schema === 'create'
        ? { termId: 'a', kindId: 'b', title: 'T', requiredLecturerCount: value }
        : { requiredLecturerCount: value });

    it('accepts any positive count (no solver-structural ceiling to enforce, unlike requiredRoomCount)', () => {
        for (const [name, schema] of schemas) {
            expect(() => schema.parse(body(name, 5)), name).not.toThrow();
        }
    });

    it('refuses zero, which is not "unset" here', () => {
        for (const [name, schema] of schemas) {
            expect(() => schema.parse(body(name, 0)), name).toThrow();
        }
    });

    it('accepts null (the derive-to-one state)', () => {
        for (const [name, schema] of schemas) {
            expect(() => schema.parse(body(name, null)), name).not.toThrow();
        }
    });
});

describe('the form', () => {
    const field = MANAGE_ENTITIES
        .find((entity) => entity.key === 'offerings')!
        .fields.find((f) => f.key === 'requiredLecturerCount');

    it('exists, or the column is unreachable again', () => {
        expect(field).toBeDefined();
    });

    it('names the pool it draws from, not just a bare number', () => {
        expect(field!.help).toContain('Who leads it');
    });
});
