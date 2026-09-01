/**
 * The price model, as pure functions over plain numbers.
 *
 * WHY IT IS A MODULE AND NOT A COMPONENT'S SETUP BLOCK. Three things need the
 * same arithmetic and must not disagree: the calculator a visitor drags, the
 * worked examples printed on the page, and any test that pins either. The
 * scenario totals used to be typed in by hand from an internal document, which
 * meant the page could state a figure the calculator would not reproduce, on a
 * page whose whole argument is that its numbers are checkable.
 *
 * Everything here is a pure function of its input. No refs, no reactivity, no
 * formatting decisions beyond `formatEuro`.
 */

/** A band of the base package fee, chosen by student headcount. */
export interface BaseTier {
    id: 'S' | 'M' | 'L' | 'XL';
    /** Inclusive lower bound. */
    from: number;
    /** Inclusive upper bound, or `null` for the open-ended top band. */
    to: number | null;
    fee: number;
    federationAddon: number;
}

export const BASE_TIERS: BaseTier[] = [
    { id: 'S', from: 0, to: 1499, fee: 4000, federationAddon: 4000 },
    { id: 'M', from: 1500, to: 5999, fee: 10000, federationAddon: 4000 },
    { id: 'L', from: 6000, to: 14999, fee: 20000, federationAddon: 8000 },
    { id: 'XL', from: 15000, to: null, fee: 35000, federationAddon: 12000 },
];

/** A lecturer load band, chosen by sessions taught in a normal week. */
export interface LoadBand {
    id: 'light' | 'standard' | 'heavy';
    label: string;
    sessions: string;
    rate: number;
}

export const LOAD_BANDS: LoadBand[] = [
    { id: 'light', label: 'Light', sessions: '1 to 4 a week', rate: 70 },
    { id: 'standard', label: 'Standard', sessions: '5 to 8 a week', rate: 140 },
    { id: 'heavy', label: 'Heavy', sessions: '9 or more a week', rate: 240 },
];

/** How many lecturers sit in each load band. */
export type LecturerCounts = Record<LoadBand['id'], number>;

export interface ComplexityTier {
    id: 'S' | 'M' | 'L' | 'XL';
    /** Inclusive lower bound of the normalised score. */
    from: number;
    /** Exclusive upper bound, except on the top band where it is inclusive. */
    to: number;
    multiplier: number;
    meaning: string;
}

export const COMPLEXITY_TIERS: ComplexityTier[] = [
    {
        id: 'S',
        from: 0,
        to: 0.25,
        multiplier: 1,
        meaning: 'Mostly fixed weekly patterns, few rooms and groups per lecturer',
    },
    { id: 'M', from: 0.25, to: 0.5, multiplier: 1.3, meaning: 'Some variation, moderate spread' },
    {
        id: 'L',
        from: 0.5,
        to: 0.75,
        multiplier: 1.7,
        meaning: 'High variation, wide spread, deep group nesting',
    },
    {
        id: 'XL',
        from: 0.75,
        to: 1,
        multiplier: 2.2,
        meaning: 'Very scattered, heavy cross-group and federation interaction',
    },
];

/**
 * The four factors the complexity score is built from, each normalised to 0..1.
 *
 * THE WEIGHTS ARE NOT CALIBRATED and are deliberately equal. The model names
 * four weights and does not yet fix their values, because there is no corpus of
 * real tenants to fit them against. Equal quarters is the honest placeholder: it
 * asserts only that all four matter, which is the part that has been decided.
 * Anything else would be a fitted-looking number nobody fitted.
 */
export interface ComplexityFactor {
    id: 'entanglement' | 'nesting' | 'variance' | 'constraints';
    label: string;
    /** What the raw measurement is, before normalising. */
    measure: string;
    weight: number;
}

export const COMPLEXITY_FACTORS: ComplexityFactor[] = [
    {
        id: 'entanglement',
        label: 'Entanglement',
        measure: 'Average groups per session, saturating at a cap',
        weight: 0.25,
    },
    {
        id: 'nesting',
        label: 'Nesting depth',
        measure: 'Average group-tree depth against your deepest tree',
        weight: 0.25,
    },
    {
        id: 'variance',
        label: 'Slot variance',
        measure: 'How much a lecturer’s pattern moves week to week',
        weight: 0.25,
    },
    {
        id: 'constraints',
        label: 'Constraint density',
        measure: 'Active constraint weight, saturating at a cap',
        weight: 0.25,
    },
];

