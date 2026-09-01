import { describe, expect, it } from 'vitest';
import {
    ENROLMENT_COMPLETE_RATIO, type CapacityGroup, type CapacityMembership, deriveCapacity, estimatedGroupSizes,
} from '../shared/groupCapacity';

/**
 * The counting rule behind `Offering.requiredCapacity`'s documented-but-absent
 * derivation.
 *
 * The property that matters is DEDUPLICATION, and it has two independent forms
 * that a naive sum gets wrong in the same way. Both are asserted against a tree
 * shaped like the demo tenant's, because the demo data is currently flat enough
 * that a broken implementation would pass on it by coincidence.
 */
const TREE: CapacityGroup[] = [
    { id: 'itsec', parentGroupId: null, expectedSize: 48 },
    { id: 'dit-s1', parentGroupId: 'itsec', expectedSize: 24 },
    { id: 'dit-s2', parentGroupId: 'itsec', expectedSize: 24 },
    { id: 'wi', parentGroupId: null, expectedSize: 48 },
    { id: 'dwi-s1', parentGroupId: 'wi', expectedSize: 24 },
    { id: 'dwi-s2', parentGroupId: 'wi', expectedSize: 24 },
    { id: 'noestimate', parentGroupId: null, expectedSize: null },
    { id: 'kid-a', parentGroupId: 'noestimate', expectedSize: 10 },
    { id: 'kid-b', parentGroupId: 'noestimate', expectedSize: 15 },
];

const members = (...pairs: [string, string][]): CapacityMembership[] =>
    pairs.map(([groupId, personId]) => ({ groupId, personId }));

describe('with no real membership, it falls back to estimates', () => {
    it('sums independent siblings', () => {
        expect(deriveCapacity(['dit-s1', 'dit-s2', 'dwi-s1', 'dwi-s2'], TREE, [])).toMatchObject({
            capacity: 96, basis: 'expected_size',
        });
    });

    it('DEDUPES a parent attached alongside its own child', () => {
        // The naive answer is 48 + 24 = 72. The child is already inside the
        // parent, so the parent alone is the truth.
        expect(deriveCapacity(['itsec', 'dit-s1'], TREE, [])).toMatchObject({
            capacity: 48, basis: 'expected_size',
        });
    });

    it('dedupes a grandparent attached alongside a deeper descendant', () => {
        const deep: CapacityGroup[] = [
            ...TREE,
            { id: 'seminar', parentGroupId: 'dit-s1', expectedSize: 8 },
        ];

        expect(deriveCapacity(['itsec', 'seminar'], deep, [])).toMatchObject({ capacity: 48 });
    });

    it('derives a parent with no estimate from its children', () => {
        expect(deriveCapacity(['noestimate'], TREE, [])).toMatchObject({
            capacity: 25, basis: 'expected_size',
        });
    });
});

describe('estimatedGroupSizes', () => {
    it('reports every group\'s own estimate where it has one', () => {
        const sizes = estimatedGroupSizes(TREE);

        expect(sizes.get('itsec')).toBe(48);
        expect(sizes.get('dit-s1')).toBe(24);
    });

    it('sums nested groups for one with no estimate of its own', () => {
        expect(estimatedGroupSizes(TREE).get('noestimate')).toBe(25);
    });

    it('is NULL, not 0, where neither a group nor anything beneath it has a number', () => {
        const bare: CapacityGroup[] = [
            { id: 'root', parentGroupId: null, expectedSize: null },
            { id: 'child', parentGroupId: 'root', expectedSize: null },
        ];

        expect(estimatedGroupSizes(bare).get('root')).toBeNull();
    });

    it('sums through more than one level of nesting', () => {
        const grand: CapacityGroup[] = [
            { id: 'root', parentGroupId: null, expectedSize: null },
            { id: 'mid', parentGroupId: 'root', expectedSize: null },
            { id: 'leaf-a', parentGroupId: 'mid', expectedSize: 10 },
            { id: 'leaf-b', parentGroupId: 'mid', expectedSize: 15 },
        ];

        expect(estimatedGroupSizes(grand).get('root')).toBe(25);
    });
});

describe('real membership overrides estimates', () => {
    it('counts distinct people across the closure, not the estimate', () => {
        // 3 real people beneath a group estimated at 48 — the fact wins.
        const roll = members(['dit-s1', 'p1'], ['dit-s1', 'p2'], ['dit-s2', 'p3']);

        expect(deriveCapacity(['itsec'], TREE, roll)).toMatchObject({
            capacity: 3, basis: 'membership',
        });
    });

    it('counts a person ONCE when enrolled at both a leaf and its ancestor', () => {
        // Legal data: direct membership at any level. A sum would say 2.
        const roll = members(['itsec', 'p1'], ['dit-s1', 'p1']);

        expect(deriveCapacity(['itsec'], TREE, roll)).toMatchObject({
            capacity: 1, basis: 'membership',
        });
    });

    it('DEDUPES across attached groups whose closures overlap', () => {
        // p1 is reachable through both attached groups; p2 through one.
        const roll = members(['dit-s1', 'p1'], ['itsec', 'p1'], ['dit-s2', 'p2']);

        expect(deriveCapacity(['itsec', 'dit-s1'], TREE, roll)).toMatchObject({
            capacity: 2, basis: 'membership',
        });
    });

    it('takes membership even when it is SMALLER than the estimate', () => {
        // The decision being pinned: a real roll always wins, including when it
        // makes the requirement smaller. Anything else would keep a stale guess
        // in force forever.
        const roll = members(['dwi-s1', 'p1']);

        expect(deriveCapacity(['dwi-s1'], TREE, roll)).toMatchObject({
            capacity: 1, basis: 'membership',
        });
    });

    it('ignores membership of groups OUTSIDE the closure', () => {
        const roll = members(['dwi-s1', 'stranger']);

        expect(deriveCapacity(['itsec'], TREE, roll)).toMatchObject({
            capacity: 48, basis: 'expected_size',
        });
    });
});

