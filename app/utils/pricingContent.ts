import type { Translate } from '~/composables/i18n';
import type { PriceInput } from '~/utils/pricingModel';
import {
    ADMIN_SEAT_FEE, BASE_TIERS, LOAD_BANDS,
    complexityTiers, formatCount, formatEuro, formatMultiplier,
    loadBands, resolveSupportTier, sessionRange, studentRange,
} from '~/utils/pricingModel';
import type { MessageKey } from '~~/i18n/keys';

/**
 * Copy and figures for the public pricing page, in one typed module.
 *
 * SAME RULE AS `landingContent`: the page's factual content lives here so that a
 * claim can be checked in one file rather than across five templates, and so
 * that a test can assert the page renders exactly these figures.
 *
 * SINCE ISSUE #19 THE COPY IS NOT HERE, only the structure that arranges it:
 * every sentence is a key in the `pricing` message namespace and every builder
 * below takes a `Translate`. The figures stay here, as numbers, and are
 * formatted at render against the viewer's full locale, so a German reader gets
 * `4.000 €` where an English one gets `€4,000`. Nothing on this page is a
 * pre-formatted price string any more, which also settled a duplication that
 * predated the translation: the rate tables used to restate the base fees, the
 * lecturer rates and the complexity multipliers as hand-typed text beside
 * `pricingModel`'s own numbers, so the published table and the calculator could
 * disagree. They are now the same values, read once.
 *
 * WHAT IS DELIBERATELY NOT HERE, because the source document it came from is an
 * internal one and these parts are not customer-facing:
 *
 *   - the cost-base breakdown (what each euro recovers internally)
 *   - the ARR sanity check: fixed-cost estimate, team size, target contract
 *     value, portfolio size
 *   - the internal loaded cost of onboarding labour
 *   - the negotiated-discount lever, which is a sales instrument and stops
 *     being one the moment a page announces it exists
 *   - the platform-expansion sequencing and the community/retention strategy
 *
 * Publishing the RATE CARD itself is deliberate and is the strategy: transparent
 * pricing is one of the two things the product leads with. Publishing the cost
 * structure behind it is not the same decision and has not been taken.
 *
 * THE FIGURES ARE NOT VALIDATED AGAINST ACTUALS YET. That is stated on the page
 * (`pricing.caveat.text`) rather than kept as a footnote here, because a reader
 * planning a budget around these numbers needs to know how firm they are.
 */

/** A row of a rate table: a band, what defines it, and what it costs. */
export interface RateRow {
    id: string;
    /** The band's name, e.g. `S` or `Standard`. */
    tier: string;
    /** What puts an institution in this band. */
    basis: string;
    /** The figure, formatted for the viewer's locale. */
    price: string;
    /** An optional second figure, used by the base table's federation column. */
    extra?: string;
}

/** One rate table, with its own heading and column labels. */
export interface RateTable {
    id: string;
    title: string;
    note: string;
    basisLabel: string;
    priceLabel: string;
    extraLabel?: string;
    rows: RateRow[];
}

/** One of the arguments the price rests on, resolved for rendering. */
export interface PricingBasisPoint {
    id: string;
    title: string;
    body: string;
}

/**
 * WHAT DRIVES THE PRICE, in plain language, before any number appears.
 *
 * This is the part of the model worth leading with: it is the argument, and the
 * numbers are only its consequence. An institution that disagrees with the
 * basis will not be talked round by a rate card.
 */
const PRICING_BASIS_KEYS = [
    {
        id: 'measured',
        title: 'pricing.basis.measured.title',
        body: 'pricing.basis.measured.body',
    },
    {
        id: 'lecturers',
        title: 'pricing.basis.lecturers.title',
        body: 'pricing.basis.lecturers.body',
    },
    {
        id: 'students',
        title: 'pricing.basis.students.title',
        body: 'pricing.basis.students.body',
    },
    {
        id: 'complexity',
        title: 'pricing.basis.complexity.title',
        body: 'pricing.basis.complexity.body',
    },
] as const satisfies readonly { id: string; title: MessageKey; body: MessageKey }[];

export function pricingBasis(t: Translate): PricingBasisPoint[] {
    return PRICING_BASIS_KEYS.map(point => ({
        id: point.id,
        title: t(point.title),
        body: t(point.body),
    }));
}

