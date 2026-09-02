<template>
    <div class="shell">
        <nav
            class="shell_nav"
            :class="{ 'shell_nav--rail': collapsed }"
            :aria-label="t('nav.shell.sections')"
        >
            <!--
                The rail toggle. `aria-expanded` on a button that controls the
                nav it sits inside, and the accessible name says what the press
                will DO rather than what the state is, so a screen reader is
                not told "collapsed" while looking at an expanded sidebar.
            -->
            <button
                class="shell_nav-toggle"
                type="button"
                :aria-expanded="!collapsed"
                :title="collapsed ? t('nav.shell.expandSidebar') : t('nav.shell.collapseSidebar')"
                @click="toggle"
            >
                <Icon
                    :name="collapsed ? 'material-symbols:right-panel-close-outline' : 'material-symbols:left-panel-close-outline'"
                    aria-hidden="true"
                />
                <span class="shell_nav-text">{{ collapsed ? t('nav.shell.expandSidebar') : t('nav.shell.collapseSidebar') }}</span>
            </button>

            <NuxtLink
                v-if="homeEntry"
                class="shell_nav-link"
                :class="{ 'shell_nav-link--active': homeEntry.active }"
                :to="homeEntry.to!"
                :title="collapsed ? homeEntry.label : undefined"
            >
                <Icon
                    :name="homeEntry.icon"
                    aria-hidden="true"
                />
                <span class="shell_nav-text">{{ homeEntry.label }}</span>
            </NuxtLink>

            <!--
                FORCED OPEN IN RAIL MODE. Collapsed, the summary is hidden and
                its label is clipped, so a closed topic would be a heading you
                cannot see hiding icons you cannot reach. The reader's own
                collapsed state is remembered and comes back when they expand
                the sidebar again.
            -->
            <details
                v-for="group in navGroups"
                :key="group.id"
                class="shell_nav-group"
                :open="collapsed || !isClosed(group.id)"
                @toggle="onGroupToggle(group.id, $event)"
            >
                <summary class="shell_nav-group-summary">
                    <Icon
                        class="shell_nav-group-chevron"
                        name="material-symbols:keyboard-arrow-down"
                        aria-hidden="true"
                    />
                    <span class="shell_nav-group-label shell_nav-text">{{ group.label }}</span>
                </summary>
                <NuxtLink
                    v-for="section in group.entries"
                    :key="section.id"
                    class="shell_nav-link"
                    :class="{ 'shell_nav-link--active': section.active }"
                    :to="section.to!"
                    :title="collapsed ? section.label : undefined"
                >
                    <Icon
                        :name="section.icon"
                        aria-hidden="true"
                    />
                    <span class="shell_nav-text">{{ section.label }}</span>
                </NuxtLink>
            </details>
        </nav>

        <section class="shell_body">
            <header class="shell_head">
                <div class="shell_head-text">
                    <NuxtLink
                        v-if="backTo"
                        class="shell_back"
                        :to="backTo"
                    >
                        <Icon
                            name="material-symbols:arrow-back"
                            aria-hidden="true"
                        />
                        {{ backLabel }}
                    </NuxtLink>
                    <h1>{{ title }}</h1>
                    <p v-if="description">{{ description }}</p>
                    <!--
                        For the page's own SUBJECT, not more prose: the term and
                        week `/dashboard` states here scope every number below
                        them, so they belong in the heading block rather than
                        floating above the content as a fourth strip. A slot
                        rather than another string prop because what goes in it
                        carries its own states (a term that has not started, a
                        tenant with none, a failed read) and a page that has no
                        subject line renders nothing at all.
                    -->
                    <slot name="meta"/>
                </div>

                <div
                    v-if="$slots.actions"
                    class="shell_head-actions"
                >
                    <slot name="actions"/>
                </div>
            </header>

            <slot/>
        </section>
    </div>
</template>

<script setup lang="ts">
import { useAppSections, useNavEntries } from '~/composables/navigation';
import { groupNavEntries } from '~/utils/navGroups';
import { useNavGroupCollapse, useNavRail } from '~/composables/navRail';
import { useT } from '~/composables/i18n';

/**
 * The app's one signed-in frame: a persistent, grouped section list beside
 * the content. Originally `/manage`'s own shell; `/dashboard` folded its
 * separate hub page into this same frame rather than building a second,
 * competing sidebar, so this now backs every `/manage/*` page AND
 * `/dashboard`, and the name says so.
 *
 * A component rather than a Nuxt layout on purpose. A layout REPLACES the
 * default one, so a shell layout would have to restate the app header, the
 * toast container and the command palette, which would then exist
 * in two places and drift. The sidebar is derived from a registry with no
 * fetching, so re-rendering it per navigation costs nothing.
 *
 * The section list is `useAppSections()`, already permission-filtered: a
 * caller without `room.read` has no Rooms link here, in the header, or in Ctrl+K,
 * because all three ultimately read the same registry.
 */
