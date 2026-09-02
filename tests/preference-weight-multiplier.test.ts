import { describe, expect, it } from 'vitest';
import {
    WEIGHT_MULTIPLIER_MAX,
    WEIGHT_MULTIPLIER_MIN,
    describeWeightMultiplier,
    isWeightMultiplierInRange,
} from '../shared/availability';

/**
 * The per-person preference weight, on the parts that can be tested without a
 * browser.
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT DO, and why. This repo has no
 * component-mounting harness (no `@vue/test-utils`, no `happy-dom`), so a true
 * mount-and-click test of `AvailabilityWeightMultiplier` is not possible without
 * adding a second test stack. Rather than skip the coverage, the control's
 * behaviour is split so the deciding logic is testable where it lives:
 *
 *   - the RANGE rule is `isWeightMultiplierInRange` in `shared/`, the same
 *     predicate the control calls and the same bounds the server's zod schema
 *     uses (`tests/person-availability-api.test.ts` covers the server side, and
 *     the database CHECK is covered there too);
 *   - the three STATES a reader has to distinguish (default, overridden, and
 *     an out-of-range attempt) are decided by `describeWeightMultiplier` and
 *     `isWeightMultiplierInRange`, both asserted here, and the overridden state
 *     is asserted again over real HTTP against the rendered staff page in
 *     `person-availability-api.test.ts`. They live in `shared/` because the
 *     server's write path needs the same predicate and the same bounds, so
 *     there is one clamp rather than two kept in agreement by hand.
 *
 *     THIS PARAGRAPH USED TO CLAIM something different and false: that
 *     `app/utils/availabilityLabels.ts` "imports `~/composables/schedule`,
 *     which resolves only inside Nuxt and is therefore unreachable from a unit
 *     test". `vitest.config.ts` aliases `~` to `./app`, so that module imports
 *     and runs perfectly well here, as `tests/availability-labels-render.test.ts`
 *     now demonstrates by calling `describeWindow()` directly against a real
 *     TimeGrid. Corrected under issue #19, and worth naming rather than quietly
 *     deleting: a false claim about what CANNOT be tested is how coverage gets
 *     skipped for years, and it is exactly the "a tracked-gap entry can drift
 *     from the code silently" trap CLAUDE.md warns about, wearing a test
 *     comment as a disguise.
 *
 * The gap that remains is the input's own keystroke handling, which is the part
 * least able to be wrong in a way the server would not also catch.
 */
describe('the clamp, shared by the control and the write path', () => {
    it('accepts the exact boundaries', () => {
        // A clamp tested only in the middle is a clamp not tested.
        expect(isWeightMultiplierInRange(WEIGHT_MULTIPLIER_MIN)).toBe(true);
        expect(isWeightMultiplierInRange(WEIGHT_MULTIPLIER_MAX)).toBe(true);
    });

    it('rejects just outside, in both directions', () => {
        expect(isWeightMultiplierInRange(WEIGHT_MULTIPLIER_MIN - 0.01)).toBe(false);
        expect(isWeightMultiplierInRange(WEIGHT_MULTIPLIER_MAX + 0.01)).toBe(false);
    });

    it('treats null as legal, because null IS a setting', () => {
        // "Use the tenant default" is a state, not a missing value: the whole
        // reason the control renders a sentence there rather than an empty box.
        expect(isWeightMultiplierInRange(null)).toBe(true);
    });

    it.each([
        ['NaN', Number.NaN],
        ['Infinity', Number.POSITIVE_INFINITY],
        ['-Infinity', Number.NEGATIVE_INFINITY],
    ])('rejects %s, which a number input can produce', (_label, value) => {
        // An unparseable field is where a range check written as two comparisons
        // quietly passes: NaN >= 0.5 is false, but so is NaN < 0.5, so a test
        // that only checks one side of the comparison can miss it entirely.
        expect(isWeightMultiplierInRange(value)).toBe(false);
    });
});

describe('what a summary line says about the weight', () => {
    it('says NOTHING on the default, so the exceptions stand out', () => {
        // `null` is the ordinary state. Naming it on every row would bury the
        // overrides the line exists to reveal.
        expect(describeWeightMultiplier(null)).toBeNull();
    });

    it('treats an absent value exactly like null', () => {
        // The field is optional on the shared type, so a caller that has not
        // been updated renders correctly rather than printing "undefined×".
        expect(describeWeightMultiplier(undefined)).toBeNull();
    });

    it('names the factor when one is OVERRIDDEN', () => {
        expect(describeWeightMultiplier(1.5)).toBe('counts 1.5×');
        expect(describeWeightMultiplier(WEIGHT_MULTIPLIER_MIN)).toBe('counts 0.5×');
    });
});
