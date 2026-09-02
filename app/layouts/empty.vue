<template>
    <div class="app_content">
        <NuxtLoadingIndicator :color="colorsList.primary300"/>
        <slot/>
        <CommonToastContainer/>
        <view-version v-if="showVersion"/>
    </div>
</template>

<script setup lang="ts">
import type { VNode } from 'vue';
import { colorsList } from '#imports';
import ViewVersion from '~/components/views/ViewVersion.vue';
import { LANDING_ROUTE, PRICING_ROUTE } from '~/utils/routes';

defineSlots<{ default: () => VNode[] }>();

useCalendryLayout();

/**
 * The build stamp is for people working on the product, not for the public page.
 *
 * `ViewVersion` is `position: fixed` at `z-index: 10000`, so on the landing page
 * it pinned "v0.0.1" over the marketing copy, in the corner, permanently,
 * duplicating the version the hero badge already states deliberately. A visitor
 * who has never heard of Calendry reads a bare `0.0.1` as "this does not exist
 * yet"; the badge says "in active development" in words, which is the same fact
 * without the pre-alpha connotation.
 *
 * Kept on every other page this layout serves (login, change-password), where
 * the reader is someone who has an account and the version is useful.
 *
 * A LIST RATHER THAN ONE ROUTE, because the reasoning was never about `/`
 * specifically: it is about a page whose reader has no account. `/pricing` is
 * the second such page and inherited the bug the moment it existed, stamping
 * `v0.0.1-beta` over a rate card. Any further public page goes in here too.
 */
const route = useRoute();

const MARKETING_ROUTES: string[] = [LANDING_ROUTE, PRICING_ROUTE];

const showVersion = computed(() => !MARKETING_ROUTES.includes(route.path));
</script>

<style lang="scss">
@use "~/scss/layout";
</style>
