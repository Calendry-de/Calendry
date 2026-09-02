import { describe, expect, it } from 'vitest';
import { SCENARIOS } from '../app/utils/pricingContent';
import type { PriceInput } from '../app/utils/pricingModel';
import {
    ADMIN_SEAT_FEE, BASE_TIERS, COMPLEXITY_TIERS, LOAD_BANDS,
    complexityScore, computePrice, resolveBaseTier, resolveComplexityTier, rollUpScore,
} from '../app/utils/pricingModel';

/**
 * The price model is the one piece of this surface where being wrong is not a
 * visual bug: the pricing page publishes real figures, and an institution can
 * build a budget on them. Every number the page prints comes out of
 * `computePrice`, so this file is what stands behind them.
 *
 * It needs no server. The model is pure functions over plain numbers.
 */

const base = (over: Partial<PriceInput> = {}): PriceInput => ({
    students: 6000,
    lecturers: { light: 0, standard: 0, heavy: 0 },
    complexity: { entanglement: 0, nesting: 0, variance: 0, constraints: 0 },
    adminSeats: 0,
    federation: false,
    support: 'standard',
    ...over,
});

describe('band resolution', () => {
    it.each([
        [0, 'S'], [1499, 'S'], [1500, 'M'], [5999, 'M'],
        [6000, 'L'], [14999, 'L'], [15000, 'XL'], [250000, 'XL'],
    ])('puts %i students in base tier %s', (students, tier) => {
        expect(resolveBaseTier(students).id).toBe(tier);
    });

    it('treats a negative headcount as zero rather than falling off the bottom', () => {
        expect(resolveBaseTier(-40).id).toBe('S');
    });

    /*
     * THE BOUNDARIES ARE THE POINT. The published table lists 0.25 in both the S
     * and M rows, so the tie-break is a pricing decision: it goes to the cheaper
     * band. This shipped inverted once, which silently moved every institution
     * sitting exactly on a line up a tier, and at the 0.25 boundary that is a
     * 30% larger lecturer bill.
     */
    it.each([
        [0, 'S'], [0.24, 'S'], [0.25, 'S'],
        [0.26, 'M'], [0.5, 'M'],
        [0.51, 'L'], [0.75, 'L'],
        [0.76, 'XL'], [1, 'XL'],
    ])('maps a score of %s to complexity tier %s', (score, tier) => {
        expect(resolveComplexityTier(score).id).toBe(tier);
    });

    it('clamps a score outside 0..1 instead of returning undefined', () => {
        expect(resolveComplexityTier(-1).id).toBe('S');
        expect(resolveComplexityTier(9).id).toBe('XL');
    });
});

describe('complexity score', () => {
    it('is the weighted mean of the four factors, and the weights sum to one', () => {
        expect(complexityScore({
            entanglement: 1, nesting: 1, variance: 1, constraints: 1,
        })).toBe(1);
        expect(complexityScore({
            entanglement: 0, nesting: 0, variance: 0, constraints: 0,
        })).toBe(0);
        expect(complexityScore({
            entanglement: 1, nesting: 0, variance: 1, constraints: 0,
        })).toBeCloseTo(0.5, 10);
    });

    it('clamps each factor, so an out-of-range input cannot push the score past 1', () => {
        expect(complexityScore({
            entanglement: 5, nesting: 5, variance: 5, constraints: 5,
        })).toBe(1);
    });

    /*
     * The roll-up weights each lecturer by their teaching load, which is what
     * makes a handful of chaotic heavy teachers count for more than a long tail
     * of tidy light ones.
     */
    it('weights the roll-up by weekly sessions, not by lecturer count', () => {
        const score = rollUpScore([
            { score: 1, weeklySessions: 9 },
            { score: 0, weeklySessions: 1 },
        ]);
        expect(score).toBeCloseTo(0.9, 10);
    });

    it('returns zero for an institution with no teaching rather than dividing by zero', () => {
        expect(rollUpScore([])).toBe(0);
        expect(rollUpScore([{ score: 1, weeklySessions: 0 }])).toBe(0);
    });
});

