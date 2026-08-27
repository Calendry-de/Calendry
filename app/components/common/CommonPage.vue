<template>
    <div class="common-page">
        <h1>{{ title }}</h1>
        <slot/>
    </div>
</template>

<script setup lang="ts">
import type { VNode } from 'vue';
defineProps<{
    title: string;
}>();

defineSlots<{
    default: () => VNode[];
}>();
</script>

<style scoped lang="scss">
/*
 * ONE COLUMN, CENTRED AS A COLUMN — not `align-items: center`.
 *
 * This was `align-items: center` on a column flex container, which sizes every
 * child to `max-content` instead of centring a shared measure. Measured
 * consequences on /my/availability: two sibling cards on one page rendered
 * 1085.5px and 382.7px wide (703px apart), the declared-windows list was
 * 493.0px at BOTH 1024px and 1440px, `.modes_tab { flex: 1 1 200px }` was inert
 * at every width because its flex line never had free space, and the page
 * presented three different left edges. Nothing could establish a column,
 * because no child was ever wider than its own content.
 *
 * `align-items` now defaults to `stretch`, so children fill; the COLUMN is what
 * is bounded and centred. Any single page that wants a narrower measure caps
 * itself, which is why `--page-measure` is exposed rather than hardcoded.
 */
.common-page {
    --page-measure: 960px;

    display: flex;
    flex-direction: column;
    gap: var(--space-7);

    width: 100%;
    max-width: var(--page-measure);
    margin-inline: auto;
    padding: var(--space-8);

    @include mobile {
        padding: var(--space-6);
    }

    /*
     * Matches `ManageShell`, the app's other page shell, exactly:
     * `--font-size-xl` at 680. This was `38px`/`bold` — a size the scale does
     * not contain and which `tokens-root.scss` records as deliberately retired
     * ("was 32, 38 — display"). Every other h1 in the app already uses
     * `--font-size-xl`, so this shell was the only page title disagreeing.
     * No mobile step-down: 24px needs none, and the old one fired at 1365px —
     * a desktop width — rather than at a phone.
     */
    h1 {
        margin: 0;
        font-size: var(--font-size-xl);
        font-weight: 680;
        color: $content1;
    }
}
</style>
