import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Fixtures, ownerDb, seed, teardown } from './helpers/seed';
import { RESOURCES } from '../server/utils/resources';
import { MANAGE_ENTITIES } from '../app/utils/manageRegistry';

/**
 * `Group.curriculumPlanId`: the plan a Group INTENDS to follow, set before
 * it has a single Offering to prove it.
 *
 * NOT the same question as `deriveGroupPlanApplications()` (which plan a
 * Group is CURRENTLY on, derived from `Offering.createdFromTemplateId` on
 * Offerings it already has): this field exists so
 * `ManageOfferingPlanBulkApply` can pre-select a Group before that history
 * exists at all. The two are independent: setting this field creates no
 * Offering and attaches nothing.
 */
let f: Fixtures;
let planId: string;

beforeAll(async () => {
    f = await seed();

    const plan = await ownerDb.offeringPlan.create({
        data: { tenantId: f.tenantA, name: 'Test curriculum plan' },
    });

    planId = plan.id;
});

afterAll(async () => {
    await teardown();
    await ownerDb.$disconnect();
});

describe('what it is', () => {
    it('is a plain intent, settable with no Offering ever created', async () => {
        await ownerDb.group.update({
            where: { id: f.groupSeminarA },
            data: { curriculumPlanId: planId },
        });

        const group = await ownerDb.group.findUniqueOrThrow({ where: { id: f.groupSeminarA } });

        expect(group.curriculumPlanId).toBe(planId);

        const offeringCount = await ownerDb.offering.count({
            where: { groups: { some: { groupId: f.groupSeminarA } } },
        });

        expect(offeringCount).toBe(0);
    });

    it('clears to NULL when the plan is deleted, never blocks the delete', async () => {
        const throwaway = await ownerDb.offeringPlan.create({
            data: { tenantId: f.tenantA, name: 'Throwaway plan' },
        });

        await ownerDb.group.update({
            where: { id: f.groupSeminarA },
            data: { curriculumPlanId: throwaway.id },
        });

        await ownerDb.offeringPlan.delete({ where: { id: throwaway.id } });

        const group = await ownerDb.group.findUniqueOrThrow({ where: { id: f.groupSeminarA } });

        expect(group.curriculumPlanId).toBeNull();

        // Restore for the tests below.
        await ownerDb.group.update({
            where: { id: f.groupSeminarA },
            data: { curriculumPlanId: planId },
        });
    });
});

describe('the write schema', () => {
    const schemas: [string, { parse: (v: unknown) => unknown }][] = [
        ['create', RESOURCES.groups!.create!],
        ['update', RESOURCES.groups!.update!],
    ];

    const body = (schema: string, value: string | null) => (schema === 'create'
        ? { name: 'A group', curriculumPlanId: value }
        : { curriculumPlanId: value });

    it('accepts an id', () => {
        for (const [name, schema] of schemas) {
            expect(() => schema.parse(body(name, 'some-plan-id')), name).not.toThrow();
        }
    });

    it('accepts null (no intended plan, the common case)', () => {
        for (const [name, schema] of schemas) {
            expect(() => schema.parse(body(name, null)), name).not.toThrow();
        }
    });
});

describe('the form', () => {
    const field = MANAGE_ENTITIES
        .find((entity) => entity.key === 'groups')!
        .fields.find((f) => f.key === 'curriculumPlanId');

    it('exists, or the column is unreachable again', () => {
        expect(field).toBeDefined();
    });

    it('points at offering-plans, not at groups or offering-templates', () => {
        expect(field!.reference?.resource).toBe('offering-plans');
    });

    it('says plainly that this is not the same as an applied plan', () => {
        expect(field!.help?.toLowerCase()).toContain('not the same as');
    });
});
