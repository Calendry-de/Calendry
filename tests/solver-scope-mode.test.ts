import { describe, expect, it } from 'vitest';
import { LockPolicy } from '@calendry-de/calendry-proto';
import { hashScope, resolveScope, toWireScope } from '../server/utils/solverScope';
import { REPAIR_MOVEMENT_WEIGHT } from '../shared/solverMode';

/**
 * What a run's MODE decides, and the one thing it silently broke.
 *
 * A rebuild and a repair are the same solver mechanism given opposite
 * instructions (solver ADR-0008), which means the difference between them lives
 * entirely in three values that are derived together and were previously
 * written out separately. These pin that derivation, and — the reason this file
 * exists at all — that the two modes cannot collide in the solver's idempotency
 * registry.
 */

// Two Offerings, one of them split per Group, so the wire and real id lists are
// genuinely different rather than coincidentally equal.
const assembled = {
    real: ['off-a', 'off-b'],
    wire: ['off-a', 'off-b::grp-1', 'off-b::grp-2'],
};

describe('resolveScope', () => {
    it('gives a rebuild the whole term and a hard lock outside it', () => {
        const scope = resolveScope({ mode: 'rebuild', assembled });

        expect(scope.offeringIds).toEqual(assembled.real);
        expect(scope.wireOfferingIds).toEqual(assembled.wire);
        expect(scope.outsideScopePolicy).toBe('LOCK_POLICY_HARD');
        // Ignored by the solver under a hard lock, but 0 is a real value of this
        // field rather than a stand-in for absent, so it is asserted.
        expect(scope.minimizeMovementWeight).toBe(0);
    });

    it('gives a repair an EMPTY scope, which is the whole feature', () => {
        // Empty scope was a no-op under v1 ("nothing to place"). Under v2 every
        // Session is therefore out of scope, so every Session becomes movable
        // and every move is charged. Defaulting a repair to the full term
        // instead would place the entire timetable from scratch while claiming
        // to repair it.
        const scope = resolveScope({ mode: 'repair', assembled });

        expect(scope.offeringIds).toEqual([]);
        expect(scope.wireOfferingIds).toEqual([]);
        expect(scope.outsideScopePolicy).toBe('LOCK_POLICY_MINIMIZE_MOVEMENT');
        expect(scope.minimizeMovementWeight).toBe(REPAIR_MOVEMENT_WEIGHT);
    });

    it('honours an explicitly empty list rather than falling back to the mode default', () => {
        // `[] ?? x` is `[]` and `[] || x` is `x`; only the first is correct.
        // A caller that asks for nothing gets nothing, in either mode.
        expect(resolveScope({ mode: 'rebuild', offeringIds: [], assembled }).offeringIds).toEqual([]);
    });

    it('keeps a targeted repair scoped and still softly locked outside', () => {
        // Cancel-to-spare-bank's shape: one Offering free to move, the rest of
        // the term movable but charged.
        const scope = resolveScope({ mode: 'repair', offeringIds: ['off-a'], assembled });

        expect(scope.offeringIds).toEqual(['off-a']);
        expect(scope.outsideScopePolicy).toBe('LOCK_POLICY_MINIMIZE_MOVEMENT');
        expect(scope.minimizeMovementWeight).toBe(REPAIR_MOVEMENT_WEIGHT);
    });
});

describe('toWireScope', () => {
    it('sends the WIRE ids and never the real ones', () => {
        // The split ids are what `convert.rs` matches existing Sessions against;
        // sending real ids means the split series are out of scope and nothing
        // is placed.
        expect(toWireScope(resolveScope({ mode: 'rebuild', assembled })).offeringIds)
            .toEqual(assembled.wire);
    });

    it('maps each stored policy to its enum value', () => {
        expect(toWireScope(resolveScope({ mode: 'rebuild', assembled })).outsideScopePolicy)
            .toBe(LockPolicy.LOCK_POLICY_HARD);
        expect(toWireScope(resolveScope({ mode: 'repair', assembled })).outsideScopePolicy)
            .toBe(LockPolicy.LOCK_POLICY_MINIMIZE_MOVEMENT);
    });
});

describe('hashScope, as the idempotency key’s scope half', () => {
    /**
     * THE BUG THIS GUARDS. The key was `<inputHash>:<seed>`, and `SolverInput`
     * carries no scope — `SolveScope` is a separate argument to StartRun. So a
     * rebuild and a repair of one unchanged term at the same seed hashed
     * identically, and the solver's in-memory registry would replay the
     * rebuild's answer for the repair: the user asks to fix one clash and is
     * handed a full rewrite of the term, reported as SUCCEEDED.
     */
    it('separates a repair from a rebuild of the same unchanged term', () => {
        expect(hashScope(toWireScope(resolveScope({ mode: 'repair', assembled }))))
            .not.toBe(hashScope(toWireScope(resolveScope({ mode: 'rebuild', assembled }))));
    });

    it('separates two repairs that target different Offerings', () => {
        // Not a variant of the above: both are repairs at the same policy and
        // weight, differing only in scope, which is exactly the axis the input
        // hash cannot see.
        const a = hashScope(toWireScope(resolveScope({ mode: 'repair', offeringIds: ['off-a'], assembled })));
        const b = hashScope(toWireScope(resolveScope({ mode: 'repair', offeringIds: ['off-b'], assembled })));

        expect(a).not.toBe(b);
    });

    it('is stable across two identical requests, so a retry still replays', () => {
        // The property the key exists for in the first place: separating the
        // modes must not cost idempotency within one mode.
        expect(hashScope(toWireScope(resolveScope({ mode: 'repair', assembled }))))
            .toBe(hashScope(toWireScope(resolveScope({ mode: 'repair', assembled }))));
    });
});
