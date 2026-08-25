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
 * The page had exactly one moment of scale — the `h1` — and then ran at 13px
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
        line-height: 1.15;
        color: $surface0;
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
        line-height: 1.75;
        color: $surface4;
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
        border-top: 1px solid $surface6;
    }

    &_title {
        margin: 0 0 $space4;
        font-size: $fontSizeMd;
        font-weight: 700;
        color: $surface1;
    }

    &_body {
        max-width: 62ch;
        margin: 0;

        font-size: $fontSizeSm;
        line-height: 1.75;
        color: $surface4;
    }
}
</style>
