<template>
    <p class="status">
        <span
            class="status_dot"
            aria-hidden="true"
        />
        <span class="status_label">{{ label }}</span>
        <span
            v-if="detail"
            class="status_detail"
        >{{ detail }}</span>
    </p>
</template>

<script setup lang="ts">
/**
 * "In active development", stated as a fact rather than an apology.
 *
 * It is a status pill, not a warning banner: the neutral surface and the accent
 * dot are the same pair the app uses for "the system is telling you where it
 * is", and deliberately not the error or warning palette, since those two mean a
 * violation in this product and must keep meaning only that (DESIGN.md, "State
 * colors are separate and mean only themselves").
 */
defineProps<{
    label: string;
    /** Optional trailing fact, such as a version or a date. Rendered quieter than the label. */
    detail?: string;
}>();
</script>

<style scoped lang="scss">
.status {
    display: inline-flex;
    gap: $space3;
    align-items: center;

    margin: 0;
    padding: $space3 $space5;
    border: 1px solid $surface5;
    border-radius: $radiusXl;

    font-size: $fontSizeXs;
    text-transform: uppercase;
    letter-spacing: 0.05em;

    background: $surface0;

    &_dot {
        width: $space3;
        height: $space3;
        border-radius: 50%;

        background: $primary500;

        // Present, not noticed, and it collapses under prefers-reduced-motion
        // through the global rule in layout.scss.
        animation: status-pulse 2.4s ease-in-out infinite;
    }

    &_label {
        font-weight: 700;
        color: $content4;
    }

    &_detail {
        color: $content7;
    }
}

@keyframes status-pulse {
    0%,
    100% {
        opacity: 1;
    }

    50% {
        opacity: 0.35;
    }
}
</style>
