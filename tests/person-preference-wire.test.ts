import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Fixtures, ownerDb, seed, teardown } from './helpers/seed';
import { assembleSolverInput } from '../server/utils/solverInput';
import { statedPreferencesFor } from '../server/utils/availability';

/**
 * Stated preferences reach the wire, narrowed to the Term's grid, and the report
 * says whether the rule has anything to work with.
 *
 * Two properties are load-bearing and neither is obvious from reading the code:
 *
 *  - A NULL `weight_multiplier` must arrive as ABSENT, never 0. The column's NULL
 *    means "use the tenant default"; proto3's zero is itself a meaningful
 *    multiplier ("ignore this person entirely"), which is why the wire field is
 *    `optional`. A test asserting only "no multiplier set" would pass against a
 *    build sending 0.
 *  - An enabled rule can be entirely INERT — no counted lecturer, or none with a
 *    stated preference — and contribute exactly zero to every placement. That is
 *    the `lecturer_veto` shape: a HARD rule enabled by default and fed an empty
 *    list, which looked healthy and could never fire. It went unnoticed there
 *    because nothing counted it.
 *
 * Written to fail against the wrong implementation: the narrowing assertions fail
 * if the grid filter is removed, and the inert count is asserted in BOTH
 * directions so a hardcoded value cannot satisfy it.
 */
let f: Fixtures;

const LECTURER_ROLE = 'test-role-lecturer-pref';
const OFFERING_WITH_LECTURER = 'test-offering-pref-lecturer';

/** Grid is `activeDays: [1..5]`, `blocksPerDay: 8` — so 6 and 9 are outside it. */
const OUT_OF_GRID_DAY = 6;
const OUT_OF_GRID_BLOCK = 9;

beforeAll(async () => {
    f = await seed();

    await ownerDb.role.create({
        data: { id: LECTURER_ROLE, tenantId: f.tenantA, key: 'lecturer', name: 'Lecturer' },
    });
    await ownerDb.personRole.create({
        data: { tenantId: f.tenantA, personId: f.personA, roleId: LECTURER_ROLE },
    });

    // A second offering, so one has a lecturer with a preference and the seed's
    // own lecturer-less offering stays as the inert case.
    await ownerDb.offering.create({
        data: {
            id: OFFERING_WITH_LECTURER, tenantId: f.tenantA,
            termId: f.termA, kindId: 'test-kind-a',
            title: 'Compilers', frequency: 3,
        },
    });
    await ownerDb.offeringLecturer.create({
        data: { tenantId: f.tenantA, offeringId: OFFERING_WITH_LECTURER, personId: f.personA },
    });

    await ownerDb.personPreference.createMany({
        data: [
            {
                // Two legal values and two the Term's grid has no room for.
                tenantId: f.tenantA, personId: f.personA,
                preferredDays: [2, OUT_OF_GRID_DAY],
                preferredBlocks: [0, OUT_OF_GRID_BLOCK],
                weightMultiplier: null,
            },
            {
                // A real override, and nothing that needs narrowing.
                tenantId: f.tenantA, personId: f.personViewerA,
                preferredDays: [3], preferredBlocks: [], weightMultiplier: 1.5,
            },
        ],
    });
});

afterAll(async () => {
    await teardown();
    await ownerDb.$disconnect();
});