describe('when nothing can be derived', () => {
    it('returns null, not zero, for an Offering with no groups', () => {
        expect(deriveCapacity([], TREE, [])).toMatchObject({ capacity: null, basis: 'none' });
    });

    it('returns null when the whole closure has neither members nor estimates', () => {
        const bare: CapacityGroup[] = [{ id: 'bare', parentGroupId: null, expectedSize: null }];

        expect(deriveCapacity(['bare'], bare, [])).toMatchObject({ capacity: null, basis: 'none' });
    });

    it('ignores a dangling group id rather than counting it as zero', () => {
        expect(deriveCapacity(['ghost'], TREE, [])).toMatchObject({ capacity: null, basis: 'none' });
    });
});


/**
 * Partial enrolment — the risk created by "real membership always wins".
 *
 * A roll of 4 against an expected 96 is still a fact, and still the answer. But
 * trusting it silently produces a capacity that is catastrophically low, and
 * the tenant discovers it when a room turns out to hold a twentieth of the
 * cohort. So it is REPORTED, never blocked — the same "surface rather than
 * narrow silently" pattern as `offeringsWithNoDerivableCapacity`.
 *
 * The threshold decides only WHETHER to mention it. Both numbers travel with
 * the result so severity is a human judgement rather than this constant's.
 */
describe('partial enrolment is flagged, not blocked', () => {
    const one = (expected: number | null): CapacityGroup[] =>
        [{ id: 'cohort', parentGroupId: null, expectedSize: expected }];

    const roll = (n: number): CapacityMembership[] =>
        Array.from({ length: n }, (_, i) => ({ groupId: 'cohort', personId: `p${i}` }));

    it('flags a roll far below the estimate, and still uses the real count', async () => {
        const out = deriveCapacity(['cohort'], one(96), roll(4));

        // The count WINS — this is advisory, not a veto.
        expect(out).toMatchObject({
            capacity: 4, basis: 'membership', estimate: 96, partialEnrolment: true,
        });
    });

    it('does NOT flag a roll at the threshold', async () => {
        // 90 of 100 is exactly the ratio; ordinary churn, not a data gap.
        expect(deriveCapacity(['cohort'], one(100), roll(90))).toMatchObject({
            capacity: 90, partialEnrolment: false,
        });
    });

    it('flags one just below the threshold', async () => {
        expect(deriveCapacity(['cohort'], one(100), roll(89))).toMatchObject({
            capacity: 89, partialEnrolment: true,
        });
    });

    it('does not flag a roll LARGER than the estimate', async () => {
        // A stale low estimate is the estimate's problem, not the roll's.
        expect(deriveCapacity(['cohort'], one(10), roll(40))).toMatchObject({
            capacity: 40, partialEnrolment: false,
        });
    });

    it('cannot flag anything when no estimate exists to compare against', async () => {
        // Absence of an estimate is not evidence of completeness. Inventing a
        // comparison here would be the silent-narrowing failure one level up.
        expect(deriveCapacity(['cohort'], one(null), roll(3))).toMatchObject({
            capacity: 3, basis: 'membership', estimate: null, partialEnrolment: false,
        });
    });

    it('never flags when the basis is the estimate itself', async () => {
        // No roll at all means nothing to be partial about.
        expect(deriveCapacity(['cohort'], one(96), [])).toMatchObject({
            capacity: 96, basis: 'expected_size', partialEnrolment: false,
        });
    });

    it('compares against the DEDUPED estimate, not the naive sum', async () => {
        const tree: CapacityGroup[] = [
            { id: 'parent', parentGroupId: null, expectedSize: 100 },
            { id: 'child', parentGroupId: 'parent', expectedSize: 60 },
        ];
        // Naive sum 160 -> 95 would look partial. Deduped estimate is 100, so
        // 95 is complete. The dedup has to hold here too or the flag misfires.
        const out = deriveCapacity(['parent', 'child'], tree, Array.from({ length: 95 },
            (_, i) => ({ groupId: 'child', personId: `p${i}` })));

        expect(out).toMatchObject({ capacity: 95, estimate: 100, partialEnrolment: false });
    });

    it('exports the threshold rather than hiding it in the predicate', async () => {
        expect(ENROLMENT_COMPLETE_RATIO).toBe(0.9);
    });
});
