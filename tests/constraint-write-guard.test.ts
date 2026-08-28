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

/**
 * PARAMETERS, the third rule the generic schema cannot express.
 *
 * `params` was `z.record(z.string(), z.unknown())` — arbitrary JSON — while
 * `buildVariant` reads four of those values with no guard at all. The tests
 * below are grouped by what a bad value actually DOES, because the four failure
 * modes are not the same severity and only one of them is loud:
 *
 * - `days` is cast `as number[]` and `.map`ped, so a non-array THROWS during
 *   `assembleSolverInput` and fails the entire run, every other constraint with
 *   it. That is the only one anybody would notice.
 * - a non-numeric `maxRatio`/`rankThreshold` becomes `NaN`, and every comparison
 *   against `NaN` is false — the rule is inert and looks satisfied.
 * - `Boolean('false')` is `true`, so a stringified boolean means its opposite.
 * - `window` is compared against one literal, so a typo silently selects the
 *   other branch.
 */
describe('parameter values', () => {
    it('rejects a weekdays value that is not a list — the one that crashes assembly', () => {
        // `buildVariant` does `(params.days as number[]).map(Number)`. This
        // string does not disable `minimize_specifc_day`; it throws before the
        // request is built, so a whole solver run fails on one bad character.
        const problems = validateConstraintShape({
            type: 'minimize_specifc_day',
            params: { days: 'monday' },
        });

        expect(problems.map((p) => p.paramKey)).toEqual(['days']);
    });

    it('rejects a weekday outside 1-7 and names the offending entry', () => {
        const problems = validateConstraintShape({
            type: 'minimize_specifc_day',
            params: { days: [1, 8] },
        });

        expect(problems).toHaveLength(1);
        expect(problems[0]?.message).toContain('8');
    });

    it('accepts numeric strings, matching the mapper rather than being stricter', () => {
        // The counter-example. `buildVariant` maps with `Number`, so `['1','3']`
        // works end to end today; rejecting it here would be the
        // builder-stricter-than-API divergence that produced the weight gap.
        expect(validateConstraintShape({
            type: 'minimize_specifc_day',
            params: { days: ['1', '3'] },
        })).toEqual([]);
    });

    it('rejects a non-numeric number, which would otherwise be sent as NaN', () => {
        const problems = validateConstraintShape({
            type: 'max_online_ratio_per_group',
            params: { maxRatio: 'thirty', window: 'SHARE_WINDOW_PER_TERM' },
        });

        expect(problems.map((p) => p.paramKey)).toEqual(['maxRatio']);
    });

    it('enforces the catalogue min and max, not a hardcoded range', () => {
        // `maxRatio` declares 0-100. Both bounds come from the declaration, so a
        // parameter added later is bounded the moment it is declared.
        expect(validateConstraintShape({
            type: 'max_online_ratio_per_group', params: { maxRatio: 101 },
        }).map((p) => p.paramKey)).toEqual(['maxRatio']);

        expect(validateConstraintShape({
            type: 'max_online_ratio_per_group', params: { maxRatio: -1 },
        }).map((p) => p.paramKey)).toEqual(['maxRatio']);

        expect(validateConstraintShape({
            type: 'max_online_ratio_per_group', params: { maxRatio: 0 },
        })).toEqual([]);
    });

    it('rejects a select value outside the declared options', () => {
        // `buildVariant` reads this as
        // `params.window === 'SHARE_WINDOW_PER_WEEK' ? 2 : 1`, so this typo is
        // indistinguishable from a deliberate per-term choice.
        const problems = validateConstraintShape({
            type: 'max_online_ratio_per_group',
            params: { maxRatio: 30, window: 'SHARE_WINDOW_PER_WEK' },
        });

        expect(problems.map((p) => p.paramKey)).toEqual(['window']);
    });

    it("rejects the string 'false', which Boolean() would read as true", () => {
        const problems = validateConstraintShape({
            type: 'minimize_high_ranking_rooms',
            params: { rankThreshold: 3, invert: 'false' },
        });

        expect(problems.map((p) => p.paramKey)).toEqual(['invert']);
    });

    it('treats an empty, null or absent value as UNSET rather than invalid', () => {
        // Requiredness is `missingConstraintParams()`'s question, asked at solve
        // time where the answer is a skipped rule with a reason. A rule still
        // being configured has to be saveable, so none of these is a problem
        // here even though every one of them is `required` in the catalogue.
        expect(validateConstraintShape({
            type: 'max_online_ratio_per_group',
            params: { maxRatio: '', window: null },
        })).toEqual([]);

        expect(validateConstraintShape({
            type: 'max_online_ratio_per_group', params: {},
        })).toEqual([]);
    });

    it('ignores keys the catalogue does not declare, so a legacy row stays editable', () => {
        // The builder spreads the stored object on every edit, so a key left by
        // a parameter that no longer exists travels with the row. Refusing it
        // would make exactly the rows that need repairing unrepairable — the
        // same reasoning as validating only the fields being changed.
        expect(validateConstraintShape({
            type: 'minimize_specifc_day',
            params: { days: [1], retiredParameterFromAnEarlierRelease: { nested: true } },
        })).toEqual([]);
    });

    it('reports every bad parameter at once, not just the first', () => {
        const problems = validateConstraintShape({
            type: 'max_online_ratio_per_group',
            params: { maxRatio: 'x', window: 'nope' },
        });

        expect(problems.map((p) => p.paramKey)).toEqual(['maxRatio', 'window']);
    });

    it('says nothing about params for a type that declares none', () => {
        // `group_veto` and the structural rules have `params: []`; the loop is
        // over the CATALOGUE's parameters, so there is nothing to check and an
        // arbitrary payload is inert rather than refused.
        expect(validateConstraintShape({
            type: 'group_veto', params: { anything: 1 },
        })).toEqual([]);
    });

    it('checks nothing when params is absent, so severity-only edits still pass', () => {
        expect(validateConstraintShape({
            type: 'minimize_specifc_day', severity: 'SOFT',
        })).toEqual([]);
    });

    it('every catalogue default is a value the guard accepts', () => {
        // A catalogue-wide invariant rather than a per-type assertion: a new
        // parameter whose `default` its own declaration would reject is a
        // contradiction that reaches a tenant as a rule they cannot save.
        for (const type of CONSTRAINT_TYPES) {
            const defaults = Object.fromEntries(
                type.params
                    .filter((param) => param.default !== undefined)
                    .map((param) => [param.key, param.default]),
            );

            expect(validateConstraintShape({ type: type.key, params: defaults }), type.key)
                .toEqual([]);
        }
    });
});
