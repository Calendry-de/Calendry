<template>
    <div class="problem">
        <article
            v-for="(item, index) in items"
            :key="item.id"
            class="problem_side"
            :class="`problem_side--${ item.id }`"
        >
            <p class="problem_kicker">
                <Icon
                    class="problem_mark"
                    :name="index === 0 ? 'ph:warning-diamond' : 'ph:check-circle'"
                    aria-hidden="true"
                />
                {{ item.title }}
            </p>

            <p class="problem_body">{{ item.body }}</p>
        </article>
    </div>
</template>

<script setup lang="ts">
import type { LandingFeature } from '~/utils/landingContent';

/**
 * The problem, then the solution, side by side.
 *
 * TWO PANELS AND NOT A TABLE. A comparison table invites a reader to check
 * every row against a competitor, and the thing being compared here is not a
 * competitor: it is the spreadsheet they already have. Two paragraphs facing
 * each other make the claim without pretending to be a feature matrix.
 *
 * THE ICON ENCODES THE SIDE, which is why there is one at all on a page whose
 * sections are otherwise typographic. The two panels are the same shape and the
 * same weight; without a marker, which one is the problem and which the answer
 * is carried only by reading order, and a reader who scans right-to-left or
 * lands mid-section gets it backwards. Chosen by INDEX rather than by id, so
 * the pair cannot be reordered into a state where the warning sits on the
 * answer.
 *
 * `items` is `LandingFeature[]` rather than a shape of its own: it is a titled
 * paragraph, which is exactly that type, and inventing a second identical
 * interface for it would mean two things to keep in agreement.
 */
defineProps<{ items: LandingFeature[] }>();
</script>

<style scoped lang="scss">
.problem {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: $space7;

    @include mobile {
        grid-template-columns: minmax(0, 1fr);
    }

    &_side {
        /*
         * The border goes all the way around. A single-sided rule reads as an
         * accent on a panel that has none, and the design system forbids it
         * outright: a card is bounded or it is not.
         */
        padding: $space6;
        border: 1px solid $surface4;
        border-radius: $radius2Xl;

        /*
         * NO NESTED RADIUS on anything inside. The design system's formula is
         * inner = outer - gap, applied only when the result clears 2px; the gap
         * here is the 16px padding against a 16px outer radius, which lands on
         * zero, so the children stay square. Writing a smaller radius on them
         * anyway is how a card ends up with three unrelated corner sizes.
         */
        &--before {
            background: $surface1;
        }

        // The answer side is not accented. The accent on this page means "where
        // a session may land", and spending it here would leave the figure and
        // the primary action competing with a paragraph.
        &--after {
            background: $surface0;
        }
    }

    &_kicker {
        display: flex;
        gap: $space4;
        align-items: baseline;

        margin: 0 0 $space5;

        font-size: $fontSizeLg;
        font-weight: 600;
        line-height: $lineHeightLg;
        color: $content2;
    }

    &_mark {
        flex: 0 0 auto;
        width: $fontSizeMd;
        height: $fontSizeMd;
        line-height: 1;
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
