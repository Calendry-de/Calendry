<template>
    <ul class="rows">
        <li
            v-for="(item, index) in items"
            :key="item.id"
            class="rows_row"
            :class="{ 'rows_row--flipped': index % 2 === 1 }"
        >
            <div class="rows_copy">
                <h3 class="rows_title">{{ item.title }}</h3>
                <p class="rows_body">{{ item.body }}</p>
            </div>

            <div class="rows_figure">
                <LandingTimetableFigure
                    v-if="item.figure"
                    :variant="item.figure"
                />
            </div>
        </li>
    </ul>
</template>

<script setup lang="ts">
import type { LandingFeature } from '~/utils/landingContent';

/**
 * What the product does, each claim standing beside a timetable that performs it.
 *
 * THIS REPLACED A TILE GRID, which replaced a two-column list of hairline rows,
 * which replaced a grid of bordered cards. The tile grid was a good shape for
 * four short claims and the wrong one for four claims that each needed a picture:
 * a bento cell is as wide as it is tall, and a figure inside one is a thumbnail.
 * Paired rows give the drawing enough width to be legible and the paragraph a
 * measure it can keep.
 *
 * THE FIGURE IS THE ARGUMENT, not an illustration of it. Each variant of
 * `LandingTimetableFigure` acts out the sentence beside it: a week assembling, a
 * session moved by hand with the clash recorded rather than refused, a whole
 * proposal arriving at once, a field reduced to one person's sessions. That is
 * why the section is worth four rows of vertical space when it used to be worth
 * one grid.
 *
 * IT ALTERNATES SIDES, and that is a considered call rather than a default.
 * Four consecutive text-and-image splits is the pattern this repository's design
 * notes warn about, and the warning is about four SECTIONS each independently
 * choosing the same shape. This is one section rendering one list in one format,
 * where the repetition is the structure a reader uses to compare four claims.
 * Alternating keeps the eye from tracking straight down a single gutter; keeping
 * the layout otherwise identical is what makes the four comparable.
 *
 * COPY COMES FIRST IN THE DOM in every row, and the flip is done with `order` on
 * the desktop breakpoint only. A screen reader and a phone therefore always meet
 * the claim before the drawing, and the drawing is `aria-hidden` because it
 * carries nothing the paragraph does not already say in words.
 */
defineProps<{
    items: LandingFeature[];
}>();
</script>

<style scoped lang="scss">
.rows {
    display: flex;
    flex-direction: column;
    gap: $space11;

    margin: 0;
    padding: 0;

    list-style: none;

    @include mobileOnly {
        gap: $space10;
    }

    &_row {
        display: grid;
        grid-template-columns: minmax(0, 6fr) minmax(0, 5fr);
        gap: $space10;
        align-items: center;

        @include landingReveal(14px);

        // One column below the desktop band. The figure follows its paragraph
        // rather than preceding it, whichever side it takes above.
        @include mobile {
            grid-template-columns: minmax(0, 1fr);
            gap: $space7;
        }
    }

    // Flip only where there are two columns to flip between.
    &_row--flipped {
        @include pc {
            .rows_copy { order: 2; }
            .rows_figure { order: 1; }
        }
    }

    &_title {
        margin: 0 0 $space5;

        font-size: $fontSizeXl;
        font-weight: 700;
        line-height: 1.25;
        color: $content2;
        text-wrap: balance;

        @include mobileOnly {
            font-size: $fontSizeLg;
        }
    }

    &_body {
        max-width: 60ch;
        margin: 0;

        font-size: $fontSizeMd;
        line-height: 1.75;
        color: $content6;
    }
}
</style>
