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
.common-page {
    display: flex;
    flex-direction: column;
    gap: 24px;
    align-items: center;

    padding: 32px;

    h1 {
        font-size: 38px;
        font-weight: bold;

        @include mobile {
            font-size: 32px;
        }
    }

    p {
        font-size: 14px;

        @include mobile {
            font-size: 12px;
        }
    }
}
</style>