const assemble = () => ownerDb.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL calendry.tenant_id = '${f.tenantA}'`);

    return assembleSolverInput(tx as never, { tenantId: f.tenantA, termId: f.termA });
});

describe('the single read path', () => {
    it('returns stated rows and omits people with none', async () => {
        const byPerson = await ownerDb.$transaction(async (tx) => {
            await tx.$executeRawUnsafe(`SET LOCAL calendry.tenant_id = '${f.tenantA}'`);

            return statedPreferencesFor(tx as never, [f.personA, f.personMultiA]);
        });

        expect(byPerson.get(f.personA)?.days).toEqual([2, OUT_OF_GRID_DAY]);
        // Callers use `?? undefined`; "no row" must be a missing key rather than a
        // key holding null, which would survive `?.` and blow up a later `.map`.
        expect(byPerson.get(f.personMultiA)).toBeUndefined();
    });
});

describe('narrowing to the Term grid', () => {
    it('drops values the grid has no day or block for, and counts them', async () => {
        const out = await assemble();
        const person = out.input.persons.find((row) => row.id === f.personA);

        expect(person, 'the person must be in the snapshot at all').toBeDefined();
        // With the grid filter removed these carry 6 and 9 — that is the failure
        // this asserts, not merely the presence of 2 and 0.
        expect(person!.preferred?.days).toEqual([2]);
        expect(person!.preferred?.blocks).toEqual([0]);
        expect(out.report.preferences.droppedOutOfGridValues).toBe(2);
    });

    it('sends nothing at all when every stated value is outside the grid', async () => {
        await ownerDb.personPreference.update({
            where: { personId: f.personViewerA },
            data: { preferredDays: [OUT_OF_GRID_DAY], preferredBlocks: [OUT_OF_GRID_BLOCK] },
        });

        const out = await assemble();
        const person = out.input.persons.find((row) => row.id === f.personViewerA);

        // ABSENT, not an empty `Preference`. After narrowing this means the same
        // thing as no row, and that fact gets one representation.
        expect(person!.preferred).toBeUndefined();
        // Still counted: nothing was sent, but something was dropped.
        expect(out.report.preferences.droppedOutOfGridValues).toBe(4);

        await ownerDb.personPreference.update({
            where: { personId: f.personViewerA },
            data: { preferredDays: [3], preferredBlocks: [] },
        });
    });
});

describe('the weight multiplier', () => {
    it('sends a NULL override as ABSENT, never as 0', async () => {
        const out = await assemble();
        const person = out.input.persons.find((row) => row.id === f.personA);

        // The distinction the `optional` field exists for: 0 would mean "ignore
        // this person entirely", which is the opposite of "use the default".
        expect(person!.preferred?.weightMultiplier).toBeUndefined();
        expect(person!.preferred?.weightMultiplier).not.toBe(0);
    });

    it('sends a real override as itself', async () => {
        const out = await assemble();
        const person = out.input.persons.find((row) => row.id === f.personViewerA);

        expect(person!.preferred?.weightMultiplier).toBe(1.5);
    });
});

describe('a person who has stated nothing', () => {
    it('carries no Preference message rather than an empty one', async () => {
        const out = await assemble();
        const person = out.input.persons.find((row) => row.id === f.personMultiA);

        expect(person, 'the person is still sent').toBeDefined();
        expect(person!.preferred).toBeUndefined();
    });
});

describe('the inert-rule report', () => {
    it('counts placements no counted lecturer has spoken about', async () => {
        const out = await assemble();
        const { placementsWithNoSignal, placementsCounted, lecturersWithPreference } = out.report.preferences;

        // The seed's own offering has NO lecturers (frequency 2) and is therefore
        // pure noise to this rule; the one added here has a lecturer who stated
        // something (frequency 3).
        expect(placementsCounted).toBe(5);
        expect(placementsWithNoSignal).toBe(2);
        expect(lecturersWithPreference).toBe(1);
    });

    it('reports the WHOLLY inert case when the only speaking lecturer goes quiet', async () => {
        // Asserted in both directions on purpose: a hardcoded count, or one that
        // never reaches `placementsCounted`, passes the test above and fails here.
        await ownerDb.personPreference.delete({ where: { personId: f.personA } });

        const out = await assemble();
        const { placementsWithNoSignal, placementsCounted, lecturersWithPreference } = out.report.preferences;

        expect(placementsWithNoSignal).toBe(placementsCounted);
        expect(placementsWithNoSignal).toBe(5);
        expect(lecturersWithPreference).toBe(0);

        await ownerDb.personPreference.create({
            data: {
                tenantId: f.tenantA, personId: f.personA,
                preferredDays: [2], preferredBlocks: [0], weightMultiplier: null,
            },
        });
    });
});
