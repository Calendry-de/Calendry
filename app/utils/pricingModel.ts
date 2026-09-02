import type { Translate } from '~/composables/i18n';
import { formatNumber } from '~/utils/formatNumber';
import type { MessageKey } from '~~/i18n/keys';

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
 * Everything here is a pure function of its input. No refs, no reactivity, and
 * no copy: the bands hold NUMBERS and their labels live in the message
 * catalogue (`pricing` namespace), reached through the small builder functions
 * below. That split is what issue #19 needed and what the module wanted
 * anyway: `computePrice` is arithmetic and must stay callable from a plain
 * Node test with no Nuxt instance and no catalogue loaded, so it takes no
 * translator. Presentation is `describePriceLines()`, one step later.
 *
 * KEYS ARE WRITTEN OUT LITERALLY, in a `Record` per id, rather than built as
 * `pricing.loadBand.${ id }.label`. A computed specifier is invisible to
 * `MessageKey`, so a renamed or deleted key would compile clean and render a
 * raw dotted path; a `Record<Id, MessageKey>` is checked in both directions,
 * naming a missing id and a missing key alike.
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

/**
 * A lecturer load band, chosen by sessions taught in a normal week.
 *
 * The session bounds are numbers rather than the prose they used to be
 * (`'1 to 4 a week'`): the range appears twice on the page in two different
 * sentences, and a German reader needs `1.500` where an English one needs
 * `1,500`, which a baked-in string cannot give either of them.
 */
export interface LoadBand {
    id: 'light' | 'standard' | 'heavy';
    /** Inclusive lower bound of weekly sessions. */
    fromSessions: number;
    /** Inclusive upper bound, or `null` for the open-ended top band. */
    toSessions: number | null;
    rate: number;
}

export const LOAD_BANDS: LoadBand[] = [
    { id: 'light', fromSessions: 1, toSessions: 4, rate: 70 },
    { id: 'standard', fromSessions: 5, toSessions: 8, rate: 140 },
    { id: 'heavy', fromSessions: 9, toSessions: null, rate: 240 },
];

/** A load band with its copy resolved: `Light`, `1 to 4 a week`. */
export interface LoadBandCopy extends LoadBand {
    label: string;
    sessions: string;
}

const LOAD_BAND_LABEL_KEYS: Record<LoadBand['id'], MessageKey> = {
    light: 'pricing.loadBand.light.label',
    standard: 'pricing.loadBand.standard.label',
    heavy: 'pricing.loadBand.heavy.label',
};

export function loadBands(t: Translate, locale: string): LoadBandCopy[] {
    return LOAD_BANDS.map(band => ({
        ...band,
        label: t(LOAD_BAND_LABEL_KEYS[band.id]),
        sessions: weeklySessionRange(band, t, locale),
    }));
}

/** How many lecturers sit in each load band. */
export type LecturerCounts = Record<LoadBand['id'], number>;

export interface ComplexityTier {
    id: 'S' | 'M' | 'L' | 'XL';
    /** Inclusive lower bound of the normalised score. */
    from: number;
    /** Exclusive upper bound, except on the top band where it is inclusive. */
    to: number;
    multiplier: number;
}

export const COMPLEXITY_TIERS: ComplexityTier[] = [
    { id: 'S', from: 0, to: 0.25, multiplier: 1 },
    { id: 'M', from: 0.25, to: 0.5, multiplier: 1.3 },
    { id: 'L', from: 0.5, to: 0.75, multiplier: 1.7 },
    { id: 'XL', from: 0.75, to: 1, multiplier: 2.2 },
];

/** A complexity tier with the sentence that says what it means. */
export interface ComplexityTierCopy extends ComplexityTier {
    meaning: string;
}

const COMPLEXITY_TIER_MEANING_KEYS: Record<ComplexityTier['id'], MessageKey> = {
    S: 'pricing.complexityTier.s.meaning',
    M: 'pricing.complexityTier.m.meaning',
    L: 'pricing.complexityTier.l.meaning',
    XL: 'pricing.complexityTier.xl.meaning',
};

export function complexityTiers(t: Translate): ComplexityTierCopy[] {
    return COMPLEXITY_TIERS.map(tier => ({
        ...tier,
        meaning: t(COMPLEXITY_TIER_MEANING_KEYS[tier.id]),
    }));
}

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
    weight: number;
}

