<template>
    <div class="tech">
        <p class="tech_figure">{{ lead.figure }}</p>
        <p class="tech_note">{{ lead.note }}</p>

        <ul class="tech_notes">
            <li
                v-for="item in items"
                :key="item.id"
                class="tech_item"
            >
                <h3 class="tech_title">{{ item.title }}</h3>
                <p class="tech_body">{{ item.body }}</p>
            </li>
        </ul>
    </div>
</template>

<script setup lang="ts">
import type { LandingFeature } from '~/utils/landingContent';

/**
 * The technical section's contents, composed for the inverse band.
 *
 * The page had exactly one moment of scale (the `h1`), and then ran at 13px
 * for four fifths of its length. This is the second one, and it is spent on the
 * most defensible sentence available: a measured number. Set large, in running
 * prose, with tabular numerals for the same reason every clock time in the
 * schedule carries them.
 *
 * Not a three-up stat row: that template would put 27,000, 350ms and four
 * seconds at equal weight when only the first pair is the claim, and the accent
 * colour it usually comes with belongs to the placement target on this page.
 */
defineProps<{
    lead: { figure: string; note: string };
    items: LandingFeature[];
}>();
</script>

<style scoped lang="scss">
.tech {
    &_figure {
        max-width: 26ch;
        margin: 0;

        font-size: $fontSize2Xl;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
        // Paired leading for this step, replacing a 1.15 literal.
        line-height: $lineHeight2Xl;

        /*
         * PAGE-GROUND INK, not the inverse ramp's. This band used to be
         * rendered with `tone="inverse"` and its ink was `$surface*`, which is
         * correct on a dark ground and effectively invisible on a light one.
         * The page rebuild left the hero and the closing action as the only two
         * inverse bands, so this section is now painted on the page's own
         * ground and takes `content*` like every other section body.
         */
        color: $content2;
        text-wrap: balance;
        letter-spacing: -0.02em;

        @include mobileOnly {
            font-size: $fontSizeXl;
        }
    }

    &_note {
        max-width: 60ch;
        margin: $space6 0 0;

        font-size: $fontSizeMd;
        line-height: var(--leading-loose);
        color: $content6;
    }

    &_notes {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: $space8;

        margin: $space9 0 0;
        padding: 0;

        list-style: none;

        @include mobileOnly {
            grid-template-columns: minmax(0, 1fr);
            gap: $space7;
        }
    }

    &_item {
        padding-top: $space5;
        // Ink-side hairline: `surface6` reads as a rule against `content1` the
        // way `surface5` does against the page ground.
        border-top: 1px solid $surface4;
    }

    &_title {
        margin: 0 0 $space4;
        font-size: $fontSizeMd;
        font-weight: 700;
        color: $content2;
    }

    &_body {
        max-width: 62ch;
        margin: 0;

        font-size: $fontSizeSm;
        line-height: var(--leading-loose);
        color: $content6;
    }
}
</style>
