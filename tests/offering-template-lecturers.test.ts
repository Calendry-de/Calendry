import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { type Fixtures, ownerDb, seed, teardown } from './helpers/seed';
import { applyOfferingPlanItems } from '../server/utils/offeringPlans';
import { RESOURCES } from '../server/utils/resources';
import { RELATIONS } from '../server/utils/relations';

/**
 * `OfferingTemplate` can name a lecturer (issue #129).
 *
 * `required_role_id` stayed a Role reference so a template never hardcoded an
 * individual — but nothing downstream ever read it, so a template built from
 * issue #8's own example, "Maths, 4x/week, Mr Schmidt", captured everything
 * except Mr Schmidt: applying a plan created Offerings with an empty
 * lecturer pool every time (issue #130). `OfferingTemplateLecturer` is the
 * template's own half of `OfferingLecturer`, copied onto the created
 * Offering at apply time.
 *
 * THE PROPERTY THAT MATTERS MOST: copied, not linked. `applyOfferingPlanItems`
 * seeds the Offering's roster from the template's rows as they stood AT THAT
 * MOMENT; editing the template afterwards must not reach back and restaff an
 * Offering already created from it — the same "stored shape, not a live
 * link" contract every other template column keeps (issue #8).
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
    await ownerDb.offeringTemplate.deleteMany({ where: { tenantId: f.tenantA } });
});

const createTemplate = (overrides: Record<string, unknown> = {}) => ownerDb.offeringTemplate.create({
    data: {
        tenantId: f.tenantA,
        name: 'Maths (4x/week)',
        title: 'Maths',
        kindId: 'test-kind-a',
        frequency: 4,
        durationBlocks: 1,
        ...overrides,
    },
    include: { lecturers: true },
});

const apply = (templateId: string, template: Awaited<ReturnType<typeof createTemplate>>, groupId: string) => ownerDb.$transaction(
    (tx) => applyOfferingPlanItems(tx, {
        tenantId: f.tenantA,
        termId: f.termA,
        groupId,
        items: [{ templateId, template }],
    }),
);

describe('a template with a named lecturer', () => {
    it('seeds the created Offering with the same Person and scheduling role', async () => {
        const template = await createTemplate();

        await ownerDb.offeringTemplateLecturer.create({
            data: { tenantId: f.tenantA, templateId: template.id, personId: f.personA, roleId: null },
        });

        const withLecturer = await ownerDb.offeringTemplate.findUniqueOrThrow({
            where: { id: template.id },
            include: { lecturers: true },
        });

        const [{ id: offeringId }] = await apply(template.id, withLecturer, f.groupCohortA);

        const lecturers = await ownerDb.offeringLecturer.findMany({ where: { offeringId } });

        expect(lecturers).toEqual([expect.objectContaining({ personId: f.personA, roleId: null })]);
    });

    it('carries the scheduling role recorded on the template row', async () => {
        const template = await createTemplate();

        await ownerDb.role.create({
            data: { id: 'test-role-lecturer-129', tenantId: f.tenantA, key: 'lecturer-129', name: 'Lecturer' },
        }).catch(() => {}); // Idempotent across repeated runs of this suite.

        await ownerDb.offeringTemplateLecturer.create({
            data: { tenantId: f.tenantA, templateId: template.id, personId: f.personA, roleId: 'test-role-lecturer-129' },
        });

        const withLecturer = await ownerDb.offeringTemplate.findUniqueOrThrow({
            where: { id: template.id },
            include: { lecturers: true },
        });

        const [{ id: offeringId }] = await apply(template.id, withLecturer, f.groupCohortA);

        const [lecturer] = await ownerDb.offeringLecturer.findMany({ where: { offeringId } });

        expect(lecturer).toMatchObject({ personId: f.personA, roleId: 'test-role-lecturer-129' });

        await ownerDb.role.delete({ where: { id: 'test-role-lecturer-129' } });
    });
});

describe('a template naming nobody', () => {
    it('still creates the Offering, with an empty pool — this is the case issue #130 makes visible, not this one', async () => {
        const template = await createTemplate();

        const [{ id: offeringId }] = await apply(template.id, template, f.groupCohortA);

        const lecturers = await ownerDb.offeringLecturer.findMany({ where: { offeringId } });

        expect(lecturers).toEqual([]);
    });
});

describe('requiredLecturerCount', () => {
    it('is copied onto the created Offering, same NULL-means-unset convention', async () => {
        const template = await createTemplate({ requiredLecturerCount: 2 });

        const [{ id: offeringId }] = await apply(template.id, template, f.groupCohortA);

        const offering = await ownerDb.offering.findUniqueOrThrow({ where: { id: offeringId } });

        expect(offering.requiredLecturerCount).toBe(2);
    });

    it('stays NULL when the template does not fix it', async () => {
        const template = await createTemplate();

        const [{ id: offeringId }] = await apply(template.id, template, f.groupCohortA);

        const offering = await ownerDb.offering.findUniqueOrThrow({ where: { id: offeringId } });

        expect(offering.requiredLecturerCount).toBeNull();
    });
});

describe('copied, not linked', () => {
    it('editing the template roster after apply does not restaff the Offering already created', async () => {
        const template = await createTemplate();

        await ownerDb.offeringTemplateLecturer.create({
            data: { tenantId: f.tenantA, templateId: template.id, personId: f.personA, roleId: null },
        });

        const withLecturer = await ownerDb.offeringTemplate.findUniqueOrThrow({
            where: { id: template.id },
            include: { lecturers: true },
        });

        const [{ id: offeringId }] = await apply(template.id, withLecturer, f.groupCohortA);

        // The template's roster changes AFTER the Offering exists.
        await ownerDb.offeringTemplateLecturer.deleteMany({ where: { templateId: template.id } });
        await ownerDb.offeringTemplateLecturer.create({
            data: { tenantId: f.tenantA, templateId: template.id, personId: f.personViewerA, roleId: null },
        });

        const lecturers = await ownerDb.offeringLecturer.findMany({ where: { offeringId } });

        // Still personA: the Offering was seeded once, at apply time.
        expect(lecturers).toEqual([expect.objectContaining({ personId: f.personA })]);
    });

    it('a SECOND group joining the same Offering does not re-seed or duplicate lecturers', async () => {
        const template = await createTemplate();

        await ownerDb.offeringTemplateLecturer.create({
            data: { tenantId: f.tenantA, templateId: template.id, personId: f.personA, roleId: null },
        });

        const withLecturer = await ownerDb.offeringTemplate.findUniqueOrThrow({
            where: { id: template.id },
            include: { lecturers: true },
        });

        const [first] = await apply(template.id, withLecturer, f.groupCohortA);
        const [second] = await apply(template.id, withLecturer, f.groupSeminarA);

        expect(second.id).toBe(first.id);
        expect(second.action).toBe('attached');

        const lecturers = await ownerDb.offeringLecturer.findMany({ where: { offeringId: first.id } });

        expect(lecturers).toHaveLength(1);
    });
});

describe('the relation and write surface', () => {
    it('exposes offering-templates/lecturers with the same item shape as offerings/lecturers', () => {
        expect(RELATIONS['offering-templates/lecturers']).toMatchObject({
            parent: 'offering-templates',
            parentModel: 'offeringTemplate',
            model: 'offeringTemplateLecturer',
            parentKey: 'templateId',
        });
    });

    it('accepts requiredLecturerCount on both offering-template write schemas', () => {
        const schemas: [string, { parse: (v: unknown) => unknown }][] = [
            ['create', RESOURCES['offering-templates']!.create!],
            ['update', RESOURCES['offering-templates']!.update!],
        ];

        for (const [name, schema] of schemas) {
            const body = name === 'create'
                ? { name: 'T', requiredLecturerCount: 2 }
                : { requiredLecturerCount: 2 };

            expect(() => schema.parse(body), name).not.toThrow();
        }
    });
});