/**
 * The three banded tables, derived from the model rather than restating it.
 *
 * Row ids are unchanged from when these were literals (`base-s`, `load-light`,
 * `cx-xl`): they are `v-for` keys and in-page anchors, not copy.
 */
export function rateTables(t: Translate, locale: string): RateTable[] {
    return [
        {
            id: 'base',
            title: t('pricing.rateTable.base.title'),
            note: t('pricing.rateTable.base.note'),
            basisLabel: t('pricing.rateTable.base.basisLabel'),
            priceLabel: t('pricing.rateTable.base.priceLabel'),
            extraLabel: t('pricing.rateTable.base.extraLabel'),
            rows: BASE_TIERS.map(tier => ({
                id: `base-${ tier.id.toLowerCase() }`,
                tier: tier.id,
                basis: studentRange(tier, t, locale),
                price: formatEuro(tier.fee, locale),
                extra: formatEuro(tier.federationAddon, locale),
            })),
        },
        {
            id: 'lecturer',
            title: t('pricing.rateTable.lecturer.title'),
            note: t('pricing.rateTable.lecturer.note'),
            basisLabel: t('pricing.rateTable.lecturer.basisLabel'),
            priceLabel: t('pricing.rateTable.lecturer.priceLabel'),
            rows: loadBands(t, locale).map(band => ({
                id: `load-${ band.id }`,
                tier: band.label,
                basis: sessionRange(band, t, locale),
                price: formatEuro(band.rate, locale),
            })),
        },
        {
            id: 'complexity',
            title: t('pricing.rateTable.complexity.title'),
            note: t('pricing.rateTable.complexity.note'),
            basisLabel: t('pricing.rateTable.complexity.basisLabel'),
            priceLabel: t('pricing.rateTable.complexity.priceLabel'),
            rows: complexityTiers(t).map(tier => ({
                id: `cx-${ tier.id.toLowerCase() }`,
                tier: tier.id,
                basis: tier.meaning,
                price: formatMultiplier(tier.multiplier, t, locale),
            })),
        },
    ];
}

/**
 * Figures that appear ONLY on the flat-rate table, so they live here rather
 * than in `pricingModel`: `computePrice` deliberately excludes one-time
 * onboarding, and an hourly rate is not part of an annual bill either.
 */
const PARTNER_HOURLY_RATE = 200;
const ONBOARDING_STANDARD = { from: 3000, to: 5000 };
const ONBOARDING_FULL = { from: 10000, to: 18000 };

/** Everything that is a flat line item rather than a band. */
export function flatRates(t: Translate, locale: string): RateRow[] {
    return [
        {
            id: 'seat',
            tier: t('pricing.flat.seat.tier'),
            basis: t('pricing.flat.seat.basis'),
            price: t('pricing.flat.seat.price', { amount: formatEuro(ADMIN_SEAT_FEE, locale) }),
        },
        {
            id: 'support-standard',
            tier: t('pricing.flat.supportStandard.tier'),
            basis: t('pricing.flat.supportStandard.basis'),
            price: t('pricing.flat.supportStandard.price'),
        },
        {
            id: 'support-priority',
            tier: t('pricing.flat.supportPriority.tier'),
            basis: t('pricing.flat.supportPriority.basis'),
            price: t('pricing.flat.supportPriority.price', {
                amount: formatEuro(resolveSupportTier('priority').fee, locale),
            }),
        },
        {
            id: 'support-partner',
            tier: t('pricing.flat.supportPartner.tier'),
            basis: t('pricing.flat.supportPartner.basis'),
            price: t('pricing.flat.supportPartner.price', {
                amount: formatEuro(resolveSupportTier('partner').fee, locale),
                hourly: formatEuro(PARTNER_HOURLY_RATE, locale),
            }),
        },
        {
            id: 'onboarding-standard',
            tier: t('pricing.flat.onboardingStandard.tier'),
            basis: t('pricing.flat.onboardingStandard.basis'),
            price: t('pricing.flat.onboardingStandard.price', {
                from: formatEuro(ONBOARDING_STANDARD.from, locale),
                to: formatEuro(ONBOARDING_STANDARD.to, locale),
            }),
        },
        {
            id: 'onboarding-full',
            tier: t('pricing.flat.onboardingFull.tier'),
            basis: t('pricing.flat.onboardingFull.basis'),
            price: t('pricing.flat.onboardingFull.price', {
                from: formatEuro(ONBOARDING_FULL.from, locale),
                to: formatEuro(ONBOARDING_FULL.to, locale),
            }),
        },
        {
            id: 'onboarding-federation',
            tier: t('pricing.flat.onboardingFederation.tier'),
            basis: t('pricing.flat.onboardingFederation.basis'),
            price: t('pricing.flat.onboardingFederation.price'),
        },
    ];
}

