<template>
    <section
        :id="id"
        class="section"
        :class="{ 'section--inverse': tone === 'inverse' }"
        :aria-labelledby="`${ id }-title`"
    >
        <div class="section_measure">
            <h2
                :id="`${ id }-title`"
                class="section_title"
            >{{ title }}</h2>
            <p
                v-if="lead"
                class="section_lead"
            >{{ lead }}</p>

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
     * ground the page currently has — no per-theme override, and it cannot end
     * up the same colour as the page.
     */
    tone?: 'default' | 'inverse';
}>(), { lead: undefined, tone: 'default' });
</script>

<style scoped lang="scss">
.section {
    scroll-margin-top: $space9;
    padding: $space10 $space7;

    @include mobileOnly {
        padding: $space9 $space5;
    }

    &_measure {
        width: min(1040px, 100%);
        margin: 0 auto;
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
    // pair the rest of the page uses, read the other way round — 15.9:1 in the
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
