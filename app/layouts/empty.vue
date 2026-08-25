<template>
    <div class="app_content">
        <nuxt-loading-indicator :color="colorsList.primary300"/>
        <slot/>
        <common-toast-container/>
        <view-version v-if="showVersion"/>
    </div>
</template>

<script setup lang="ts">
import { colorsList } from '#imports';
import ViewVersion from '~/components/views/ViewVersion.vue';
import { LANDING_ROUTE } from '~/utils/routes';

defineSlots<{ default: () => any }>();

useLayout();

/**
 * The build stamp is for people working on the product, not for the public page.
 *
 * `ViewVersion` is `position: fixed` at `z-index: 10000`, so on the landing page
 * it pinned "v0.0.1" over the marketing copy — in the corner, permanently,
 * duplicating the version the hero badge already states deliberately. A visitor
 * who has never heard of Calendry reads a bare `0.0.1` as "this does not exist
 * yet"; the badge says "in active development" in words, which is the same fact
 * without the pre-alpha connotation.
 *
 * Kept on every other page this layout serves (login, change-password), where
 * the reader is someone who has an account and the version is useful.
 */
const route = useRoute();

const showVersion = computed(() => route.path !== LANDING_ROUTE);
</script>

<style lang="scss">
@use "~/scss/layout";
</style>