/**
 * WORKED EXAMPLES, defined as CALCULATOR INPUTS rather than as printed totals.
 *
 * They used to be four hand-typed figures copied from an internal document, and
 * they were not reproducible: the document stated a headcount, a lecturer count
 * and a complexity tier, but not the load-band mix, the seat count or the
 * support tier, so plugging its scenarios into the rate card gave different
 * answers. On a page whose entire argument is that its numbers are checkable,
 * shipping four totals the page's own calculator contradicts would have been the
 * worst possible bug. Every figure now comes out of `computePrice`.
 *
 * The totals therefore differ from the source document's approximations. The
 * shape of the argument is unchanged and is the reason these four were chosen:
 * the large regular university and the medium scattered one are the pair to
 * read together, because the smaller institution costs substantially more, and
 * only measured complexity explains it.
 *
 * `input` doubles as the calculator's preset, so clicking an example loads the
 * exact configuration its figure was computed from.
 *
 * THE HEADCOUNTS ARE NOT REPEATED IN THE COPY EITHER. Each `shape` sentence
 * used to open with "2,500 students and 110 lecturers", typed out beside the
 * very input it described; both numbers are now interpolated from `input`, so a
 * changed preset cannot leave its own description behind.
 */
export const SCENARIOS = [
    {
        id: 'a',
        input: {
            students: 2500,
            lecturers: { light: 50, standard: 40, heavy: 20 },
            complexity: { entanglement: 0.85, nesting: 0.85, variance: 0.85, constraints: 0.85 },
            adminSeats: 6,
            federation: false,
            support: 'standard',
        },
    },
    {
        id: 'b',
        input: {
            students: 20000,
            lecturers: { light: 100, standard: 400, heavy: 100 },
            complexity: { entanglement: 0.15, nesting: 0.15, variance: 0.15, constraints: 0.15 },
            adminSeats: 12,
            federation: false,
            support: 'priority',
        },
    },
    {
        id: 'c',
        input: {
            students: 12000,
            lecturers: { light: 40, standard: 280, heavy: 130 },
            complexity: { entanglement: 0.85, nesting: 0.85, variance: 0.85, constraints: 0.85 },
            adminSeats: 10,
            federation: false,
            support: 'priority',
        },
    },
    {
        id: 'd',
        input: {
            students: 400,
            lecturers: { light: 5, standard: 18, heavy: 2 },
            complexity: { entanglement: 0.15, nesting: 0.15, variance: 0.15, constraints: 0.15 },
            adminSeats: 2,
            federation: false,
            support: 'standard',
        },
    },
] as const satisfies readonly { id: string; input: PriceInput }[];

/** A worked example with its copy resolved. */
export interface PricingScenario {
    id: string;
    short: string;
    title: string;
    shape: string;
    input: PriceInput;
}

const SCENARIO_KEYS: Record<
    (typeof SCENARIOS)[number]['id'],
    { short: MessageKey; title: MessageKey; shape: MessageKey }
> = {
    a: { short: 'pricing.scenario.a.short', title: 'pricing.scenario.a.title', shape: 'pricing.scenario.a.shape' },
    b: { short: 'pricing.scenario.b.short', title: 'pricing.scenario.b.title', shape: 'pricing.scenario.b.shape' },
    c: { short: 'pricing.scenario.c.short', title: 'pricing.scenario.c.title', shape: 'pricing.scenario.c.shape' },
    d: { short: 'pricing.scenario.d.short', title: 'pricing.scenario.d.title', shape: 'pricing.scenario.d.shape' },
};

export function pricingScenarios(t: Translate, locale: string): PricingScenario[] {
    return SCENARIOS.map((scenario) => {
        const keys = SCENARIO_KEYS[scenario.id];
        const lecturers = LOAD_BANDS.reduce(
            (sum, band) => sum + scenario.input.lecturers[band.id],
            0,
        );

        return {
            id: scenario.id,
            short: t(keys.short),
            title: t(keys.title),
            shape: t(keys.shape, {
                students: formatCount(scenario.input.students, locale),
                lecturers: formatCount(lecturers, locale),
            }),
            input: scenario.input,
        };
    });
}