defineProps<{
    title: string;
    description?: string;
    /** Renders a back link. Set on detail pages, absent on lists. */
    backTo?: string;
    backLabel?: string;
}>();

/**
 * `meta` is the heading block's own subject line (`/dashboard`'s term and
 * week), optional like `actions`: a page that has none passes nothing and the
 * slot renders nothing, with no wrapper element left behind to space around.
 */
defineSlots<{ default: () => unknown; actions?: () => unknown; meta?: () => unknown }>();

const sections = useAppSections();
const { t } = useT();

const { collapsed, toggle } = useNavRail();
const { isClosed, setOpen } = useNavGroupCollapse();

/*
 * Reads the element's own resulting state rather than inverting our own, so a
 * toggle by keyboard, by find-in-page expanding a closed topic, or by the
 * rail forcing one open all record the truth. `setOpen` ignores a write that
 * changes nothing, which is what stops the `:open` binding from feeding its
 * own event back in a loop.
 */
function onGroupToggle(groupId: string, event: Event) {
    // Rail mode forces every topic open; recording that would wipe the
    // reader's real choice the moment they collapsed the sidebar.
    if (collapsed.value) {
        return;
    }

    setOpen(groupId, (event.target as HTMLDetailsElement).open);
}

/*
 * TURNS ON THE FRAMED SCROLL for the routes that render this shell, and only
 * those: the rules live in `layout.scss` under `body.is-framed`. Registered
 * through `useHead` from inside the component, so Nuxt removes the class when
 * the shell unmounts and navigating to `/schedule` or `/` restores the document
 * scroll those surfaces require. See the long note on that block for why each
 * of them requires it.
 */
useHead({ bodyAttrs: { class: 'is-framed' } });

// The sidebar's permanent top link IS the header's own 'home' entry: one
// definition of where home is and what it's called, not a second copy of its
// icon/label/target hardcoded here.
const navEntries = useNavEntries();
const homeEntry = computed(() => navEntries.value.find((entry) => entry.id === 'home'));

/**
 * Groups the flat section list under scan-friendly headings.
 *
 * A path with no matching group is SILENTLY DROPPED from the sidebar, so
 * `NAV_GROUPS` lives in `~/utils/navGroups` where `tests/nav-groups.test.ts`
 * can import it and refuse that state. Read that module's note before adding a
 * route: the test is the only thing standing between a new destination and a
 * link that never appears.
 */
const navGroups = computed(() => groupNavEntries(sections.value, t));
</script>

