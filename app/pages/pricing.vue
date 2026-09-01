<template>
    <div class="pricing">
        <LandingTopBar/>

        <main id="main">
            <LandingSection
                id="pricing"
                class="pricing_opener"
                tone="inverse"
                title="Priced on what your timetable actually is"
                lead="Not on what kind of institution you are. Two universities the same size pay
                    different amounts if one of them has a genuinely harder timetable, and that
                    difference is measured from your own data rather than assumed from a label."
            >
                <LandingCapabilityGrid :items="BASIS_ITEMS"/>
            </LandingSection>

            <LandingSection
                id="rates"
                title="The rate card"
                lead="Three things are banded and the rest are flat. A bill is the base package,
                    plus each lecturer at their load band, multiplied by your complexity tier, plus
                    the seats and services you choose."
            >
                <div class="pricing_tables">
                    <LandingRateTable
                        v-for="table in RATE_TABLES"
                        :key="table.id"
                        :table="table"
                    />
                </div>

                <p class="pricing_caveat">{{ RATE_CAVEAT }}</p>
            </LandingSection>

            <LandingSection
                id="extras"
                title="Seats, support and getting started"
                layout="aside"
                lead="Everything that is a flat line rather than a band. Only the people who edit
                    the timetable need a seat; everybody else who reads it is included."
            >
                <LandingPrincipleList :items="FLAT_ITEMS"/>
            </LandingSection>

            <LandingSection
                id="calculator"
                title="Move a variable, watch the price move"
                lead="Every figure below is computed from the rates above. The complexity sliders
                    are the ones worth dragging: they change a bill by more than doubling your
                    lecturer count does, without adding a single student."
            >
                <LandingPriceCalculator/>
            </LandingSection>

            <LandingSection
                id="examples"
                title="Four institutions, four bills"
                layout="narrow"
                lead="The pair worth comparing is the large regular university against the medium
                    scattered one. The smaller institution costs more, and measured complexity is
                    the only thing that explains it."
            >
                <LandingScenarioGrid :items="SCENARIOS"/>
            </LandingSection>

            <LandingSection
                id="talk"
                title="Getting an actual number"
                lead="The rates above will get you close on your own. A real quote needs your
                    lecturer count, their weekly load, and one look at how scattered the timetable
                    is, which is the part nobody can estimate from outside."
            >
                <LandingCallout
                    text="Accounts are created by an administrator, so there is nothing to sign up for here. Tell us the shape of your institution and we will come back with a figure."
                    action="Get in touch"
                    :href="`mailto:${ CONTACT_EMAIL }`"
                />
            </LandingSection>
        </main>

        <LandingFooter/>
    </div>
</template>

<script setup lang="ts">
import type { LandingFeature } from '~/utils/landingContent';
import { CONTACT_EMAIL } from '~/utils/landingContent';
import {
    FLAT_RATES, PRICING_BASIS, RATE_CAVEAT, RATE_TABLES, SCENARIOS,
} from '~/utils/pricingContent';

/**
 * The public pricing page.
 *
 * WHY THERE ARE REAL NUMBERS ON IT. Transparent pricing is one of the two things
 * this product leads with, so a page that said "contact us for a quote" would
 * throw away the differentiator it is supposed to demonstrate. The rate card is
 * published in full.
 *
 * WHAT IS NOT PUBLISHED, and the omissions are deliberate rather than
 * incidental: the internal cost base, the revenue and team-size planning
 * figures, the loaded cost of onboarding labour, and the negotiated-discount
 * lever. The first three are nobody's business outside the company; the fourth
 * stops working as a sales instrument the moment a public page announces it
 * exists. `pricingContent.ts` carries that list at the top so the next person to
 * extend this page knows which half of the source document is off limits.
 *
 * THE CAVEAT IS ON THE PAGE, not in a footnote, because these figures have not
 * been tested against a full year of real delivery. The landing page two clicks
 * away is titled "Not built yet, and honest about it"; a pricing page projecting
 * more certainty than the product page would undo the thing that makes either of
 * them credible.
 *
 * NO SIGN-UP AFFORDANCE, same rule as the landing page: accounts are created by
 * an administrator, and a button that cannot do what it says is worse than its
 * absence.
 *
 * ANONYMOUS. Registered as `PRICING_ROUTE` and listed in `auth.global.ts`'s
 * ANONYMOUS_ROUTES, because that middleware is deny-by-default and a pricing
 * page behind a login is not a pricing page. It reads no session and calls no
 * API, so a signed-in visitor is not bounced off it either.
 *
 * IT REUSES THE LANDING FURNITURE deliberately: the same bar, section shells,
 * tile grid, callout and footer, so this is the same site rather than a stub
 * bolted on later. The section shapes follow the landing page's rule too, which
 * is that no two neighbouring sections share a layout family.
 */
definePageMeta({ layout: 'empty' });

/**
 * The basis and the flat rates are both rendered through landing components that
 * take `LandingFeature`, so they are mapped rather than duplicated: the figures
 * stay in one module and the shape conversion happens here.
 */
const BASIS_ITEMS = computed<LandingFeature[]>(() => PRICING_BASIS.map(item => ({
    id: item.id,
    title: item.title,
    body: item.body,
})));

const FLAT_ITEMS = computed<LandingFeature[]>(() => FLAT_RATES.map(row => ({
    id: row.id,
    title: `${ row.tier }: ${ row.price }`,
    body: row.basis,
})));

const title = 'Pricing';
const description = 'Calendry is priced per institution on measured cost drivers: a base package '
    + 'by student headcount, a per-lecturer rate by weekly teaching load, and a complexity '
    + 'multiplier computed from your own schedule. Students are not billed.';

useHead({
    title,
    meta: [
        { name: 'description', content: description },
        { property: 'og:type', content: 'website' },
        { property: 'og:site_name', content: 'Calendry' },
        { property: 'og:title', content: `${ title } | Calendry` },
        { property: 'og:description', content: description },
        { property: 'og:locale', content: 'en' },
        { name: 'twitter:card', content: 'summary' },
        { name: 'twitter:title', content: `${ title } | Calendry` },
        { name: 'twitter:description', content: description },
    ],
});
</script>

<style scoped lang="scss">
.pricing {
    display: flex;
    flex-direction: column;
    width: 100%;

    // Clears the FIXED capsule, the same way the landing hero does. The section
    // shell's own 64px is not enough for a bar that overlays the viewport.
    &_opener {
        padding-top: $landingBarClearance;
    }

    &_tables {
        display: flex;
        flex-direction: column;
        gap: $space10;
    }

    &_caveat {
        max-width: 68ch;
        margin: $space9 0 0;
        padding-top: $space6;
        border-top: 1px solid $surface5;

        font-size: $fontSizeMd;
        line-height: 1.75;
        color: $content6;
    }
}
</style>
