<template>
    <nav
        class="header__menu"
        aria-label="Main"
    >
        <!--
            The menu button and the inline links are the same registry rendered
            two ways, and exactly one is visible at a time: CSS decides which,
            at `$navCollapseAt`. Both are always in the DOM so the switch needs
            no JS and cannot disagree with the stylesheet.
        -->
        <button
            class="header__menu_toggle"
            type="button"
            :aria-expanded="drawerOpen"
            aria-controls="nav-drawer"
            aria-label="Menu"
            @click="drawerOpen = true"
        >
            <Icon
                name="material-symbols:menu"
                aria-hidden="true"
            />
        </button>

        <div class="header__menu_links">
            <CommonButton
                v-for="entry in headerNav"
                :key="entry.id"
                :icon="entry.icon"
                :to="entry.to"
                :type="entry.active ? 'primary' : 'secondary'"
                @click="entry.run?.()"
            >
                {{ entry.label }}
            </CommonButton>
        </div>

        <button
            class="header__menu_search"
            type="button"
            aria-label="Search (Ctrl K)"
            @click="openPalette()"
        >
            <Icon
                name="material-symbols:search"
                aria-hidden="true"
            />
            <kbd>{{ shortcutLabel }}</kbd>
        </button>
    </nav>
</template>

<script setup lang="ts">
import { useHeaderNav } from '~/composables/navigation';

/**
 * Top-level navigation, driven by the permission-filtered nav registry.
 *
 * The previous version gated the one non-Home item on `store.me?.isAdmin` from
 * the template's WebUser stub, and rendered a hover-dropdown for children that
 * no entry ever had. Both are gone; entries come from `useHeaderNav()`.
 *
 * Active/inactive uses `primary`/`secondary` rather than the old
 * `secondary-875`, which CommonButton accepts but has no styles for. One of
 * the two callers of that unimplemented variant is now off it.
 */
const headerNav = useHeaderNav();

// Opened by writing the shared state rather than calling into the palette
// composable: that composable owns a keydown listener and an overlay claim, and
// instantiating a second copy here would register both twice.
const paletteOpen = useState('calendry.palette.open', () => false);

function openPalette() {
    paletteOpen.value = true;
}

/*
 * The drawer is MOUNTED IN THE LAYOUT, beside the command palette, and opened
 * from here by writing this shared flag, the same split, for the same reason.
 * The drawer owns a focus trap, an overlay claim and a body scroll lock; a
 * second instance rendered from this component would hold all three twice, and
 * a leaked overlay claim silently stops Escape working on /schedule.
 */
const drawerOpen = useState('calendry.nav.open', () => false);

// Cosmetic only; the handler accepts either modifier regardless of platform.
const shortcutLabel = ref('Ctrl K');

onMounted(() => {
    if (navigator.platform.toLowerCase().includes('mac')) {
        shortcutLabel.value = '⌘ K';
    }
});
</script>

<style scoped lang="scss">
.header__menu {
    display: flex;
    gap: var(--space-6);
    align-items: center;
    justify-content: center;

    // `min-width: 0` so this can actually be squeezed. As a grid item its
    // default `min-width: auto` refused to shrink below the min-content of four
    // non-wrapping buttons, which is how 443px of nav became a 781px document.
    min-width: 0;

    /*
     * Exactly one of these two is visible, decided by `$navCollapseAt`.
     * `justify-content: center` above is why the collapsed bar still reads as
     * centred with only a 44px button in it.
     */
    &_toggle {
        cursor: pointer;

        display: none;
        align-items: center;
        justify-content: center;

        // 44px: this is the ONLY way to reach any other section on a phone, so
        // it gets the full touch target rather than the 25px the old inline
        // buttons happened to be.
        width: 44px;
        height: 44px;
        border: 1px solid $surface4;
        border-radius: var(--radius-lg);

        color: $content4;

        background: $surface1;

        .iconify {
            width: 22px;
            height: 22px;
        }

        @include navCollapsed() {
            display: flex;
        }
    }

    &_links {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-6);
        align-items: center;
        justify-content: center;

        min-width: 0;

        @include navCollapsed() {
            display: none;
        }
    }

    &_search {
        cursor: pointer;

        display: flex;
        gap: var(--space-3);
        align-items: center;

        padding: var(--space-3) var(--space-5);
        border: 1px solid $surface4;
        border-radius: var(--radius-lg);

        color: $content7;

        background: $surface1;

        transition: 0.2s;

        // `.iconify`, not `svg`: `Icon` renders an Iconify span, so this rule
        // matched nothing and the glyph sat at its inherited 1em (13.3px
        // measured) instead of 16px.
        .iconify {
            width: 16px;
            height: 16px;
        }

        kbd {
            font-family: inherit;
            font-size: var(--font-size-xs);
            color: $surface7;
        }

        @include hover() {
            &:hover {
                border-color: $surface5;
                color: $content4;
            }
        }

        @include mobile() { display: none; }
    }
}
</style>
