import { describe, expect, it } from 'vitest';
import { type CapacityGroup, type CapacityMembership, deriveCapacity } from '../shared/groupCapacity';

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