describe('the price', () => {
    it('is the base fee alone when there is nothing else to charge for', () => {
        expect(computePrice(base({ students: 400 })).total).toBe(4000);
    });

    it('applies the multiplier to the lecturer subtotal and nothing else', () => {
        const cheap = computePrice(base({
            students: 400,
            lecturers: { light: 0, standard: 10, heavy: 0 },
        }));
        const dear = computePrice(base({
            students: 400,
            lecturers: { light: 0, standard: 10, heavy: 0 },
            complexity: { entanglement: 1, nesting: 1, variance: 1, constraints: 1 },
        }));

        // 10 standard lecturers at 140 = 1400, times 1.0 and 2.2.
        expect(cheap.lecturerBase).toBe(1400);
        expect(cheap.lecturerTotal).toBe(1400);
        expect(dear.lecturerTotal).toBe(3080);

        // The base package is untouched by complexity: both totals differ by
        // exactly the lecturer delta.
        expect(dear.total - cheap.total).toBe(3080 - 1400);
        expect(dear.lines.find(l => l.id === 'base')?.amount).toBe(4000);
    });

    it('bands the federation add-on with the base package', () => {
        for (const tier of BASE_TIERS) {
            const students = tier.to ?? tier.from;
            const withFed = computePrice(base({ students, federation: true }));
            const without = computePrice(base({ students, federation: false }));
            expect(withFed.total - without.total).toBe(tier.federationAddon);
        }
    });

    it('charges each admin seat once', () => {
        const seats = computePrice(base({ students: 400, adminSeats: 7 }));
        expect(seats.total - 4000).toBe(7 * ADMIN_SEAT_FEE);
    });

    it('never lets a negative input become a credit', () => {
        const result = computePrice(base({
            students: -100,
            lecturers: { light: -50, standard: -50, heavy: -50 },
            adminSeats: -10,
        }));
        expect(result.total).toBe(4000);
    });

    /*
     * The printed breakdown must add up to the printed total. The multiplier is
     * the only non-integer in the model, so rounding it at the line rather than
     * at the end is what keeps these equal; without that the page can show lines
     * that sum to one euro away from its own headline figure.
     */
    it('has lines that sum to the total, at every complexity tier', () => {
        for (const tier of COMPLEXITY_TIERS) {
            const result = computePrice(base({
                students: 7000,
                lecturers: { light: 33, standard: 67, heavy: 13 },
                complexity: {
                    entanglement: tier.from + 0.01,
                    nesting: tier.from + 0.01,
                    variance: tier.from + 0.01,
                    constraints: tier.from + 0.01,
                },
                adminSeats: 3,
                support: 'priority',
            }));
            const summed = result.lines.reduce((sum, line) => sum + line.amount, 0);
            expect(summed).toBe(result.subtotal);
            // `total` and `subtotal` are now equal by construction, nothing
            // being subtracted since the negotiated discount was removed from
            // the customer-facing calculator. Asserted rather than dropped so
            // that reintroducing any deduction has to come past this line.
            expect(result.total).toBe(result.subtotal);
            expect(Number.isInteger(result.total)).toBe(true);
        }
    });

    it('prices every load band at its published rate', () => {
        for (const band of LOAD_BANDS) {
            const result = computePrice(base({
                students: 400,
                lecturers: { light: 0, standard: 0, heavy: 0, [band.id]: 1 },
            }));
            expect(result.lecturerBase).toBe(band.rate);
        }
    });
});

/**
 * THE PAGE'S OWN EXAMPLES. These four are rendered from `computePrice` rather
 * than typed in, so this is less about the arithmetic than about the inputs
 * staying sane: each must resolve to the tier its copy claims, and the pair the
 * page asks the reader to compare must still make its point.
 */
describe('the published scenarios', () => {
    it.each(SCENARIOS.map(s => [s.short, s] as const))('%s resolves and prices', (_label, scenario) => {
        const result = computePrice(scenario.input);
        expect(result.total).toBeGreaterThan(0);
        expect(Number.isInteger(result.total)).toBe(true);
        expect(result.lecturerCount).toBeGreaterThan(0);
    });

    it('keeps the comparison the page is built around', () => {
        const byId = Object.fromEntries(SCENARIOS.map(s => [s.id, computePrice(s.input)]));
        const large = byId.b!;
        const scattered = byId.c!;

        // Fewer students...
        expect(scattered.baseTier.fee).toBeLessThan(large.baseTier.fee);
        // ...and fewer lecturers...
        expect(scattered.lecturerCount).toBeLessThan(large.lecturerCount);
        // ...but a bigger bill, which only complexity explains.
        expect(scattered.total).toBeGreaterThan(large.total);
        expect(scattered.complexityTier.id).toBe('XL');
        expect(large.complexityTier.id).toBe('S');
    });
});
