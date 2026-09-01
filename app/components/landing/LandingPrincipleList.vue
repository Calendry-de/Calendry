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
 * The architectural decisions, as a definition list beside a sticky question.
 *
 * A `<dl>` because that is literally the content: a claim and the reasoning
 * that discharges it. The `<div>` wrapper around each pair is valid inside a
 * `<dl>` and is what lets a row be a layout box without breaking the
 * term-to-detail association.
 *
 * THE TWO COLUMNS MOVED OUT OF THIS COMPONENT. Each row used to be its own
 * 4fr/7fr grid with a hairline above it, which made this the fourth consecutive
 * section built out of hairline-separated rows. The column split now belongs to
 * the section shell (`LandingSection` with `layout="aside"`), where it holds the
 * section's own heading against all five principles at once, and the rows
 * themselves are a plain vertical stack.
 *
 * NO RULES AT ALL, deliberately. The tile grid above draws hairlines as grid
 * gaps and the built list draws one per cluster, so this section separating its
 * five items with space alone is what keeps those two from reading as the same
 * device three sections running. Space is also the honest separator here: these
 * are five independent claims, not rows of one table.
 */
defineProps<{
    items: LandingFeature[];
}>();
</script>

<style scoped lang="scss">
.principles {
    display: flex;
    flex-direction: column;
    gap: $space9;
    margin: 0;

    &_row {
        @include landingReveal(12px);
    }

    &_term {
        margin-bottom: $space4;

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
