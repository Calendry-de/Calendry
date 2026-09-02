<template>
    <ul class="scenarios">
        <li
            v-for="item in priced"
            :key="item.id"
            class="scenarios_cell"
        >
            <p class="scenarios_total">{{ item.total }}</p>
            <h3 class="scenarios_title">{{ item.title }}</h3>
            <p class="scenarios_shape">{{ item.shape }}</p>
            <p class="scenarios_complexity">{{ item.complexity }}</p>
        </li>
    </ul>
</template>

<script setup lang="ts">
import type { PricingScenario } from '~/utils/pricingContent';
import { computePrice, formatCount, formatEuro } from '~/utils/pricingModel';
import { useLanguage, useT } from '~/composables/i18n';

/**
 * The worked examples, as tiles with the figure first.
 *
 * THE NUMBER LEADS, above the description rather than under it. A reader on a
 * pricing page is looking for one thing, and making them read a paragraph to
 * reach it is a dark pattern with better manners. The figure is the largest
 * thing in the tile and everything else explains it.
 *
 * FOUR TILES ON A 2 x 2, deliberately even rather than the mirrored 2 + 1 the
 * capability grid uses. These four are peers being compared against each other,
 * and an asymmetric grid would imply one of them is the featured case. It is
 * the same construction otherwise: recessed cells on a hairline ground, which
 * is the schedule surface's own material.
 *
 * The pair to notice is the large clean university against the medium scattered
 * one: fewer students, more money. That is the model working, and putting the
 * two side by side is the honest way to show it.
 *
 * EVERY FIGURE IS COMPUTED, never typed. The tile renders `computePrice` over
 * the same input object the calculator loads when a reader clicks the matching
 * example, so the number on the card and the number the calculator produces
 * cannot drift apart. They previously could, and did: the totals were copied
 * from a document whose scenarios did not state their load-band mix or seat
 * count, so they were not reproducible from the published rate card at all.
 */
const props = defineProps<{
    items: readonly PricingScenario[];
}>();

const { t } = useT();

// The figures follow the viewer's FULL locale tag rather than the message
// language, so a German reader gets `4.000 €` and an English one `€4,000`.
const { locale } = useLanguage();

const priced = computed(() => props.items.map((item) => {
    const result = computePrice(item.input);
    return {
        id: item.id,
        title: item.title,
        shape: item.shape,
        total: t('landing.scenario.total', { amount: formatEuro(result.total, locale.value) }),
        complexity: t('landing.scenario.complexity', {
            tier: result.complexityTier.id,
            multiplier: result.complexityTier.multiplier,
            count: formatCount(result.lecturerCount, locale.value),
        }),
    };
}));
</script>

<style scoped lang="scss">
.scenarios {

    // Square corner tiles would otherwise show the ground as four dark nicks.
    overflow: hidden;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));

    // The gap is the hairline, the same construction the capability grid uses.
    gap: 1px;

    margin: 0;
    padding: 0;
    border: 1px solid $surface5;
    border-radius: $radiusLg;

    list-style: none;

    background: $surface5;

    @include mobileOnly {
        grid-template-columns: minmax(0, 1fr);
    }

    &_cell {
        display: flex;
        flex-direction: column;
        gap: $space3;

        padding: $space8;

        background: $surface0;

        @include landingReveal(14px);

        @include mobileOnly {
            padding: $space7 $space6;
        }
    }

    &_total {
        margin: 0;

        // The one display step in this section. Tabular, for the same reason
        // every other figure on the page is.
        font-size: $fontSizeXl;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
        line-height: 1.2;
        color: $content1;
    }

    &_title {
        margin: 0;

        font-size: $fontSizeMd;
        font-weight: 700;
        line-height: 1.4;
        color: $content2;
    }

    &_shape {
        max-width: 46ch;
        margin: 0;

        font-size: $fontSizeMd;
        line-height: 1.6;
        color: $content6;
    }

    &_complexity {
        margin: 0;
        font-size: $fontSizeSm;
        color: $content7;
    }
}
</style>
