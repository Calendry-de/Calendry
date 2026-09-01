<template>
    <ul
        class="capabilities"
        :class="{ 'capabilities--even': items.length !== 4 }"
    >
        <li
            v-for="(item, index) in items"
            :key="item.id"
            class="capabilities_cell"
            :class="{ 'capabilities_cell--lead': index === 0 }"
        >
            <h3 class="capabilities_title">{{ item.title }}</h3>
            <p class="capabilities_body">{{ item.body }}</p>
        </li>
    </ul>
</template>

<script setup lang="ts">
import type { LandingFeature } from '~/utils/landingContent';

/**
 * What the product does, as a tile grid with the product's own material.
 *
 * TWO SHAPES AGO this was a grid of same-size bordered cards, each with an icon
 * over a heading over text. That went because the cards were `surface0` on a
 * `surface1` ground, which is 1.04:1 and therefore not a visible surface at
 * all. It became a two-column list of hairline-topped rows, which was legible
 * and correct and which three later sections then also used, so the middle of
 * the page ran four sections deep in one shape.
 *
 * WHY THE CARDS WORK NOW WHEN THEY DID NOT BEFORE, and it is not a change of
 * mind about the measurement. `surface0` is invisible against `surface1` when
 * it is a filled box floating on the page. It is perfectly visible when a
 * `surface5` hairline separates it from its neighbour, which is exactly how the
 * schedule grid draws its own empty cells: recessed ground, hairline gaps, no
 * borders and no shadows. The grid gap IS the ground here, showing through 1px
 * between tiles. So the section is built out of the surface the product is
 * actually made of, rather than out of a card component that needs a fill this
 * palette cannot give it.
 *
 * SPANS CARRY THE RHYTHM. Four items into a three-column grid as 2 + 1 over
 * 1 + 2: exactly four cells for exactly four items, no filler tile, and the
 * mirrored pair keeps it from reading as a row of equal boxes. The first item
 * is the one a registrar needs to believe before any of the others matter, so
 * it takes the wide cell and the inverse ground.
 *
 * THE SPANS ONLY WORK AT EXACTLY FOUR, which is why any other count falls back
 * to an even two-column grid instead. This is a guard against a real bug rather
 * than a hypothetical one: the pricing page passed five items, the fifth took
 * one column of a three-column row, and the grid rendered a blank tile in the
 * bottom-right corner. A composition that depends on its item count has to say
 * so in code, because the next caller will not read this comment first.
 *
 * ONE INVERSE TILE, NOT A PALETTE. `content1` as a ground is the only pairing
 * on this surface with real separation from the page, and the accent cannot do
 * this job: DESIGN.md's One Signal Rule reserves Signal Teal for where the
 * system is offering something to act on, and a heading is not that.
 */
defineProps<{
    items: LandingFeature[];
}>();
</script>

<style scoped lang="scss">
.capabilities {

    // The radius has to be clipped rather than inherited: the corner tiles are
    // square, and the ground would otherwise show as four dark nicks.
    overflow: hidden;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));

    /*
     * The gap is the hairline. A 1px gap over a `surface5` ground draws every
     * separator in the grid at once, including the internal cross where the two
     * rows meet, which four `border` declarations would have to agree about.
     */
    gap: 1px;

    margin: 0;
    padding: 0;
    border: 1px solid $surface5;
    border-radius: $radiusLg;

    list-style: none;

    background: $surface5;

    /*
     * THREE BANDS, because the span pattern only works in the widest one. At
     * 1366px the narrow tiles are ~330px; at 700px they would be ~217px, which
     * after padding leaves about twenty characters a line. So the mirrored
     * 2 + 1 / 1 + 2 rhythm is a desktop composition, and the two bands below it
     * are an even 2 x 2 and a single column. Declared widest-first: `mobile` is
     * max-width 1365 and `mobileOnly` is max-width 699, so the narrower rule has
     * to come second to win.
     */
    @include mobile {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    @include mobileOnly {
        grid-template-columns: minmax(0, 1fr);
    }

    // Any count other than four: an even two-column grid, which leaves no hole
    // for an odd item to fall into. See the component note.
    &--even {
        @include fromTablet {
            grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        .capabilities_cell:nth-child(1),
        .capabilities_cell:nth-child(4) {
            grid-column: span 1;
        }
    }

    &_cell {
        display: flex;
        flex-direction: column;
        gap: $space4;

        padding: $space8;

        background: $surface0;

        @include landingReveal(14px);

        @include mobileOnly {
            padding: $space7 $space6;
        }

        // 2 + 1 over 1 + 2. Declared on the two wide cells only; the narrow ones
        // flow into the single column each row has left.
        &:nth-child(1),
        &:nth-child(4) {
            grid-column: span 2;

            // Even tiles below the desktop band, matching the column counts
            // above. A cell spanning 2 of 2 columns would be a full-width row
            // between two half-width ones, which is a broken grid rather than an
            // asymmetric one.
            @include mobile {
                grid-column: span 1;
            }
        }
    }

    &_title {
        margin: 0;

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

    // The lead tile. `content1` ground with `surface*` ink is the same pair the
    // rest of the page uses read backwards, so it inverts with the theme instead
    // of needing a dark-mode override, and it cannot end up the same colour as
    // the page.
    &_cell--lead {
        background: $content1;

        .capabilities_title {
            color: $surface1;
        }

        .capabilities_body {
            color: $surface3;
        }
    }
}
</style>
