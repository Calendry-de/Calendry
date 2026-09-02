<template>
    <div class="pricing">
        <LandingTopBar/>

        <main id="main">
            <LandingSection
                id="pricing"
                class="pricing_opener"
                tone="inverse"
                :title="t('pricing.page.opener.title')"
                :lead="t('pricing.page.opener.lead')"
            >
                <LandingCapabilityGrid :items="BASIS_ITEMS"/>
            </LandingSection>

            <LandingSection
                id="rates"
                :title="t('pricing.page.rates.title')"
                :lead="t('pricing.page.rates.lead')"
            >
                <div class="pricing_tables">
                    <LandingRateTable
                        v-for="table in TABLES"
                        :key="table.id"
                        :table="table"
                    />
                </div>

                <p class="pricing_caveat">{{ t('pricing.caveat.text') }}</p>
            </LandingSection>

            <LandingSection
                id="extras"
                layout="aside"
                :title="t('pricing.page.extras.title')"
                :lead="t('pricing.page.extras.lead')"
            >
                <LandingPrincipleList :items="FLAT_ITEMS"/>
            </LandingSection>

            <LandingSection
                id="calculator"
                :title="t('pricing.page.calculator.title')"
                :lead="t('pricing.page.calculator.lead')"
            >
                <LandingPriceCalculator/>
            </LandingSection>

            <LandingSection
                id="examples"
                layout="narrow"
                :title="t('pricing.page.examples.title')"
                :lead="t('pricing.page.examples.lead')"
            >
                <LandingScenarioGrid :items="SCENARIO_ITEMS"/>
            </LandingSection>

            <LandingSection
                id="talk"
                :title="t('pricing.page.talk.title')"
                :lead="t('pricing.page.talk.lead')"
            >
                <LandingCallout
                    :text="t('pricing.page.talk.calloutText')"
                    :action="t('pricing.page.talk.calloutAction')"
                    :href="`mailto:${ CONTACT_EMAIL }`"
                />
            </LandingSection>
        </main>

        <LandingFooter/>
    </div>
</template>

<script setup lang="ts">
import { useLanguage, useT } from '~/composables/i18n';
import { openGraphLocale } from '#shared/language';
import type { LandingFeature } from '~/utils/landingContent';
import { CONTACT_EMAIL } from '~/utils/landingContent';
import { flatRates, pricingBasis, pricingScenarios, rateTables } from '~/utils/pricingContent';

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
 *
 * EVERY BLOCK BELOW IS A `computed` OVER `t` AND `locale`, never a value read
 * once at setup: the two axes move independently (issue #19), so a language
 * change has to re-resolve the copy and a locale change has to re-format the
 * figures, and a page whose prices froze at first render would be the worse
 * half of that pair, because a stale price still looks like a price.
 */
definePageMeta({ layout: 'empty' });

const { t } = useT();
const { language, locale } = useLanguage();

/**
 * The basis and the flat rates are both rendered through landing components that
 * take `LandingFeature`, so they are mapped rather than duplicated: the figures
 * stay in one module and the shape conversion happens here.
 */
const BASIS_ITEMS = computed<LandingFeature[]>(() => pricingBasis(t));

const TABLES = computed(() => rateTables(t, locale.value));

const FLAT_ITEMS = computed<LandingFeature[]>(() => flatRates(t, locale.value).map(row => ({
    id: row.id,
    title: t('pricing.format.flatTitle', { tier: row.tier, price: row.price }),
    body: row.basis,
})));

const SCENARIO_ITEMS = computed(() => pricingScenarios(t, locale.value));

// A getter, not a plain object: `useHead` re-evaluates it, so the tab title and
// the social-card text follow a language change instead of freezing at whatever
// was active when this page first rendered.
useHead(() => {
    const title = t('pricing.page.title');
    const description = t('pricing.page.description');

    return {
        title,
        meta: [
            { name: 'description', content: description },
            { property: 'og:type', content: 'website' },
            { property: 'og:site_name', content: 'Calendry' },
            { property: 'og:title', content: `${ title } | Calendry` },
            { property: 'og:description', content: description },
            { property: 'og:locale', content: openGraphLocale(language.value) },
            { name: 'twitter:card', content: 'summary' },
            { name: 'twitter:title', content: `${ title } | Calendry` },
            { name: 'twitter:description', content: description },
        ],
    };
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
