<template>
    <Teleport to="body">
        <div
            v-if="open"
            class="drawer"
            @click.self="close"
        >
            <div
                id="nav-drawer"
                ref="panelRef"
                class="drawer_panel"
                role="dialog"
                aria-modal="true"
                :aria-label="t('nav.shell.navigation')"
                @keydown.esc.prevent="close"
                @keydown.tab="trapFocus"
            >
                <header class="drawer_head">
                    <span class="drawer_title">Menu</span>
                    <button
                        ref="closeRef"
                        class="drawer_close"
                        type="button"
                        :aria-label="t('nav.shell.closeMenu')"
                        @click="close"
                    >
                        <Icon
                            name="material-symbols:close"
                            aria-hidden="true"
                        />
                    </button>
                </header>

                <nav
                    class="drawer_nav"
                    :aria-label="t('nav.shell.sections')"
                >
                    <!--
                        A link OR a button, because `NavEntry` sets exactly one
                        of `to` / `run` and every header entry happening to
                        carry `to` today is not a guarantee. `ViewMenu` already
                        handles both through `CommonButton`; hardcoding
                        `NuxtLink` here would break silently the first time an
                        action entry (a theme toggle, say) gains `inHeader`.
                    -->
                    <component
                        :is="entry.to ? NuxtLink : 'button'"
                        v-for="entry in entries"
                        :key="entry.id"
                        class="drawer_link"
                        :class="{ 'drawer_link--on': entry.active }"
                        :to="entry.to"
                        :type="entry.to ? undefined : 'button'"
                        :aria-current="entry.active ? 'page' : undefined"
                        @click="runEntry(entry)"
                    >
                        <Icon
                            class="drawer_icon"
                            :name="entry.icon"
                            aria-hidden="true"
                        />
                        <span class="drawer_label">{{ entry.label }}</span>
                        <span
                            v-if="entry.description"
                            class="drawer_hint"
                        >{{ entry.description }}</span>
                    </component>
                </nav>

                <!--
                    THE SIDEBAR'S SECTIONS, grouped exactly as `CommonAppShell`
                    groups them (`useAppSections` + `groupNavEntries`, the same
                    two calls). Below 820px the shell renders no sidebar at all
                    (see its own comment), so this drawer is the ONLY way from
                    one management page to its siblings on a phone; without
                    these groups the manage area would be reachable solely
                    through the dashboard hub. Compact rows, no blurb: the
                    header entries above are three destinations a first-time
                    reader needs explained, these are a directory to scan.
                -->
                <nav
                    v-if="groups.length"
                    class="drawer_sections"
                    :aria-label="t('nav.shell.sections')"
                >
                    <div
                        v-for="group in groups"
                        :key="group.id"
                        class="drawer_group"
                    >
                        <h3 class="drawer_group-label">{{ group.label }}</h3>
                        <NuxtLink
                            v-for="entry in group.entries"
                            :key="entry.id"
                            class="drawer_section"
                            :class="{ 'drawer_section--on': entry.active }"
                            :to="entry.to!"
                            :aria-current="entry.active ? 'page' : undefined"
                            @click="close"
                        >
                            <Icon
                                class="drawer_section-icon"
                                :name="entry.icon"
                                aria-hidden="true"
                            />
                            <span>{{ entry.label }}</span>
                        </NuxtLink>
                    </div>
                </nav>

                <!--
                    Search reaches the drawer because the header's own search
                    button is `display: none` below 1366px and Ctrl+K needs a
                    keyboard. Without this row the command palette (a real
                    feature, and the fastest route to every section) is simply
                    unreachable on a phone.
                -->
                <button
                    class="drawer_search"
                    type="button"
                    @click="openPalette"
                >
                    <Icon
                        class="drawer_icon"
                        name="material-symbols:search"
                        aria-hidden="true"
                    />
                    <span class="drawer_label">Search</span>
                    <span class="drawer_hint">{{ t('nav.shell.jumpToSection') }}</span>
                </button>
            </div>
        </div>
    </Teleport>
</template>

<script setup lang="ts">
import { useT } from '~/composables/i18n';
import type { ResolvedNavEntry } from '~/composables/navigation';
import { useAppSections, useHeaderNav } from '~/composables/navigation';
import { groupNavEntries } from '~/utils/navGroups';
import { useOverlay } from '~/composables/overlay';

