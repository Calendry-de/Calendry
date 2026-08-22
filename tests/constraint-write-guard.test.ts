import { describe, expect, it } from 'vitest';
import { CONSTRAINT_TYPES, validateConstraintShape } from '../shared/constraintTypes';

/**
 * The write-boundary guard for constraint rows.
 *
 * Two rules the rule builder honoured and the generic CRUD API did not, which
 * is the whole category: `POST /api/constraints` with `weight: -5` returned 201
 * against the live API, and a row saying `no_double_booking_room` is SOFT was
 * equally storable.
 *
 * WHY A NEGATIVE WEIGHT IS NOT A COSMETIC PROBLEM. Every soft type declares
 * "minimize", so a negative weight inverts a rule into a maximize it never
 * declared. Worse, it is not local: the solver derives
 * `hard_penalty = sum(all soft weights) * placements + 1`, so a negative weight
 * subtracts from the margin that keeps HARD constraints outranking every soft
 * configuration — for every rule in the tenant, not just the mis-typed one.
 *
 * These are unit tests over the shared validator. The HTTP behaviour it backs
 * is exercised in `constraint-write-guard-api.test.ts`; this pins the rules
 * themselves, including the partial-update semantics that keep a legacy bad row
 * repairable.
 */
describe('weight floor', () => {
    it('rejects a negative weight', () => {
        const problems = validateConstraintShape({
            type: 'minimize_online_sessions', severity: 'SOFT', weight: -5,
        });

        expect(problems.map((p) => p.field)).toEqual(['weight']);
    });

    it('ALLOWS zero, matching the solver rather than the builder', () => {
        // The counter-example that makes the test above mean something. The
        // builder's input carried `min: 1`, but calendry-solver's own check is
        // `weight < 0.0` with the comment "Zero is fine and means report the
        // count, do not steer". A floor of 1 here would reject a configuration
        // the solver accepts — the same builder-stricter-than-API divergence,
        // just pointing the other way.
        expect(validateConstraintShape({
            type: 'minimize_online_sessions', severity: 'SOFT', weight: 0,
        })).toEqual([]);
    });

    it('enforces no ceiling', () => {
        // Deliberate: weight is relative, and `hard_penalty` scales with the sum
        // of weights, so no magnitude lets a soft rule outrank a hard one. A cap
        // could only ever be arbitrary.
        expect(validateConstraintShape({
            type: 'minimize_online_sessions', severity: 'SOFT', weight: 10_000_000,
        })).toEqual([]);
    });

    it('treats a null weight as the HARD case, not as a violation', () => {
        expect(validateConstraintShape({
            type: 'no_double_booking_room', severity: 'HARD', weight: null,
        })).toEqual([]);
    });
});

describe('severity must match the catalogue', () => {
    it('rejects a HARD-pinned type stored as SOFT', () => {
        const problems = validateConstraintShape({
            type: 'no_double_booking_room', severity: 'SOFT', weight: 3,
        });

        expect(problems.map((p) => p.field)).toEqual(['severity']);
        expect(problems[0]!.message).toContain('always HARD');
    });

    it('accepts every catalogue type at its own pinned severity', () => {
        // The broad counter-example: a guard that rejects everything would pass
        // every negative test above.
        for (const type of CONSTRAINT_TYPES) {
            if (!type.severity) continue;

            const weight = type.severity === 'SOFT' ? 1 : null;

            expect(validateConstraintShape({ type: type.key, severity: type.severity, weight }), type.key)
                .toEqual([]);
        }
    });

    it('rejects an unknown type', () => {
        expect(validateConstraintShape({ type: 'not_a_real_type' }).map((p) => p.field))
            .toEqual(['type']);
    });
});

describe('partial validation — the trap this design exists to avoid', () => {
    /**
     * A row that predates the guard: `no_double_booking_room` is pinned HARD,
     * stored as SOFT. Validating the MERGED row on every update would make it
     * permanently uneditable — someone trying to DISABLE the very row the guard
     * protects them from would be refused by the guard.
     *
     * That is not hypothetical. CLAUDE.md records a mislabelled constraint that
     * "could never be corrected by editing — only deleted and recreated",
     * because `type` is create-only. This is the same shape, and these cases are
     * what stop it recurring.
     */
    const LEGACY = { type: 'no_double_booking_room' };

    it('says nothing when the patch touches neither severity nor weight', () => {
        // What `beforeUpdate` passes for `{ isEnabled: false }` or a rename:
        // the stored type and nothing else.
        expect(validateConstraintShape(LEGACY)).toEqual([]);
    });

    it('lets a legacy row take a VALID weight without re-litigating its severity', () => {
        expect(validateConstraintShape({ ...LEGACY, weight: 3 })).toEqual([]);
    });

    it('still refuses a negative weight on that same legacy row', () => {
        expect(validateConstraintShape({ ...LEGACY, weight: -1 }).map((p) => p.field))
            .toEqual(['weight']);
    });

    it('lets a legacy row be repaired to its catalogue severity', () => {
        expect(validateConstraintShape({ ...LEGACY, severity: 'HARD', weight: null })).toEqual([]);
    });

    it('reports both fields at once when both are wrong', () => {
        const problems = validateConstraintShape({
            type: 'no_double_booking_room', severity: 'SOFT', weight: -2,
        });

        // Both, not the first — a form that highlights one field per save is a
        // form the user fights twice.
        expect(problems.map((p) => p.field).sort()).toEqual(['severity', 'weight']);
    });
});
