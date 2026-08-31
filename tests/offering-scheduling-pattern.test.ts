import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SchedulingPattern } from '@calendry-de/calendry-proto';
import { type Fixtures, ownerDb, seed, teardown } from './helpers/seed';
import { assembleSolverInput } from '../server/utils/solverInput';
import { RESOURCES } from '../server/utils/resources';

/**
 * `Offering.scheduling_pattern` — whether a course spreads across the Term or
 * concentrates into a window.
 *
 * CLASSIFICATION ONLY at this point: the value reaches the wire, and the solver
 * acts on it only through the pattern-adherence constraint types, which no
 * tenant can enable yet. So the property worth pinning is not that a timetable
 * changes — it must not — but that the three states stay THREE.
 *
 * NULL IS NOT DISTRIBUTED. "A weekly slot" is what most timetables assume, so
 * mapping an unclassified Offering onto it is the tempting default and the
 * wrong one: it would send an institution's assumption as though somebody had
 * chosen it, and the solver would act on that the moment a pattern rule is
 * switched on. UNSPECIFIED is the same claim the column's NULL makes.
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

    return assembleSolverInput(tx as never, { tenantId: f.tenantA, termId: f.termA });
});

const patternOf = async () => (await assemble()).input.offerings
    .find((offering) => offering.id === 'test-offering-a')!.schedulingPattern;

describe('reaching the wire', () => {
    it('sends UNSPECIFIED for an unclassified Offering, never DISTRIBUTED', async () => {
        expect(await patternOf()).toBe(SchedulingPattern.SCHEDULING_PATTERN_UNSPECIFIED);
        // Stated as its own assertion: the failure this guards is a plausible
        // default, not a missing mapping, so "not the tempting value" is the
        // claim rather than merely "the right value".
        expect(await patternOf()).not.toBe(SchedulingPattern.SCHEDULING_PATTERN_DISTRIBUTED);
    });

    it.each([
        ['DISTRIBUTED', SchedulingPattern.SCHEDULING_PATTERN_DISTRIBUTED],
        ['BLOCK', SchedulingPattern.SCHEDULING_PATTERN_BLOCK],
    ] as const)('sends %s as itself', async (stored, wire) => {
        await ownerDb.offering.update({
            where: { id: 'test-offering-a' },
            data: { schedulingPattern: stored },
        });

        expect(await patternOf()).toBe(wire);
    });

    it('returns to UNSPECIFIED when the classification is cleared', async () => {
        // The round trip matters because the column is nullable and the form's
        // "Not decided" option sends an empty string: if clearing did not reach
        // NULL, an Offering could never be un-classified once classified.
        await ownerDb.offering.update({
            where: { id: 'test-offering-a' },
            data: { schedulingPattern: null },
        });

        expect(await patternOf()).toBe(SchedulingPattern.SCHEDULING_PATTERN_UNSPECIFIED);
    });
});

describe('the inert-rule report', () => {
    /*
     * A PATTERN RULE PRICES ONLY THE OFFERINGS CARRYING ITS PATTERN, and an
     * unclassified Offering is untouched by both. So a tenant can enable
     * `distributed_pattern_adherence`, weight it, see it in the catalogue, and
     * have it do nothing — the `lecturer_veto` shape this codebase already paid
     * for once, which went unnoticed precisely because nothing counted it.
     *
     * Asserted in BOTH directions so a hardcoded value cannot satisfy it.
     */
    it('counts unclassified Offerings, which are what make the rule inert', async () => {
        await ownerDb.offering.update({
            where: { id: 'test-offering-a' },
            data: { schedulingPattern: null },
        });

        const before = (await assemble()).report.offeringsByPattern;

        expect(before.unclassified).toBeGreaterThan(0);
        expect(before.distributed).toBe(0);

        await ownerDb.offering.update({
            where: { id: 'test-offering-a' },
            data: { schedulingPattern: 'DISTRIBUTED' },
        });

        const after = (await assemble()).report.offeringsByPattern;

        expect(after.distributed).toBe(1);
        expect(after.unclassified).toBe(before.unclassified - 1);
    });
});

describe('the write schema', () => {
    /*
     * A `<select>` cannot send "absent" — it sends the empty string. Without the
     * preprocess the one option that means "I have not decided" would be the
     * only one the API rejects, and an Offering could be classified but never
     * un-classified.
     */
    const parse = (value: unknown) => RESOURCES.offerings!.update!.parse({ schedulingPattern: value });

    it('reads the form\u2019s blank option as NULL, not as a validation error', () => {
        expect(parse('')).toEqual({ schedulingPattern: null });
    });

    it('accepts the two real values and refuses anything else', () => {
        expect(parse('BLOCK')).toEqual({ schedulingPattern: 'BLOCK' });
        expect(() => parse('WEEKLY')).toThrow();
    });
});