export const COMPLEXITY_FACTORS: ComplexityFactor[] = [
    { id: 'entanglement', weight: 0.25 },
    { id: 'nesting', weight: 0.25 },
    { id: 'variance', weight: 0.25 },
    { id: 'constraints', weight: 0.25 },
];

/** A factor with its name and, in `measure`, what is actually measured. */
export interface ComplexityFactorCopy extends ComplexityFactor {
    label: string;
    measure: string;
}

const COMPLEXITY_FACTOR_KEYS: Record<
    ComplexityFactor['id'],
    { label: MessageKey; measure: MessageKey }
> = {
    entanglement: {
        label: 'pricing.complexityFactor.entanglement.label',
        measure: 'pricing.complexityFactor.entanglement.measure',
    },
    nesting: {
        label: 'pricing.complexityFactor.nesting.label',
        measure: 'pricing.complexityFactor.nesting.measure',
    },
    variance: {
        label: 'pricing.complexityFactor.variance.label',
        measure: 'pricing.complexityFactor.variance.measure',
    },
    constraints: {
        label: 'pricing.complexityFactor.constraints.label',
        measure: 'pricing.complexityFactor.constraints.measure',
    },
};

export function complexityFactors(t: Translate): ComplexityFactorCopy[] {
    return COMPLEXITY_FACTORS.map(factor => ({
        ...factor,
        label: t(COMPLEXITY_FACTOR_KEYS[factor.id].label),
        measure: t(COMPLEXITY_FACTOR_KEYS[factor.id].measure),
    }));
}

export type ComplexityInput = Record<ComplexityFactor['id'], number>;

export type SupportTierId = 'standard' | 'priority' | 'partner';

export interface SupportTier {
    id: SupportTierId;
    fee: number;
}

export const SUPPORT_TIERS: SupportTier[] = [
    { id: 'standard', fee: 0 },
    { id: 'priority', fee: 3000 },
    { id: 'partner', fee: 12000 },
];

/** A support tier with its name and one line of what it buys. */
export interface SupportTierCopy extends SupportTier {
    label: string;
    detail: string;
}

const SUPPORT_TIER_KEYS: Record<SupportTierId, { label: MessageKey; detail: MessageKey }> = {
    standard: { label: 'pricing.supportTier.standard.label', detail: 'pricing.supportTier.standard.detail' },
    priority: { label: 'pricing.supportTier.priority.label', detail: 'pricing.supportTier.priority.detail' },
    partner: { label: 'pricing.supportTier.partner.label', detail: 'pricing.supportTier.partner.detail' },
};

export function supportTiers(t: Translate): SupportTierCopy[] {
    return SUPPORT_TIERS.map(tier => ({
        ...tier,
        label: t(SUPPORT_TIER_KEYS[tier.id].label),
        detail: t(SUPPORT_TIER_KEYS[tier.id].detail),
    }));
}

export const ADMIN_SEAT_FEE = 350;

/**
 * German statutory VAT, as a fraction.
 *
 * EVERY OTHER NUMBER IN THIS MODULE IS OURS AND THIS ONE IS NOT: it is set by
 * the legislature, not by a pricing decision, which is why it sits alone here
 * rather than in a band table and why changing it is never a judgement call.
 * Software licensed to an institution is standard-rated; the reduced rate and
 * the teaching exemption in section 4 no. 21 UStG both cover teaching
 * SERVICES, which is not what is sold here.
 *
 * DOMESTIC ONLY, deliberately. A customer with a VAT id outside Germany would
 * be invoiced under the reverse-charge procedure with no VAT at all, and the
 * calculator does not ask where the institution is, so it cannot know. It is a
 * planning tool for a German buyer and the page says so; an invoice is a
 * different artefact and is not generated from this module.
 */
export const VAT_RATE = 0.19;

/** Everything the calculator lets a visitor set. */
export interface PriceInput {
    students: number;
    lecturers: LecturerCounts;
    complexity: ComplexityInput;
    adminSeats: number;
    federation: boolean;
    support: SupportTierId;
}

/**
 * One line of the breakdown, in the order it is charged.
 *
 * A UNION RATHER THAN A BARE `string`, so `describePriceLines()`'s switch is
 * exhaustiveness-checked: a line added here without copy is a typecheck error
 * rather than a blank label on a price.
 */