const { t } = useT();

/**
 * The narrow-viewport navigation, opened from `ViewMenu`'s menu button.
 *
 * Split out of `ViewMenu` rather than inlined: the bar and the drawer are two
 * presentations of one permission-filtered registry, and keeping the overlay's
 * focus, keyboard and scroll-lock machinery here leaves `ViewMenu` about the bar.
 *
 * PERMISSIONS: like the palette, this filters nothing. Its whole input is
 * `useHeaderNav()`, which has already dropped anything the caller cannot open,
 * so no code path here can surface a hidden section.
 *
 * OPEN STATE IS SHARED, not a prop: this is mounted once in the default layout
 * (beside the command palette, for the same reason) while the button that opens
 * it lives in `ViewMenu`. `useState` is how the two meet without a second
 * instance of the focus trap, the overlay claim and the scroll lock, and
 * `aria-controls="nav-drawer"` on that button still resolves to the dialog
 * below, because a Teleport moves the node but keeps its id.
 */
const open = useState('calendry.nav.open', () => false);

const entries = useHeaderNav();

/* The one taxonomy the sidebar reads, so the drawer and the sidebar can never
   disagree about what belongs where. Permission-filtered upstream. */
const sections = useAppSections();
const groups = computed(() => groupNavEntries(sections.value, t));

/*
 * Resolved rather than imported: `NuxtLink` is a globally-registered component,
 * and `<component :is>` needs the definition, not the name: passing the string
 * works only for real HTML tags.
 */
const NuxtLink = resolveComponent('NuxtLink');

/*
 * Claims the keyboard for as long as it is open, so page-level Escape handlers
 * (`useScheduleEditing` binds one on `window`) stand down instead of unwinding a
 * placement the user never meant to cancel. Released on close AND on unmount:
 * `useOverlay` does the second whether or not this component remembers to.
 */
const { claim, release } = useOverlay('nav-drawer');

const panelRef = ref<HTMLElement | null>(null);
const closeRef = ref<HTMLElement | null>(null);

/** Where focus came from, so it can be given back rather than dropped to body. */
let opener: HTMLElement | null = null;

const paletteOpen = useState('calendry.palette.open', () => false);

function close() {
    open.value = false;
}

/**
 * Closing on activation covers both entry shapes: a `to` entry navigates and the
 * drawer must not survive the route change, and a `run` entry does its thing
 * with the sheet already on its way out.
 */
function runEntry(entry: ResolvedNavEntry) {
    entry.run?.();
    close();
}

function openPalette() {
    open.value = false;
    paletteOpen.value = true;
}

/**
 * Focus follows OPENING, not mounting: the panel is `v-if`'d, so nothing inside
 * it exists until then. The same watcher owns the claim and the scroll lock so
 * the three cannot drift apart; each is keyed on the state, never on the
 * function that changed it.
 */
watch(open, async (isOpen) => {
    if (isOpen) {
        opener = document.activeElement as HTMLElement | null;
        claim();
        document.body.style.overflow = 'hidden';

        await nextTick();
        closeRef.value?.focus();

        return;
    }

    release();
    document.body.style.overflow = '';
    opener?.focus();
    opener = null;
});

onBeforeUnmount(() => {
    document.body.style.overflow = '';
});

/**
 * A real cycling trap, unlike the palette's: that dialog holds one focusable
 * element and can trap by refusing to move; this one holds a close button, every
 * nav link and a search row.
 */
function trapFocus(event: KeyboardEvent) {
    const panel = panelRef.value;

    if (!panel) return;

    const focusable = [...panel.querySelectorAll<HTMLElement>('a[href], button')]
        .filter((el) => !el.hasAttribute('disabled'));

    if (focusable.length === 0) return;

    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    const active = document.activeElement;

    if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
    } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
    }
}

/*
 * Close when the viewport crosses back to the inline bar. Without this, opening
 * the drawer on a phone and rotating to landscape leaves a modal over a header
 * that is already showing the same links, and the menu button that would close
 * it is `display: none` by then, so it is a trap with no visible exit.
 *
 * The query mirrors `$navCollapseAt` in `variables.scss`; one number, two
 * languages, which is the reason it is named in both places rather than inlined.
 */
