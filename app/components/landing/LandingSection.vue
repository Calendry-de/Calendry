<template>
    <section
        :id="id"
        class="section"
        :class="{ 'section--inverse': tone === 'inverse' }"
        :aria-labelledby="`${ id }-title`"
    >
        <div
            class="section_measure"
            :class="{
                'section_measure--aside': layout === 'aside',
                'section_measure--narrow': layout === 'narrow',
            }"
        >
            <div class="section_head">
                <h2
                    :id="`${ id }-title`"
                    class="section_title"
                >{{ title }}</h2>
                <p
                    v-if="lead"
                    class="section_lead"
                >{{ lead }}</p>
            </div>

            <div class="section_body">
                <slot/>
            </div>
        </div>
    </section>
</template>

<script setup lang="ts">
/**
 * The section shell: full-bleed ground, measured content.
 *
 * NO EYEBROW. Every section used to carry an uppercase label above its heading
 * ("WHAT IT DOES" over "A timetable you can hold"), which is the most reliable
 * tell of a generated page and, worse here, was mostly a restatement of the
 * heading underneath it. The heading carries its own weight.
 *
 * The section is full width and constrains its own content, rather than sitting
 * inside a page-level container. That is what lets `tone="inverse"` paint a
 * genuinely full-bleed band without a `100vw` breakout, which overflows
 * horizontally the moment a scrollbar takes up space.
 */
withDefaults(defineProps<{
    /** Also the element id, so an in-page link can point at this section. */
    id: string;
    title: string;
    lead?: string;
    /**
     * `inverse` paints the section on the opposite end of the ramp. Because the
     * dark theme swaps the surface and content ramps wholesale, expressing it
     * with `content*` tokens means the band is always the inverse of whatever
     * ground the page currently has, with no per-theme override, and it cannot end
     * up the same colour as the page.
     */
    tone?: 'default' | 'inverse';
    /**
     * `stacked` puts the heading above the body, which is right for a section
     * whose body is itself a wide composition (a tile grid, a grouped list).
     *
     * `aside` puts the heading in a sticky left column beside the body. It is
     * for a section that is a sequence of separate arguments, where the
     * question stays useful while the reader is three answers into it. It is
     * also the page's fourth distinct section shape, which is the other half of
     * why it exists: this surface had four consecutive sections drawn as
     * hairline-separated rows, and that repetition was the single biggest thing
     * wrong with the page.
     *
     * Not for short bodies. A sticky column beside two paragraphs never moves,
     * so it reads as an indent rather than as a device.
     *
     * `narrow` insets the whole section into a single centred column. It is for
     * a section that is one voice rather than a composition: at the page's full
     * 1040px measure, a single-column list leaves half the width empty down one
     * side, which reads as an unfinished layout. The same list in a narrower
     * column has balanced margins, and the inset itself becomes the signal that
     * this section is an aside to the one above it.
     */
    layout?: 'stacked' | 'aside' | 'narrow';
}>(), { lead: undefined, tone: 'default', layout: 'stacked' });
</script>

<style scoped lang="scss">
.section {
    // Clears the floating capsule, which overlays the top of the viewport and
    // reserves no flow. At the old 48px an anchor jump landed the heading
    // underneath the bar. See `$landingBarClearance`.
    scroll-margin-top: $landingBarClearance;
    padding: $space10 $space7;

    @include mobileOnly {
        padding: $space9 $space5;
    }

    &_measure {
        width: min(1040px, 100%);
        margin: 0 auto;
    }

    /*
     * The narrow variant. 680px is the prose measure the rest of the page
     * already caps its body copy at (68ch at 14px) plus the marker rail the
     * unbuilt list carries, so the column is exactly as wide as its content
     * needs and no wider. It stays the full width on a phone, where there is no
     * margin to give away.
     */
    &_measure--narrow {
        @include fromTablet {
            width: min(680px, 100%);
        }
    }

    // The aside variant. Below the desktop breakpoint it is the stacked layout
    // again: a sticky column needs a column to be sticky in, and at one column
    // wide it would just pin the heading over the content a reader is trying to
    // scroll past.
    &_measure--aside {
        @include pc {
            display: grid;
            grid-template-columns: minmax(0, 4fr) minmax(0, 7fr);
            gap: $space10;
            align-items: start;

            .section_head {
                position: sticky;

                /*
                 * THE SAME CLEARANCE EVERYTHING ELSE USES. This was `$space9`,
                 * which is 48px against a bar that occupies 68: the heading
                 * parked itself half behind the capsule and stayed there for
                 * the whole length of the section, which is exactly the span
                 * a sticky heading is visible for.
                 */
                top: $landingBarClearance;
            }

            .section_body {
                margin-top: 0;
            }
        }
    }

    &_title {
        max-width: 30ch;
        margin: 0;

        font-size: $fontSizeXl;
        font-weight: 700;
        line-height: 1.2;
        color: $content2;
        text-wrap: balance;
    }

    &_lead {
        max-width: 66ch;
        margin: $space6 0 0;

        font-size: $fontSizeLg;
        line-height: 1.6;
        color: $content6;

        @include mobileOnly {
            font-size: $fontSizeMd;
        }
    }

    &_body {
        margin-top: $space9;
    }

    // The inverse band. `content1` as a ground and `surface*` as ink is the same
    // pair the rest of the page uses, read the other way round: 15.9:1 in the
    // light theme and 15.9:1 in the dark one, because both tokens move together.
    &--inverse {
        background: $content1;

        .section_title {
            color: $surface1;
        }

        .section_lead {
            color: $surface3;
        }
    }
}
</style>
