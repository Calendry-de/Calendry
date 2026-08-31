<template>
    <div class="shell">
        <nav
            class="shell_nav"
            aria-label="Sections"
        >
            <NuxtLink
                v-if="homeEntry"
                class="shell_nav-link"
                :class="{ 'shell_nav-link--active': homeEntry.active }"
                :to="homeEntry.to!"
            >
                <Icon
                    :name="homeEntry.icon"
                    aria-hidden="true"
                />
                <span>{{ homeEntry.label }}</span>
            </NuxtLink>

            <div
                v-for="group in navGroups"
                :key="group.label"
                class="shell_nav-group"
            >
                <p class="shell_nav-group-label">{{ group.label }}</p>
                <NuxtLink
                    v-for="section in group.sections"
                    :key="section.id"
                    class="shell_nav-link"
                    :class="{ 'shell_nav-link--active': section.active }"
                    :to="section.to!"
                >
                    <Icon
                        :name="section.icon"
                        aria-hidden="true"
                    />
                    <span>{{ section.label }}</span>
                </NuxtLink>
            </div>
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

/**
 * The app's one signed-in frame: a persistent, grouped section list beside
 * the content. Originally `/manage`'s own shell; `/dashboard` folded its
 * separate hub page into this same frame rather than building a second,
 * competing sidebar — so this now backs every `/manage/*` page AND
 * `/dashboard`, and the name says so.
 *
 * A component rather than a Nuxt layout on purpose. A layout REPLACES the
 * default one, so a shell layout would have to restate the app header, the
 * toast container and the command palette — three things that would then exist
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

defineSlots<{ default: () => unknown; actions?: () => unknown }>();

const sections = useAppSections();

// The sidebar's permanent top link IS the header's own 'home' entry — one
// definition of where home is and what it's called, not a second copy of its
// icon/label/target hardcoded here.
const navEntries = useNavEntries();
const homeEntry = computed(() => navEntries.value.find((entry) => entry.id === 'home'));

/**
 * Groups the flat section list under scan-friendly headings. Membership is
 * keyed by route path rather than a `section.group` field on
 * `ResolvedNavEntry` — adding one is a bigger change than this grouping
 * warrants. A path with no matching group (a route nobody has classified yet)
 * is silently dropped from the sidebar; extend `NAV_GROUPS` when adding a
 * route here.
 */
const NAV_GROUPS: { label: string; paths: string[] }[] = [
    { label: 'Schedule', paths: ['/schedule', '/schedule/proposals'] },
    {
        label: 'My settings',
        paths: [
            '/my',
            '/my/availability',
            '/my/exams',
            '/my/preferences',
            '/my/teaching-pattern',
            '/my/account',
        ],
    },
    { label: 'People', paths: ['/manage/persons', '/manage/roles', '/manage/availability/preferences'] },
    { label: 'Resources', paths: ['/manage/rooms', '/manage/equipment', '/manage/groups', '/manage/screens'] },
    {
        label: 'Curriculum',
        paths: [
            '/manage/time-grids',
            '/manage/session-kinds',
            '/manage/offerings',
            '/manage/offering-templates',
            '/manage/offering-plans',
            '/manage/constraints',
            '/manage/terms',
            '/manage/calendar-periods',
        ],
    },
    {
        label: 'Access & review',
        paths: [
            '/manage/accounts',
            '/manage/access-roles',
            '/manage/access-defaults',
            '/manage/display',
            '/manage/exams/reviews',
            '/manage/availability/reviews',
        ],
    },
];

const navGroups = computed(() => NAV_GROUPS
    .map((group) => ({
        label: group.label,
        sections: sections.value.filter((section) => group.paths.includes(section.to!)),
    }))
    .filter((group) => group.sections.length > 0));
</script>

<style scoped lang="scss">
.shell {
    display: flex;
    gap: var(--space-7);
    align-items: flex-start;
    padding: var(--space-7) var(--space-7) var(--space-8);

    @include mobile() {
        flex-direction: column;
        gap: var(--space-6);
        padding: var(--space-5);
    }

    &_nav {
        position: sticky;
        top: var(--space-7);

        display: flex;
        flex: none;
        flex-direction: column;
        gap: var(--space-6);

        width: 210px;
        padding: var(--space-4);
        border-radius: var(--radius-xl);

        background: $surface1;

        @include mobile() {
            position: static;
            overflow-x: auto;
            flex-direction: row;
            width: 100%;

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
             * Ink on the fill, from the light base, in BOTH themes — not
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

        &-group {
            display: flex;
            flex-direction: column;
            gap: var(--space-1);

            &-label {
                margin: var(--space-4) var(--space-5) 0;

                font-size: var(--font-size-xs);
                font-weight: 650;
                letter-spacing: 0.05em;
                text-transform: uppercase;
                color: $content7;
            }
        }
    }

    &_body {
        display: flex;
        flex: 1;
        flex-direction: column;
        gap: var(--space-6);

        min-width: 0;
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