onMounted(() => {
    const wide = window.matchMedia('(min-width: 820px)');
    const sync = () => {
        if (wide.matches) close();
    };

    wide.addEventListener('change', sync);
    onBeforeUnmount(() => wide.removeEventListener('change', sync));
});
</script>

<style scoped lang="scss">
.drawer {
    position: fixed;
    z-index: 210;
    inset: 0;

    display: flex;
    justify-content: flex-end;

    // `black`, not the theme-relative `content0`. See `ScheduleFilterPanel`'s
    // own comment on this exact backdrop rule for why: `content0` flips to
    // near-white in dark mode, turning a dimming scrim into a light wash.
    background: varToRgba('black', 0.45);

    &_panel {
        // Its own scroller: with every management section in it the panel
        // is taller than a phone, and a fixed sheet that cannot scroll simply
        // cuts the last group off.
        scrollbar-width: thin;

        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: var(--space-5);

        width: 100%;
        max-width: 320px;
        padding: var(--space-6);
        // The home indicator on a notched phone sits over the panel's foot;
        // `max()` keeps the normal inset when there is no inset to respect.
        padding-bottom: max(var(--space-6), env(safe-area-inset-bottom));

        background: $surface1;
        box-shadow: -24px 0 60px varToRgba('black', 0.28);
    }

    &_head {
        display: flex;
        align-items: center;
        justify-content: space-between;
    }

    &_title {
        font-size: var(--font-size-xs);
        font-weight: 700;
        color: $content7;
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }

    &_close {
        cursor: pointer;

        display: flex;
        align-items: center;
        justify-content: center;

        // 44px, the touch minimum this drawer exists to serve.
        width: 44px;
        height: 44px;
        border: 1px solid $surface4;
        border-radius: var(--radius-lg);

        color: $content4;

        background: $surface0;

        .iconify {
            width: 20px;
            height: 20px;
        }
    }

    &_nav {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
    }

    &_link,
    &_search {
        cursor: pointer;

        display: grid;
        grid-template-columns: auto 1fr;
        gap: 0 var(--space-4);
        align-items: center;

        // 44px minimum via padding on a 2-line row, so the target is the row.
        padding: var(--space-4) var(--space-5);
        border: 1px solid transparent;
        border-radius: var(--radius-lg);

        font-family: inherit;
        text-align: left;
        text-decoration: none;

        background: $surface0;
    }

    &_icon {
        grid-row: 1 / span 2;
        width: 20px;
        height: 20px;
        color: $content7;
    }

    &_label {
        font-size: var(--font-size-md);
        font-weight: 650;
        color: $content2;
    }

    &_hint {
        font-size: var(--font-size-sm);
        line-height: 1.4;
        color: $content7;
    }

    &_link--on {
        border-color: $primary500;

        .drawer_icon {
            color: $primary700;
        }
    }

    &_sections {
        display: flex;
        flex-direction: column;
        gap: var(--space-5);

        padding-top: var(--space-5);
        border-top: 1px solid $surface3;
    }

    &_group {
        display: flex;
        flex-direction: column;
        gap: 1px;

        /* The 11px uppercase register the sidebar's own group headings use. */
        &-label {
            margin: 0 0 var(--space-2);
            padding: 0 var(--space-5);

            font-size: var(--font-size-xs);
            font-weight: 650;
            color: $content7;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }
    }

    /* Same row as the sidebar's link, at the drawer's 44px touch height. */
    &_section {
        display: flex;
        gap: var(--space-4);
        align-items: center;

        min-height: 44px;
        padding: var(--space-3) var(--space-5);
        border-radius: var(--radius-lg);

        font-size: var(--font-size-md);
        font-weight: 600;
        color: $content5;
        text-decoration: none;

        &-icon {
            flex: none;
            width: 18px;
            height: 18px;
            color: $surface7;
        }

        &--on {
            color: $content0Orig;
            background: $primary500;

            .drawer_section-icon { color: $content0Orig; }
        }
    }

    // The panel is the only thing on screen at this size; nothing above 819px
    // can open it, but a stale `open` should never paint a half-width sheet.
    @include navInline() {
        display: none;
    }
}
</style>