export type ComplexityInput = Record<ComplexityFactor['id'], number>;

export type SupportTierId = 'standard' | 'priority' | 'partner';

export interface SupportTier {
    id: SupportTierId;
    label: string;
    fee: number;
    detail: string;
}

export const SUPPORT_TIERS: SupportTier[] = [
    { id: 'standard', label: 'Standard', fee: 0, detail: 'Included with every base package' },
    {
        id: 'priority',
        label: 'Priority',
        fee: 3000,
        detail: 'Eight-hour response, direct channel, quarterly roadmap call',
    },
    {
        id: 'partner',
        label: 'Partner retainer',
        fee: 12000,
        detail: 'Around sixty development hours a year for work you specify',
    },
];

export const ADMIN_SEAT_FEE = 350;

/** Everything the calculator lets a visitor set. */
export interface PriceInput {
    students: number;
    lecturers: LecturerCounts;
    complexity: ComplexityInput;
    adminSeats: number;
    federation: boolean;
    support: SupportTierId;
    /** Whole percent off the recurring subtotal. */
    discountPercent: number;
}

/** One line of the breakdown, in the order it is charged. */
export interface PriceLine {
    id: string;
    label: string;
    detail: string;
    amount: number;
}

export interface PriceResult {
    baseTier: BaseTier;
    complexityScore: number;
    complexityTier: ComplexityTier;
    /** Lecturer cost before the multiplier, kept so the page can show its effect. */
    lecturerBase: number;
    /** Lecturer cost after the multiplier. */
    lecturerTotal: number;
    lecturerCount: number;
    lines: PriceLine[];
    /** Everything before the discount. */
    subtotal: number;
    /** Negative, or zero when no discount is set. */
    discount: number;
    total: number;
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/** The band a headcount falls in. Never returns undefined: the top band is open. */
export function resolveBaseTier(students: number): BaseTier {
    const safe = Math.max(0, students);
    return BASE_TIERS.find(tier => tier.to === null || safe <= tier.to) ?? BASE_TIERS[BASE_TIERS.length - 1]!;
}

/**
 * The weighted sum of the four normalised factors.
 *
 * This is the per-lecturer formula applied to tenant-level averages rather than
 * the full roll-up. The real roll-up weights each lecturer's score by their
 * weekly session count before averaging; a calculator whose inputs are four
 * tenant-wide sliders has already been given the averages, so weighting them
 * again by a load distribution the visitor also typed would double-count it.
 * `rollUpScore` below is the real thing, for a caller that has per-lecturer data.
 */
export function complexityScore(input: ComplexityInput): number {
    const total = COMPLEXITY_FACTORS.reduce(
        (sum, factor) => sum + factor.weight * clamp01(input[factor.id]),
        0,
    );
    const weightSum = COMPLEXITY_FACTORS.reduce((sum, factor) => sum + factor.weight, 0);
    return weightSum === 0 ? 0 : clamp01(total / weightSum);
}

/**
 * The tenant score from per-lecturer scores, each weighted by that lecturer's
 * weekly session count. Not used by the calculator (see `complexityScore`), and
 * exported because it is the definition the page describes.
 */
export function rollUpScore(lecturers: { score: number; weeklySessions: number }[]): number {
    const load = lecturers.reduce((sum, l) => sum + Math.max(0, l.weeklySessions), 0);
    if (load === 0) return 0;
    const weighted = lecturers.reduce(
        (sum, l) => sum + clamp01(l.score) * Math.max(0, l.weeklySessions),
        0,
    );
    return clamp01(weighted / load);
}

/**
 * The band a score falls in.
 *
 * THE BOUNDARY GOES TO THE CHEAPER BAND, which is a pricing decision and not a
 * rounding detail. The published table reads `0.00-0.25 S` and `0.25-0.50 M`,
 * so 0.25 appears in both rows and the code has to break the tie. It breaks it
 * in the customer's favour at every boundary: 0.25 is S, 0.50 is M, 0.75 is L.
 *
 * The comparison is `<=`, not `<`. With `<` a score of exactly 0.25 falls
 * through S into M, which is a silent one-tier overcharge at all three
 * boundaries and, at the 0.25 line, a 30% larger lecturer bill. It is also the
 * bug this function shipped with for one commit, which is why the test pins all
 * three boundaries by value rather than trusting the comment.
 *
 * `<=` on the top band also makes a perfect 1.0 resolve, where `<` would fall
 * off the end into the fallback.
 */
export function resolveComplexityTier(score: number): ComplexityTier {
    const safe = clamp01(score);
    return COMPLEXITY_TIERS.find(tier => safe <= tier.to)
        ?? COMPLEXITY_TIERS[COMPLEXITY_TIERS.length - 1]!;
}

export function resolveSupportTier(id: SupportTierId): SupportTier {
    return SUPPORT_TIERS.find(tier => tier.id === id) ?? SUPPORT_TIERS[0]!;
}

/**
 * The whole annual price.
 *
 *   base(student band)
 * + Σ over load bands (count × rate) × complexity multiplier
 * + admin seats × seat fee
 * + federation add-on, banded with the base package
 * + support tier
 * - discount on all of the above
 *
 * The one-time onboarding fee is deliberately absent: it is billed separately
 * and folding it into an annual figure would overstate year one and understate
 * every year after.
 */
export function computePrice(input: PriceInput): PriceResult {
    const baseTier = resolveBaseTier(input.students);
    const score = complexityScore(input.complexity);
    const tier = resolveComplexityTier(score);
    const support = resolveSupportTier(input.support);

    const lecturerCount = LOAD_BANDS.reduce(
        (sum, band) => sum + Math.max(0, input.lecturers[band.id]),
        0,
    );
    const lecturerBase = LOAD_BANDS.reduce(
        (sum, band) => sum + Math.max(0, input.lecturers[band.id]) * band.rate,
        0,
    );
    // Rounded to the euro here rather than at the end: the multiplier is the
    // only non-integer in the model, and letting a fraction of a cent travel
    // into the subtotal makes the printed lines fail to add up to the printed
    // total by one euro, which looks like a bug in a price.
    const lecturerTotal = Math.round(lecturerBase * tier.multiplier);

    const seats = Math.max(0, input.adminSeats) * ADMIN_SEAT_FEE;
    const federation = input.federation ? baseTier.federationAddon : 0;

    const lines: PriceLine[] = [
        {
            id: 'base',
            label: 'Base package',
            detail: `Tier ${ baseTier.id }, ${ formatCount(input.students) } students`,
            amount: baseTier.fee,
        },
        {
            id: 'lecturers',
            label: 'Lecturers',
            detail: `${ formatCount(lecturerCount) } lecturers at ${ tier.multiplier }x complexity`,
            amount: lecturerTotal,
        },
        {
            id: 'seats',
            label: 'Admin seats',
            detail: `${ formatCount(Math.max(0, input.adminSeats)) } at ${ formatEuro(ADMIN_SEAT_FEE) }`,
            amount: seats,
        },
        {
            id: 'federation',
            label: 'Federation add-on',
            detail: input.federation ? `Banded with tier ${ baseTier.id }` : 'Not a federation member',
            amount: federation,
        },
        {
            id: 'support',
            label: `${ support.label } support`,
            detail: support.detail,
            amount: support.fee,
        },
    ];

    const subtotal = lines.reduce((sum, line) => sum + line.amount, 0);
    const percent = Math.min(100, Math.max(0, input.discountPercent));

    // Negated only when there is something to negate: `-Math.round(x * 0)` is
    // `-0`, which is a value no price should ever hold. It happens to be
    // harmless downstream (`-0 !== 0` is false, so the discount line stays
    // hidden and it formats as "€0"), but a signed zero in a money field is the
    // kind of thing that survives until something less forgiving reads it.
    const discount = percent === 0 ? 0 : -Math.round(subtotal * (percent / 100));

    return {
        baseTier,
        complexityScore: score,
        complexityTier: tier,
        lecturerBase,
        lecturerTotal,
        lecturerCount,
        lines,
        subtotal,
        discount,
        total: subtotal + discount,
    };
}

/** `€4,000`. No decimals: nothing in this model is priced in cents. */
export function formatEuro(amount: number): string {
    return `€${ Math.round(amount).toLocaleString('en-GB') }`;
}

/** `20,000`. Same separator as the money, so a table reads consistently. */
export function formatCount(value: number): string {
    return Math.round(value).toLocaleString('en-GB');
}
