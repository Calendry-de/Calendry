<template>
    <section
        :id="id"
        class="section"
        :aria-labelledby="`${id}-title`"
    >
        <p class="section_eyebrow">{{ eyebrow }}</p>
        <h2
            :id="`${id}-title`"
            class="section_title"
        >{{ title }}</h2>
        <p
            v-if="lead"
            class="section_lead"
        >{{ lead }}</p>

        <div class="section_body">
            <slot/>
        </div>
    </section>
</template>

<script setup lang="ts">
/**
 * The one section shell every landing section uses: uppercase eyebrow, title,
 * optional lead paragraph, then whatever the section is.
 *
 * It exists so the page template composes sections instead of repeating their
 * heading markup five times — the same "pages compose, they do not implement"
 * rule the management scaffold follows. The eyebrow register (uppercase 11px,
 * 0.05em tracking) is the app's label register from DESIGN.md, not a new one.
 */
defineProps<{
    /** Also the element id, so an in-page link can point at this section. */
    id: string;
    eyebrow: string;
    title: string;
    lead?: string;
}>();
</script>

<style scoped lang="scss">
.section {
    scroll-margin-top: $space8;

    &_eyebrow {
        margin: 0 0 $space4;

        font-size: $fontSizeXs;
        font-weight: 700;
        color: $primary600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }

    &_title {
        margin: 0;
        font-size: $fontSizeXl;
        font-weight: 700;
        color: $content2;

        @include mobileOnly {
            font-size: $fontSizeLg;
        }
    }

    &_lead {
        max-width: 62ch;
        margin: $space5 0 0;

        font-size: $fontSizeMd;
        line-height: 1.65;
        color: $content6;
    }

    &_body {
        margin-top: $space8;
    }
}
</style>
