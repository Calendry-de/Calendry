<template>
    <ul class="capabilities">
        <li
            v-for="item in items"
            :key="item.id"
            class="capabilities_item"
        >
            <h3 class="capabilities_title">{{ item.title }}</h3>
            <p class="capabilities_body">{{ item.body }}</p>
        </li>
    </ul>
</template>

<script setup lang="ts">
import type { LandingFeature } from '~/utils/landingContent';

/**
 * What the product does, as an editorial list rather than cards.
 *
 * This replaced a grid of same-size bordered cards, each with an icon above a
 * heading above text — the lazy container, and the shape this page repeated
 * three times. Two things were wrong with it beyond the cliché: the cards were
 * `$surface0` on a `$surface1` ground, which is 1.04:1 and so not a visible
 * surface at all, and their single column between 700px and 1365px gave the
 * body text a 145-character measure. A rule above each item groups it as
 * firmly as a border did, and the measure is now capped where the text lives
 * rather than where the container happens to end.
 */
defineProps<{
    items: LandingFeature[];
}>();
</script>

<style scoped lang="scss">
.capabilities {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: $space9 $space8;

    margin: 0;
    padding: 0;

    list-style: none;

    // One column only when a column genuinely cannot hold a sentence. The old
    // breakpoint collapsed at 1365px, which is where two columns still had
    // ~68ch each and one column had 145ch.
    @include mobileOnly {
        grid-template-columns: minmax(0, 1fr);
        gap: $space8;
    }

    &_item {
        padding-top: $space5;
        border-top: 1px solid $surface5;
    }

    &_title {
        margin: 0 0 $space4;

        font-size: $fontSizeLg;
        font-weight: 700;
        line-height: 1.35;
        color: $content2;
        text-wrap: balance;
    }

    &_body {
        max-width: 68ch;
        margin: 0;

        font-size: $fontSizeMd;
        line-height: 1.75;
        color: $content6;
    }
}
</style>
