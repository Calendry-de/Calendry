import { describe, expect, it } from 'vitest';
import { parseWireOfferingId, splitsIntoSeries, wireOfferingId } from '../server/utils/offeringSplit';

/**
 * The wire identity for a per-group Offering series.
 *
 * This is the same class of risk as the tracked "violations naming Sessions the
 * solver invented" gap — a wire-level identity that must lead back to real rows
 * — with one difference that makes it sharper: the reversal happens at APPLY,
 * from `solver_run.result`, possibly days later and across a restart. Nothing
 * held in memory during assembly is available then, which is why the mapping is
 * encoded in the id rather than kept beside it, and why the round trip has to
 * be total rather than merely usual.
 */
describe('split ids reverse exactly', () => {
    it('round-trips a split id', () => {
        const wire = wireOfferingId('01a0294e-755b-72d6-a777-d322136cce24', '01a025f9-dcbe-7459-b088-8172d89c80e8');

        expect(parseWireOfferingId(wire)).toEqual({
            offeringId: '01a0294e-755b-72d6-a777-d322136cce24',
            groupId: '01a025f9-dcbe-7459-b088-8172d89c80e8',
            ambiguous: false,
        });
    });

    it('round-trips an UNSPLIT id — the identity case', () => {
        // The property single-group and group-less Offerings depend on: their
        // ids pass through untouched, so nothing downstream needs to know
        // whether a split happened.
        const plain = '01a0294e-755b-72d6-a777-d322136cce24';

        expect(parseWireOfferingId(plain)).toEqual({
            offeringId: plain, groupId: null, ambiguous: false,
        });
    });

    it('round-trips this codebase\'s hyphenated seeded ids', () => {
        // Real ids here are not all uuid7 — the seeder mints
        // `…-class-A`, `…-room-A101`. Hyphens must not be mistaken for the
        // separator.
        const wire = wireOfferingId('tenant-x-offering-1', 'tenant-x-class-A');

        expect(parseWireOfferingId(wire)).toMatchObject({
            offeringId: 'tenant-x-offering-1', groupId: 'tenant-x-class-A',
        });
    });

    it('reports an id carrying more than one separator instead of guessing', () => {
        // Unreachable with real ids, which is why it is asserted: picking a
        // side would attach placements to the WRONG Offering silently, and a
        // count is recoverable where a wrong answer is not.
        expect(parseWireOfferingId('a::b::c')).toMatchObject({ ambiguous: true });
    });

    it('never produces a colliding id for two different series', () => {
        const a = wireOfferingId('off-1', 'group-2');
        const b = wireOfferingId('off-1', 'group-3');

        expect(a).not.toBe(b);
    });
});

describe('what counts as a multi-series Offering', () => {
    it('does not split zero or one group', () => {
        // Unchanged semantics: one Group means combined attendance across its
        // whole descendant closure.
        expect(splitsIntoSeries([])).toBe(false);
        expect(splitsIntoSeries(['g1'])).toBe(false);
    });

    it('splits two or more', () => {
        expect(splitsIntoSeries(['g1', 'g2'])).toBe(true);
        expect(splitsIntoSeries(['g1', 'g2', 'g3', 'g4'])).toBe(true);
    });
});
