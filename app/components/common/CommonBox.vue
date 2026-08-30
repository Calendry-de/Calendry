<template>
    <div class="common-box-wrap">
        <div class="common-box">
            <slot/>
        </div>
    </div>
</template>

<script setup lang="ts">
import type { VNode } from 'vue';
defineSlots<{
    default: () => VNode[];
}>();
</script>

<style scoped lang="scss">
.common-box-wrap {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100vh;

    .common-box {
        display: flex;
        flex-direction: column;
        gap: var(--space-6);

        min-width: 50vmax;
        padding: var(--space-8);
        border: 1px solid $surface7;
        border-radius: var(--radius-lg);

        background-color: $surface5;

        @include mobile {
            min-width: 90vw;
        }
    }
}
</style>
