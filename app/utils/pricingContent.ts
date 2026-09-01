import type { PriceInput } from '~/utils/pricingModel';

/**
 * Copy and figures for the public pricing page, in one typed module.
 *
 * SAME RULE AS `landingContent`: the page's factual content lives here so that a
 * claim can be checked in one file rather than across five templates, and so
 * that a test can assert the page renders exactly these figures.
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
 * in `RATE_CAVEAT` rather than kept as a footnote here, because a reader
 * planning a budget around these numbers needs to know how firm they are.
 */

/** A row of a rate table: a band, what defines it, and what it costs. */
export interface RateRow {
    id: string;
    /** The band's name, e.g. `S` or `Standard`. */
    tier: string;
    /** What puts an institution in this band. */
    basis: string;
    /** The figure. Pre-formatted, because these are prices and not arithmetic. */
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

/**
 * WHAT DRIVES THE PRICE, in plain language, before any number appears.
 *
 * This is the part of the model worth leading with: it is the argument, and the
 * numbers are only its consequence. An institution that disagrees with the
 * basis will not be talked round by a rate card.
 */
export const PRICING_BASIS = [
    {
        id: 'measured',
        title: 'Measured, not assumed',
        body: 'Pricing is not based on whether you call yourself a school, a Fachhochschule or a '
            + 'university. That is a prior rather than a measurement, and it overcharges the '
            + 'well-organised institution and undercharges the chaotic one of exactly the same '
            + 'size. Everything below is computed from your own data.',
    },
    {
        id: 'lecturers',
        title: 'Per lecturer, weighted by teaching load',
        body: 'The billable unit is a lecturer, banded by how many sessions a week they actually '
            + 'teach. Sessions are the real placed unit the solver works on, they cannot be '
            + 'reorganised on paper to lower a bill, and they match how institutions already '
            + 'describe load: someone teaches eight hours a week.',
    },
    {
        id: 'students',
        title: 'Students are not billed at all',
        body: 'Unlimited, included. A student reads their timetable and receives notifications '
            + 'about it, which costs almost nothing to serve. Charging per head for that would '
            + 'price the product against being used, and a timetable nobody can look at is not '
            + 'worth having.',
    },
    {
        id: 'complexity',
        title: 'Complexity is computed, auditable and revisited',
        body: 'A multiplier comes from the rooms and groups each lecturer touches, how much '
            + 'their weekly pattern varies, and how deeply your groups nest. It is derived from '
            + 'the finished schedule, not self-declared and not guessed by a salesperson, so '
            + 'your own IT staff can check it. It is fixed at the start of a term and revisited '
            + 'when what you actually deliver drifts from that plan, so the price follows your '
            + 'timetable instead of being frozen for the life of a contract.',
    },
] as const;

export const RATE_TABLES: RateTable[] = [
    {
        id: 'base',
        title: 'Base package',
        note: 'One fee per institution, banded by student headcount. Covers hosting, '
            + 'infrastructure and standard support.',
        basisLabel: 'Students',
        priceLabel: 'Per year',
        extraLabel: 'Federation add-on',
        rows: [
            { id: 'base-s', tier: 'S', basis: '0 to 1,499', price: '€4,000', extra: '€4,000' },
            { id: 'base-m', tier: 'M', basis: '1,500 to 5,999', price: '€10,000', extra: '€4,000' },
            { id: 'base-l', tier: 'L', basis: '6,000 to 14,999', price: '€20,000', extra: '€8,000' },
            { id: 'base-xl', tier: 'XL', basis: '15,000 or more', price: '€35,000', extra: '€12,000' },
        ],
    },
    {
        id: 'lecturer',
        title: 'Per lecturer',
        note: 'Banded by the sessions a lecturer teaches in a normal week.',
        basisLabel: 'Weekly sessions',
        priceLabel: 'Per year',
        rows: [
            { id: 'load-light', tier: 'Light', basis: '1 to 4', price: '€70' },
            { id: 'load-standard', tier: 'Standard', basis: '5 to 8', price: '€140' },
            { id: 'load-heavy', tier: 'Heavy', basis: '9 or more', price: '€240' },
        ],
    },
    {
        id: 'complexity',
        title: 'Complexity multiplier',
        note: 'Applied to the lecturer subtotal only, never to the base package.',
        basisLabel: 'What it means',
        priceLabel: 'Multiplier',
        rows: [
            {
                id: 'cx-s',
                tier: 'S',
                basis: 'Mostly fixed weekly patterns, few rooms and groups per lecturer',
                price: '1.0x',
            },
            { id: 'cx-m', tier: 'M', basis: 'Some variation, moderate spread', price: '1.3x' },
            {
                id: 'cx-l',
                tier: 'L',
                basis: 'High variation, wide spread, deep group nesting',
                price: '1.7x',
            },
            {
                id: 'cx-xl',
                tier: 'XL',
                basis: 'Very scattered, heavy cross-group and federation interaction',
                price: '2.2x',
            },
        ],
    },
];

/** Everything that is a flat line item rather than a band. */
export const FLAT_RATES: RateRow[] = [
    {
        id: 'seat',
        tier: 'Admin and scheduler seat',
        basis: 'Named people who edit, lock or run the solver. Everyone else is included.',
        price: '€350 per year',
    },
    {
        id: 'support-standard',
        tier: 'Standard support',
        basis: 'Included with every base package.',
        price: 'Included',
    },
    {
        id: 'support-priority',
        tier: 'Priority support',
        basis: 'Eight-hour response, a direct channel, and a quarterly roadmap call.',
        price: '€3,000 per year',
    },
    {
        id: 'support-partner',
        tier: 'Partner retainer',
        basis: 'Around sixty development hours a year for feature work you specify.',
        price: '€12,000 per year, or €200 per hour',
    },
    {
        id: 'onboarding-standard',
        tier: 'Standard onboarding',
        basis: 'Template-based import you run yourself, plus about three days of training.',
        price: '€3,000 to €5,000 once',
    },
    {
        id: 'onboarding-full',
        tier: 'Happiness Package onboarding',
        basis: 'We build the import from your legacy system, two weeks of intensive training, '
            + 'one named lead.',
        price: '€10,000 to €18,000 once',
    },
    {
        id: 'onboarding-federation',
        tier: 'Federation onboarding',
        basis: 'Quoted per federation, because no two consortia share a starting point.',
        price: 'On request',
    },
];

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
 */
export const SCENARIOS = [
    {
        id: 'a',
        short: 'Small, cluttered',
        title: 'Small university of applied sciences',
        shape: '2,500 students and 110 lecturers, a heavy adjunct mix, and a timetable nobody '
            + 'has tidied in years',
        input: {
            students: 2500,
            lecturers: { light: 50, standard: 40, heavy: 20 },
            complexity: { entanglement: 0.85, nesting: 0.85, variance: 0.85, constraints: 0.85 },
            adminSeats: 6,
            federation: false,
            support: 'standard',
            discountPercent: 0,
        },
    },
    {
        id: 'b',
        short: 'Large, regular',
        title: 'Large university, regular timetable',
        shape: '20,000 students and 600 lecturers on clean, repetitive weekly patterns',
        input: {
            students: 20000,
            lecturers: { light: 100, standard: 400, heavy: 100 },
            complexity: { entanglement: 0.15, nesting: 0.15, variance: 0.15, constraints: 0.15 },
            adminSeats: 12,
            federation: false,
            support: 'priority',
            discountPercent: 0,
        },
    },
    {
        id: 'c',
        short: 'Medium, scattered',
        title: 'Medium university, scattered timetable',
        shape: '12,000 students and 450 lecturers spread wide across rooms and nested groups',
        input: {
            students: 12000,
            lecturers: { light: 40, standard: 280, heavy: 130 },
            complexity: { entanglement: 0.85, nesting: 0.85, variance: 0.85, constraints: 0.85 },
            adminSeats: 10,
            federation: false,
            support: 'priority',
            discountPercent: 0,
        },
    },
    {
        id: 'd',
        short: 'Small school',
        title: 'Small school',
        shape: '400 students and 25 teachers on a simple fixed weekly pattern',
        input: {
            students: 400,
            lecturers: { light: 5, standard: 18, heavy: 2 },
            complexity: { entanglement: 0.15, nesting: 0.15, variance: 0.15, constraints: 0.15 },
            adminSeats: 2,
            federation: false,
            support: 'standard',
            discountPercent: 0,
        },
    },
] as const satisfies readonly { id: string; short: string; title: string; shape: string; input: PriceInput }[];

/**
 * The honesty note, and it is not boilerplate.
 *
 * These figures are planning guidelines that have not been checked against real
 * delivered cost, because there is not yet a portfolio of institutions to check
 * them against. A reader building a budget needs that, and the page two clicks
 * away is titled "Not built yet, and honest about it": a pricing page that
 * implied more certainty than the product page would undo it.
 */
export const RATE_CAVEAT = 'These are the rates as they stand today, and they are planning '
    + 'figures rather than a signed tariff: they have not yet been tested against a full year of '
    + 'real delivery. They will move as that data arrives. If we quote you, the quote is what '
    + 'holds, and we would rather tell you this here than after you have built a budget on it.';
