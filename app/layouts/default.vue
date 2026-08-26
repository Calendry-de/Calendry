<template>
    <div class="app">
        <div
            class="header"
        >
            <NuxtLink
                class="header-text"
                :to="HOME_ROUTE"
                aria-label="Calendry"
            >
                <common-logo
                    :size="52"
                    wordmark
                />
            </NuxtLink>
            <view-menu/>
            <view-login/>
        </div>
        <div class="app_content">
            <nuxt-loading-indicator :color="colorsList.primary300"/>
            <slot/>
        </div>
        <common-toast-container/>
        <common-command-palette/>
        <view-version/>
    </div>
</template>

<script setup lang="ts">
import ViewMenu from '~/components/views/ViewMenu.vue';
import ViewLogin from '~/components/views/ViewLogin.vue';
import ViewVersion from '~/components/views/ViewVersion.vue';
import { colorsList } from '#imports';
import { HOME_ROUTE } from '~/utils/routes';

// Mounted here, once, so Ctrl+K works on every page that uses this layout —
// including /schedule, whose own Escape handling stands down while the palette
// holds the keyboard (see composables/overlay.ts).

// The header's plain "Calendry" text is now the 11C lockup. This layout is
// what /manage renders under, so the mark reaches the management area through
// here rather than through a bar of its own — there is no management-only
// header, and adding one to avoid also branding /dashboard and /schedule would
// mean two headers to keep in step. It links to HOME_ROUTE, which is the one
// place "where a signed-in session belongs" is written.

defineSlots<{ default: () => any }>();

useLayout();
</script>

<style lang="scss">
@use "~/scss/layout";
</style>

<style scoped lang="scss">
.header {
    position: sticky;

    display: grid;
    grid-template-columns: 0.5fr 2fr 15px 0.3fr;
    gap: 12px;
    align-items: center;

    width: 100%;
    padding: 9px;

    background: $surface0;

    &-text {
        display: flex;
        align-items: center;
        justify-content: start;

        margin-left: 24px;

        color: $content2;
        text-decoration: none;
    }

    &-container {
        display: flex;
        gap: 100px;
        align-items: center;
    }
}
</style>