export type PriceLineId = 'base' | 'lecturers' | 'seats' | 'federation' | 'support';

export interface PriceLine {
    id: PriceLineId;
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
    /**
     * The sum of `lines`, and the whole annual price.
     *
     * `total` is kept alongside it, identical, rather than removed: it is what
     * every caller asks for, and a page reading `subtotal` to print "total"
     * would be relying on the two being equal, which is true only while
     * nothing is ever subtracted. See `computePrice` on the discount that
     * used to sit between them.
     */
    subtotal: number;
    total: number;
    /**
     * VAT on `total`, rounded to the euro.
     *
     * ROUNDED ONCE, HERE, for the same reason `lecturerTotal` is: the printed
     * net, the printed VAT and the printed gross have to add up on screen, and
     * a fraction of a cent surviving into `gross` is a price that looks like it
     * cannot do arithmetic.
     */
    vat: number;
    /**
     * `total` plus `vat`: what a German institution is actually invoiced.
     *
     * A SEPARATE FIELD RATHER THAN A REPLACEMENT FOR `total`. `total` is the
     * net annual price and stays the headline figure, because that is the
     * number an institution budgets with and the number every published rate
     * table states; a page whose calculator answered gross while its tables
     * answered net would be two different prices under one argument.
     */
    gross: number;
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
 *
 * The one-time onboarding fee is deliberately absent: it is billed separately
 * and folding it into an annual figure would overstate year one and understate
 * every year after.
 *
 * VAT IS COMPUTED BUT NOT ADDED TO `total`, which stays net. See `gross`.
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
        { id: 'base', amount: baseTier.fee },
        { id: 'lecturers', amount: lecturerTotal },
        { id: 'seats', amount: seats },
        { id: 'federation', amount: federation },
        { id: 'support', amount: support.fee },
    ];

    const subtotal = lines.reduce((sum, line) => sum + line.amount, 0);

    const vat = Math.round(subtotal * VAT_RATE);

    return {
        baseTier,
        complexityScore: score,
        complexityTier: tier,
        lecturerBase,
        lecturerTotal,
        lecturerCount,
        lines,
        subtotal,
        total: subtotal,
        vat,
        gross: subtotal + vat,
    };
}

/** A breakdown line with the copy that names it. */
export interface PriceLineCopy extends PriceLine {
    label: string;
    detail: string;
}

/**
 * The breakdown, ready to render.
 *
 * SEPARATE FROM `computePrice` on purpose. The arithmetic is pinned by a plain
 * Node test that loads no catalogue and has no Nuxt instance, so making it take
 * a translator would have meant threading a `(key) => key` stub through twenty
 * assertions that are about euros. Instead the labels are resolved one step
 * later, here, from the result the test already checks.
 */
export function describePriceLines(
    input: PriceInput,
    result: PriceResult,
    t: Translate,
    locale: string,
): PriceLineCopy[] {
    return result.lines.map(line => ({ ...line, ...lineCopy(line.id, input, result, t, locale) }));
}

function lineCopy(
    id: PriceLineId,
    input: PriceInput,
    result: PriceResult,
    t: Translate,
    locale: string,
): { label: string; detail: string } {
    switch (id) {
        case 'base':
            return {
                label: t('pricing.line.base.label'),
                detail: t('pricing.line.base.detail', {
                    tier: result.baseTier.id,
                    students: formatCount(input.students, locale),
                }),
            };
        case 'lecturers':
            return {
                label: t('pricing.line.lecturers.label'),
                detail: t('pricing.line.lecturers.detail', {
                    lecturers: formatCount(result.lecturerCount, locale),
                    multiplier: formatMultiplier(result.complexityTier.multiplier, t, locale),
                }),
            };
        case 'seats':
            return {
                label: t('pricing.line.seats.label'),
                detail: t('pricing.line.seats.detail', {
                    seats: formatCount(Math.max(0, input.adminSeats), locale),
                    fee: formatEuro(ADMIN_SEAT_FEE, locale),
                }),
            };
        case 'federation':
            return {
                label: t('pricing.line.federation.label'),
                detail: input.federation
                    ? t('pricing.line.federation.detail', { tier: result.baseTier.id })
                    : t('pricing.line.federation.detailNone'),
            };
        case 'support': {
            const tier = resolveSupportTier(input.support);
            return {
                label: t('pricing.line.support.label', { tier: t(SUPPORT_TIER_KEYS[tier.id].label) }),
                detail: t(SUPPORT_TIER_KEYS[tier.id].detail),
            };
        }
    }
}

