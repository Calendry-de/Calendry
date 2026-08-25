<template>
    <ul
        class="features"
        :class="`features--columns-${ columns }`"
    >
        <li
            v-for="item in items"
            :key="item.id"
            class="features_item"
        >
            <Icon
                class="features_icon"
                :name="item.icon"
                aria-hidden="true"
            />
            <h3 class="features_title">{{ item.title }}</h3>
            <p class="features_body">{{ item.body }}</p>
        </li>
    </ul>
</template>

<script setup lang="ts">
import type { LandingFeature } from '~/utils/landingContent';

/**
 * A list of titled explanations as cards. One job: render `LandingFeature[]`.
 *
 * Used by three sections with different content and the same shape — what the
 * product does, why it works that way, and what it is built on. Three
 * near-identical components would have drifted apart the way `paramField()` did
 * before it was unified (CLAUDE.md, Step 13), so the variation is a prop.
 */
withDefaults(defineProps<{
    items: LandingFeature[];
    /** Widest layout only; every column count collapses to one on a phone. */
    columns?: 2 | 3;
}>(), { columns: 2 });
</script>

<style scoped lang="scss">
.features {
    display: grid;
    gap: $space6;

    margin: 0;
    padding: 0;

    list-style: none;

    &--columns-2 {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    &--columns-3 {
        grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    // A card is unreadable narrow long before the viewport is a phone, so both
    // column counts drop to one at the tablet boundary rather than squeezing.
    @include mobile {
        &--columns-2,
        &--columns-3 {
            grid-template-columns: minmax(0, 1fr);
        }
    }

    &_item {
        padding: $space7;
        border: 1px solid $surface5;
        border-radius: $radiusXl;
        background: $surface0;
    }

    &_icon {
        display: block;

        width: $space7;
        height: $space7;
        margin-bottom: $space5;

        color: $primary600;
    }

    &_title {
        margin: 0 0 $space4;
        font-size: $fontSizeLg;
        font-weight: 700;
        color: $content2;
    }

    &_body {
        margin: 0;
        font-size: $fontSizeMd;
        line-height: 1.7;
        color: $content6;
    }
}
</style>
