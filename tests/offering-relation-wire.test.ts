import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Fixtures, ownerDb, seed, teardown } from './helpers/seed';
import { assembleSolverInput } from '../server/utils/solverInput';

/**
 * `SolverInput.offeringRelations`: the wire half of `different_time` (#53),
 * built from `ConstraintRelationMember` rather than `toWireConstraint` (see
 * that function's relation carve-out and `wireRelationVariant`).
 */
let f: Fixtures;
let offeringB: string;

beforeAll(async () => {
    f = await seed();

    offeringB = (await ownerDb.offering.create({
        data: {
            tenantId: f.tenantA, termId: 'test-term-a', kindId: 'test-kind-a',
            title: 'Networks', frequency: 1,
        },
    })).id;
});

afterAll(async () => {
    await teardown();
    await ownerDb.$disconnect();
});

const assemble = () => ownerDb.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL calendry.tenant_id = '${f.tenantA}'`);

    return assembleSolverInput(tx as never, { tenantId: f.tenantA, termId: f.termA });
});

describe('an enabled different_time relation', () => {
    it('sends the ordered offering ids and the differentTime variant', async () => {
        const constraint = await ownerDb.constraint.create({
            data: {
                tenantId: f.tenantA, type: 'different_time', name: 'No overlap',
                severity: 'HARD', weight: null, isEnabled: true,
            },
        });

        await ownerDb.constraintRelationMember.createMany({
            data: [
                { tenantId: f.tenantA, constraintId: constraint.id, offeringId: offeringB, position: 0 },
                { tenantId: f.tenantA, constraintId: constraint.id, offeringId: 'test-offering-a', position: 1 },
            ],
        });

        const { input } = await assemble();
        const relation = input.offeringRelations.find((r) => r.id === constraint.id);

        expect(relation).toBeDefined();
        // Position order, not creation order: offeringB was added at
        // position 0 despite being created second.
        expect(relation!.offeringIds).toEqual([offeringB, 'test-offering-a']);
        expect(relation!.differentTime).toEqual({});
        expect(relation!.enabled).toBe(true);

        await ownerDb.constraint.delete({ where: { id: constraint.id } });
    });

    it('never reaches ConstraintConfig, so no skip is reported for it', async () => {
        const constraint = await ownerDb.constraint.create({
            data: {
                tenantId: f.tenantA, type: 'different_time', name: 'No overlap',
                severity: 'HARD', weight: null, isEnabled: true,
            },
        });

        await ownerDb.constraintRelationMember.createMany({
            data: [
                { tenantId: f.tenantA, constraintId: constraint.id, offeringId: offeringB, position: 0 },
                { tenantId: f.tenantA, constraintId: constraint.id, offeringId: 'test-offering-a', position: 1 },
            ],
        });

        const { report } = await assemble();

        expect(report.skippedConstraints.find((s) => s.id === constraint.id)).toBeUndefined();

        await ownerDb.constraint.delete({ where: { id: constraint.id } });
    });
});

describe('the solver-evaluated relation kinds (issues #54, #37)', () => {
    const relate = async (type: string, params: Record<string, unknown> = {}) => {
        const constraint = await ownerDb.constraint.create({
            data: { tenantId: f.tenantA, type, name: type, severity: 'HARD', weight: null, isEnabled: true, params },
        });

        await ownerDb.constraintRelationMember.createMany({
            data: [
                { tenantId: f.tenantA, constraintId: constraint.id, offeringId: 'test-offering-a', position: 0 },
                { tenantId: f.tenantA, constraintId: constraint.id, offeringId: offeringB, position: 1 },
            ],
        });

        const { input, report } = await assemble();
        const relation = input.offeringRelations.find((r) => r.id === constraint.id);

        await ownerDb.constraint.delete({ where: { id: constraint.id } });

        return { relation, report, id: constraint.id };
    };

    it.each([
        ['same_time', 'sameTime'],
        ['same_days', 'sameDays'],
        ['same_start', 'sameStart'],
    ] as const)('sends %s as an empty %s variant with the ordered members', async (type, field) => {
        const { relation, report, id } = await relate(type);

        expect(relation, type).toBeDefined();
        expect(relation![field]).toEqual({});
        expect(relation!.offeringIds).toEqual(['test-offering-a', offeringB]);
        expect(report.skippedConstraints.find((s) => s.id === id)).toBeUndefined();
    });

    it('sends precedence with its two parameters, members in the stated order', async () => {
        const { relation } = await relate('precedence', { minGapMinutes: 1440, maxDaysBetween: 7 });

        expect(relation!.precedence).toEqual({ minGapMinutes: 1440, maxDaysBetween: 7 });
        // The ONLY kind that reads member order: predecessor first.
        expect(relation!.offeringIds).toEqual(['test-offering-a', offeringB]);
    });

    it('sends precedence with the proto zeros when a row predates the parameters', async () => {
        const { relation } = await relate('precedence', {});

        expect(relation!.precedence).toEqual({ minGapMinutes: 0, maxDaysBetween: 0 });
    });
});

describe('a disabled different_time relation', () => {
    it('is not sent at all', async () => {
        const constraint = await ownerDb.constraint.create({
            data: {
                tenantId: f.tenantA, type: 'different_time', name: 'No overlap',
                severity: 'HARD', weight: null, isEnabled: false,
            },
        });

        await ownerDb.constraintRelationMember.createMany({
            data: [
                { tenantId: f.tenantA, constraintId: constraint.id, offeringId: offeringB, position: 0 },
                { tenantId: f.tenantA, constraintId: constraint.id, offeringId: 'test-offering-a', position: 1 },
            ],
        });

        const { input } = await assemble();

        expect(input.offeringRelations.find((r) => r.id === constraint.id)).toBeUndefined();

        await ownerDb.constraint.delete({ where: { id: constraint.id } });
    });
});

describe('a relation naming an offering outside this Term\'s snapshot', () => {
    /*
     * NOT A DELETED OFFERING: `ConstraintRelationMember.offeringId` cascades
     * on the Offering's own deletion, so a truly FK-dangling row can never
     * persist. The real case `realOfferingIds` (built from `offeringRows`,
     * which filters to `termId` + `isActive`) guards against is an Offering
     * that still exists but fell out of THIS solve's snapshot: deactivated
     * after being added to the relation, same as any other Offering a solve
     * silently stops sending.
     */
    it('is omitted WHOLE, not narrowed to its remaining member, and is reported', async () => {
        const deactivated = await ownerDb.offering.create({
            data: {
                tenantId: f.tenantA, termId: 'test-term-a', kindId: 'test-kind-a',
                title: 'Deactivated', frequency: 1, isActive: false,
            },
        });

        const constraint = await ownerDb.constraint.create({
            data: {
                tenantId: f.tenantA, type: 'different_time', name: 'Dangling',
                severity: 'HARD', weight: null, isEnabled: true,
            },
        });

        await ownerDb.constraintRelationMember.createMany({
            data: [
                { tenantId: f.tenantA, constraintId: constraint.id, offeringId: 'test-offering-a', position: 0 },
                { tenantId: f.tenantA, constraintId: constraint.id, offeringId: deactivated.id, position: 1 },
            ],
        });

        const { input, report } = await assemble();

        expect(input.offeringRelations.find((r) => r.id === constraint.id)).toBeUndefined();
        expect(report.relationsWithDanglingMembers).toEqual([
            { id: constraint.id, type: 'different_time', danglingOfferingIds: [deactivated.id] },
        ]);

        await ownerDb.constraint.delete({ where: { id: constraint.id } });
        await ownerDb.offering.delete({ where: { id: deactivated.id } });
    });
});
