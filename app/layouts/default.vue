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
                <CommonLogo
                    :size="52"
                    wordmark
                />
            </NuxtLink>
            <view-menu/>
            <view-login/>
        </div>
        <div class="app_content">
            <NuxtLoadingIndicator :color="colorsList.primary300"/>
            <slot/>
        </div>
        <CommonToastContainer/>
        <CommonCommandPalette/>
        <ViewNavDrawer/>
        <view-version/>
    </div>
</template>

<script setup lang="ts">
import type { VNode } from 'vue';
import ViewMenu from '~/components/views/ViewMenu.vue';
import ViewNavDrawer from '~/components/views/ViewNavDrawer.vue';
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

defineSlots<{ default: () => VNode[] }>();

useLayout();
</script>

<style lang="scss">
@use "~/scss/layout";
</style>

<style scoped lang="scss">
/*
 * THREE tracks for three children, sized by role rather than by `fr`.
 *
 * This was `grid-template-columns: 0.5fr 2fr 15px 0.3fr` — four tracks for
 * three children, so the `15px` was a phantom and the account button was laid
 * into a `0.3fr` track that measured **0.28px** at a 760px viewport. It then
 * overflowed its own track, which is what put the document's right edge at
 * 781px. `fr` was the wrong unit throughout: these three children have fixed
 * min-contents, and `fr` distributes free space that does not exist.
 *
 * Now: logo and account take exactly what they need (`auto`), the nav takes the
 * rest (`minmax(0, 1fr)` — the `0` floor is what finally lets it be squeezed),
 * and `justify-content: center` inside the nav keeps it optically centred
 * without a track pretending to reserve space for it.
 */
.header {
    /*
     * STICKY ONLY WHERE THE NAV IS COLLAPSED, and that restraint is the finding.
     *
     * `position: sticky` was already declared here with no inset — `top: auto`,
     * `z-index: auto`, measured — which never sticks, so the header has always
     * scrolled away and the declaration was decoration. Giving it a real
     * `top: 0` app-wide looked like a free fix and is not: /schedule's grid
     * carries `_corner` and `_day` at `sticky; top: 0` (z-index 3 and 2) and its
     * `_side` at `sticky; top: var(--space-5)`, so a 60px header above them
     * would hide the day-name row and the side column on the app's most
     * important surface.
     *
     * Below 1365px, though, `_grid` is `display: none` (the agenda replaces it)
     * and `_side` is `position: static` — so at `$navCollapseAt` and narrower
     * there is no competing sticky anywhere, and a header that stays put is
     * exactly what a phone wants: it is the only thing naming which section you
     * are in, and the only route to the others.
     *
     * Making this unconditional needs a `--header-height` custom property and
     * offsets on all three schedule elements, re-verified against the grid's
     * documented geometry. That is its own change.
     */
    position: sticky;

    @include navCollapsed() {
        z-index: 100;
        top: 0;
    }

    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: var(--space-5);
    align-items: center;

    width: 100%;
    padding: var(--space-4);

    background: $surface0;

    &-text {
        display: flex;
        align-items: center;
        justify-content: start;

        min-width: 0;
        margin-left: var(--space-7);

        color: $content2;
        text-decoration: none;

        /*
         * The lockup drops to its mark below `$navCollapseAt`, taking the logo
         * from a measured 223.3px to ~52px. That is the single largest saving
         * available in the bar and it costs nothing: the mark IS the "C" of
         * "Calendry" (the wordmark is the remaining "alendry"), and the
         * accessible name comes from this link's own `aria-label`, not from the
         * hidden text — so the brand stays both legible and announced.
         */
        @include navCollapsed() {
            margin-left: var(--space-3);

            :deep(.logo_wordmark) {
                display: none;
            }
        }
    }

    &-container {
        display: flex;
        gap: 100px;
        align-items: center;
    }
}
</style>
