<template>
    <dl class="principles">
        <div
            v-for="item in items"
            :key="item.id"
            class="principles_row"
        >
            <dt class="principles_term">{{ item.title }}</dt>
            <dd class="principles_detail">{{ item.body }}</dd>
        </div>
    </dl>
</template>

<script setup lang="ts">
import type { LandingFeature } from '~/utils/landingContent';

/**
 * The architectural decisions, as a definition list.
 *
 * A `<dl>` because that is literally the content: a claim and the reasoning
 * that discharges it. Reading term-beside-detail also gives the page a fourth
 * distinct shape — after the hero figure, the two-column capability list and
 * the roadmap — instead of a third pass of the same card grid, and it lets a
 * reader scan the five claims in one column without reading five bodies.
 *
 * The `<div>` wrapper around each pair is valid in a `<dl>` and is what allows
 * the row to be a grid without breaking the term/detail association.
 */
defineProps<{
    items: LandingFeature[];
}>();
</script>

<style scoped lang="scss">
.principles {
    margin: 0;

    &_row {
        display: grid;
        grid-template-columns: minmax(0, 4fr) minmax(0, 7fr);
        gap: $space5 $space8;

        padding: $space6 0;
        border-top: 1px solid $surface5;

        @include mobile {
            grid-template-columns: minmax(0, 1fr);
            gap: $space4;
        }
    }

    &_term {
        font-size: $fontSizeLg;
        font-weight: 700;
        line-height: 1.35;
        color: $content2;
        text-wrap: balance;
    }

    &_detail {
        max-width: 68ch;
        margin: 0;

        font-size: $fontSizeMd;
        line-height: 1.75;
        color: $content6;
    }
}
</style>