<style scoped lang="scss">
.shell {
    /*
     * FILLS THE FRAME rather than growing the document. `body.is-framed` in
     * layout.scss hands this element a pane of exactly the remaining viewport;
     * `min-height: 0` is what lets the two scrollers inside it actually shrink
     * to that pane instead of expanding past it.
     */
    display: flex;
    flex: 1;
    gap: var(--space-7);
    align-items: stretch;

    min-height: 0;
    padding: var(--space-7) var(--space-7) var(--space-8);

    @include mobile() {
        flex-direction: column;
        gap: var(--space-6);
        align-items: stretch;
        padding: var(--space-5);
    }

    &_nav {
        /*
         * ITS OWN SCROLLER. A tenant granting every permission puts 31 links in
         * here, which is taller than a laptop viewport, and inside a fixed frame
         * an overflowing sidebar would simply be cut off with no way to reach
         * the last group.
         */
        overflow-y: auto;
        display: flex;
        flex: none;
        flex-direction: column;
        gap: var(--space-6);

        width: 210px;
        padding: var(--space-4);
        border-radius: var(--radius-xl);

        background: $surface1;

        /*
         * NO WIDTH TRANSITION, deliberately. Width is not compositable, so
         * animating it forces layout on every frame, and here that means
         * relaying 31 nav links plus the whole content pane beside them. The
         * rail snaps instead: this is a toggle the reader pressed, the layout
         * changing IS the feedback, and there is nothing a 160ms slide adds
         * except a frame budget on the app's most persistent chrome.
         */

        &--rail {
            width: 56px;
        }

        @include mobile() {
            overflow: auto visible;
            flex-direction: row;
            width: 100%;

            // The rail is a desktop affordance; a horizontal strip has no
            // second axis to reclaim, so mobile ignores the collapsed state.
            &.shell_nav--rail { width: 100%; }

            span { white-space: nowrap; }
        }

        &-link {
            display: flex;
            gap: var(--space-4);
            align-items: center;

            padding: var(--space-4) var(--space-5);
            border-radius: var(--radius-lg);

            font-size: var(--font-size-md);
            font-weight: 600;
            color: $content5;
            text-decoration: none;

            transition: 0.15s;

            svg {
                flex: none;
                width: 17px;
                height: 17px;
                color: $surface7;
            }
            @include hover() {
                &:hover {
                    color: $content2;
                    background: $surface2;
                }
            }

            /*
             * Ink on the fill, from the light base, in BOTH themes, not
             * `$surface0`. The teal fill does not follow the theme swap, so a
             * label that does is measured against the wrong ground in one of
             * them: `$surface0` is near-white in the light theme, which is
             * 3.14:1 on `$primary500` and fails AA, while reading 5.7:1 in the
             * dark theme where it resolves to ink. Pinning it to the ink value
             * gives the same 5.7:1 in both. Same reasoning as
             * `CommonButton --type-primary`.
             */
            &--active {
                color: $content0Orig;
                background: $primary500;

                svg { color: $content0Orig; }

                @include hover() {
                    &:hover {
                        color: $content0Orig;
                        background: $primary500;
                    }
                }
            }
        }

        /*
         * THE RAIL. Labels are CLIPPED, never `display: none`: the links keep
         * their accessible names, so a screen reader reads a collapsed sidebar
         * exactly as it reads an expanded one, and only the pixels go away.
         * `title` carries the same name to a sighted pointer user.
         */
        &--rail {
            .shell_nav-text {
                position: absolute;

                overflow: hidden;

                width: 1px;
                height: 1px;

                clip-path: inset(50%);
            }

            .shell_nav-link,
            .shell_nav-toggle {
                justify-content: center;
                padding: var(--space-4);
            }

            /*
             * The summary is REMOVED in rail mode, not clipped: its label is
             * already clipped and its chevron would toggle a topic whose
             * heading nobody can see. The hairline below carries the break.
             */
            .shell_nav-group-summary {
                display: none;
            }

            /*
             * The group heading's break survives as a hairline. Without it the
             * rail is one undifferentiated column of 31 icons, which is the
             * grouping thrown away again in a narrower shape.
             */
            .shell_nav-group + .shell_nav-group {
                padding-top: var(--space-4);
                border-top: 1px solid $surface3;
            }
        }

        &-toggle {
            cursor: pointer;

            display: flex;
            gap: var(--space-4);
            align-items: center;

            padding: var(--space-4) var(--space-5);
            border: 0;
            border-radius: var(--radius-lg);

            font-family: inherit;
            font-size: var(--font-size-xs);
            font-weight: 650;
            color: $content7;
            text-transform: uppercase;
            letter-spacing: 0.05em;

            background: none;

            transition: 0.15s;

            svg {
                flex: none;
                width: 17px;
                height: 17px;
                color: $surface7;
            }

            @include hover() {
                &:hover {
                    color: $content2;
                    background: $surface2;
                }
            }
        }

        &-group {
            display: flex;
            flex-direction: column;
            gap: var(--space-1);

            // The whole heading row toggles the topic, not just the chevron.
            &-summary {
                cursor: pointer;

                display: flex;
                gap: var(--space-2);
                align-items: center;

                margin: var(--space-4) 0 var(--space-1);
                padding: var(--space-2) var(--space-5);
                border-radius: var(--radius-lg);

                list-style: none;

                transition: 0.15s;

                &::-webkit-details-marker { display: none; }

                @include hover() {
                    &:hover {
                        background: $surface2;

                        .shell_nav-group-label { color: $content3; }
                    }
                }
            }

            &-chevron {
                flex: none;

                width: 14px;
                height: 14px;

                color: $surface7;

                transition: transform 160ms cubic-bezier(0.16, 1, 0.3, 1);
            }

            &:not([open]) &-chevron {
                transform: rotate(-90deg);
            }

            &-label {
                margin: 0;

                font-size: var(--font-size-xs);
                font-weight: 650;
                color: $content7;
                text-transform: uppercase;
                letter-spacing: 0.05em;
            }
        }
    }

    &_body {
        /*
         * THE CONTENT SCROLLER. This is the pane that moves when the reader
         * scrolls a long manage list, which is what keeps the page header, the
         * actions and the sidebar in place while it does.
         */
        overflow-y: auto;
        display: flex;
        flex: 1;
        flex-direction: column;
        gap: var(--space-6);

        min-width: 0;
        min-height: 0;

        @include mobile() {
            overflow-y: visible;
            min-height: 0;
        }
    }

    &_head {
        display: flex;
        gap: var(--space-6);
        align-items: flex-end;
        justify-content: space-between;

        @include mobile() {
            flex-direction: column;
            align-items: stretch;
        }

        &-text {
            display: flex;
            flex-direction: column;
            gap: var(--space-2);
        }

        &-actions {
            display: flex;
            flex: none;
            gap: var(--space-4);
        }

        h1 {
            margin: 0;
            font-size: var(--font-size-xl);
            font-weight: 680;
            color: $content1;
        }

        p {
            margin: 0;
            font-size: var(--font-size-md);
            color: $content7;
        }
    }

    &_back {
        display: flex;
        gap: var(--space-2);
        align-items: center;

        margin-bottom: var(--space-2);

        font-size: var(--font-size-sm);
        font-weight: 600;
        color: $content7;
        text-decoration: none;

        svg {
            width: 14px;
            height: 14px;
        }
        @include hover() {
            &:hover { color: $primary700; }
        }
    }
}
</style>