/**
 * A band's bounds as one phrase: `0 to 1,499`, `15,000 or more`.
 *
 * The sentence is a message and the numbers are formatted against the viewer's
 * full locale, because those are two different axes: `t()` follows the message
 * language and `1.500` against `1,500` follows the region the language discards.
 */
interface RangeKeys {
    closed: MessageKey;
    open: MessageKey;
}

const PLAIN_RANGE_KEYS: RangeKeys = {
    closed: 'pricing.format.rangeClosed',
    open: 'pricing.format.rangeOpen',
};

const WEEKLY_RANGE_KEYS: RangeKeys = {
    closed: 'pricing.format.rangeClosedWeekly',
    open: 'pricing.format.rangeOpenWeekly',
};

function numberRange(
    from: number,
    to: number | null,
    keys: RangeKeys,
    t: Translate,
    locale: string,
): string {
    return to === null
        ? t(keys.open, { from: formatCount(from, locale) })
        : t(keys.closed, { from: formatCount(from, locale), to: formatCount(to, locale) });
}

/** `0 to 1,499`, the base package's headcount band. */
export function studentRange(tier: BaseTier, t: Translate, locale: string): string {
    return numberRange(tier.from, tier.to, PLAIN_RANGE_KEYS, t, locale);
}

/** `1 to 4`, a load band's weekly sessions, for a column already headed as such. */
export function sessionRange(band: LoadBand, t: Translate, locale: string): string {
    return numberRange(band.fromSessions, band.toSessions, PLAIN_RANGE_KEYS, t, locale);
}

/** `1 to 4 a week`, the same band where the sentence has to say so itself. */
export function weeklySessionRange(band: LoadBand, t: Translate, locale: string): string {
    return numberRange(band.fromSessions, band.toSessions, WEEKLY_RANGE_KEYS, t, locale);
}

/**
 * `€4,000` for an English reader, `4.000 €` for a German one.
 *
 * THE SYMBOL'S SIDE IS NOT OURS TO CHOOSE, which is why this is
 * `style: 'currency'` and not a `€` glued onto a formatted number. It was the
 * latter, with the locale hardcoded to `en-GB`, so a German reader would have
 * been shown `€4,000`: the wrong separator, the wrong decimal comma and the
 * symbol on the wrong side of the amount, all in a figure that still looked
 * like a plausible price. `Intl` knows all three, per locale, and also puts the
 * minus sign of a discount line in the right place.
 *
 * No decimals: nothing in this model is priced in cents.
 */
export function formatEuro(amount: number, locale: string): string {
    return formatNumber(Math.round(amount), locale, {
        style: 'currency',
        currency: 'EUR',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    });
}

/**
 * `19%` for an English reader, `19 %` for a German one.
 *
 * `Intl` again, and for the same reason `formatEuro` is: the space before the
 * sign is not optional in German typography and is not present in English, and
 * a `${ rate * 100 }%` template gets one of the two readers wrong. Takes the
 * fraction, not the percentage, so the call site cannot drift from `VAT_RATE`
 * by multiplying it twice.
 */
export function formatPercent(fraction: number, locale: string): string {
    return formatNumber(fraction, locale, {
        style: 'percent',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    });
}

/** `20,000`, or `20.000`. Same separator as the money, so a table reads consistently. */
export function formatCount(value: number, locale: string): string {
    return formatNumber(Math.round(value), locale);
}

/**
 * `1.0x`, or `1,0x`.
 *
 * One decimal always, so a column of multipliers lines up, and the `x` comes
 * from a message rather than a template literal: it is a word-shaped suffix,
 * and a translator has to be able to move or replace it.
 */
export function formatMultiplier(multiplier: number, t: Translate, locale: string): string {
    return t('pricing.format.multiplier', {
        value: formatNumber(multiplier, locale, {
            minimumFractionDigits: 1,
            maximumFractionDigits: 1,
        }),
    });
}
