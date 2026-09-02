<template>
    <ol class="steps">
        <li
            v-for="(item, index) in items"
            :key="item.id"
            class="steps_step"
        >
            <p class="steps_index" aria-hidden="true">{{ index + 1 }}</p>

            <div class="steps_text">
                <h3 class="steps_title">{{ item.title }}</h3>
                <p class="steps_body">{{ item.body }}</p>
            </div>
        </li>
    </ol>
</template>

<script setup lang="ts">
import type { LandingStep } from '~/utils/landingContent';

/**
 * Three steps, numbered.
 *
 * AN `<ol>`, because the order is the meaning. A screen reader announces the
 * position from the list itself, which is why the visible number carries
 * `aria-hidden`: without it every step is read out twice, once as "1" and once
 * as "list item 1 of 3".
 *
 * THE NUMBER COMES FROM THE POSITION, never from the content module. A "3"
 * typed beside the third step is a number nothing checks, and the first thing
 * that happens to a three-step list is that it becomes a four-step list.
 *
 * NO BADGE AROUND THE NUMERAL, deliberately. A circle or a rounded square here
 * would be a shape nested inside the section with a gap under 32px, which the
 * design system's radius formula resolves to zero, so it would have to be a
 * square box: three square boxes with numbers in them look like a table of
 * contents. Large quiet type does the same job with no shape at all.
 */
defineProps<{ items: LandingStep[] }>();
</script>

<style scoped lang="scss">
.steps {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: $space7;

    margin: 0;
    padding: 0;

    list-style: none;

    @include mobile {
        grid-template-columns: minmax(0, 1fr);
        gap: $space9;
    }

    &_step {
        display: flex;
        gap: $space5;
        align-items: baseline;

        @include landingReveal;
    }

    &_index {
        flex: 0 0 auto;

        margin: 0;

        font-size: $fontSize2Xl;
        font-weight: 600;
        font-variant-numeric: tabular-nums;

        // Icons and standalone numerals carry no leading; see tokens-root.scss
        // on why `1` is deliberately not a step on the leading scale.
        line-height: 1;

        // Tabular, for the same reason every clock time in the schedule is: a
        // column of figures that shifts width as it counts reads as a wobble.
        color: $content7;
    }

    &_text {
        display: flex;
        flex-direction: column;
        gap: $space4;
    }

    &_title {
        margin: 0;

        font-size: $fontSizeLg;
        font-weight: 600;
        line-height: $lineHeightLg;
        color: $content2;
        text-wrap: balance;
    }

    &_body {
        margin: 0;

        font-size: $fontSizeMd;
        line-height: $lineHeightMd;
        color: $content6;
        text-wrap: pretty;
    }
}
</style>
