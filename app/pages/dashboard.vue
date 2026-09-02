<template>
    <CommonAppShell
        :title="session?.activeTenant?.name ?? 'Dashboard'"
        :description="greeting"
    >
        <!--
            The signed-in home. It moved here from `/` when the public landing
            page took the root, and folded in `/manage`'s own hub page on top
            of that: signing in used to be three hops from anything useful
            (dashboard → the /manage cards grid → an entity page) for no
            reason but the cards grid existing at all. `CommonAppShell`'s
            sidebar already covers Schedule and My settings, so this page's
            own content is just what's specific to landing here: the
            manage-entities overview, the account actions, and the session's
            own permission list.
        -->
        <template #actions>
            <CommonButton
                v-if="(session?.availableTenants.length ?? 0) > 1"
                type="secondary"
                :disabled="busy"
                @click="switchTenant"
            >Switch institution</CommonButton>

            <CommonButton
                type="secondary-black"
                :disabled="busy"
                @click="signOut"
            >{{ busy ? 'Signing out…' : 'Sign out' }}</CommonButton>
        </template>

        <Transition name="dash-error">
            <p
                v-if="actionError"
                class="dash_error"
                role="alert"
            >{{ actionError }}</p>
        </Transition>

        <DashboardInstitutionCounts
            :counts="counts ?? []"
            :pending="countsStatus === 'pending'"
        />

        <!--
            GROUPED BY `groupNavEntries`, the same helper the sidebar reads.
            This was one flat `auto-fill` grid of 24 undifferentiated cards:
            every destination the same size, the same weight and in no order a
            reader could name, sitting beside a sidebar that grouped the very
            same routes under headings. The taxonomy already existed; the more
            prominent surface was the one throwing it away.

            No card containers. The old ones were `$surface1` with a
            transparent border on a `$surface1` page ground, so they had no
            visible edge at rest at all: boxes in name only. Proximity and
            the label register do the grouping now, which is what the sidebar
            beside them already does.
        -->
        <div
            v-if="groups.length"
            class="dash_groups"
        >
            <!--
                A NATIVE `details`, not a v-model'd div. It brings keyboard
                operation, the disclosure role, find-in-page expanding a closed
                group, and Escape behaviour for free, and it needs no JS at all.
                Open by default: a topic collapsed on arrival hides the
                destinations that are the reason to be here.
            -->
            <details
                v-for="(group, index) in groups"
                :key="group.label"
                class="dash_group"
                :style="{ '--stagger-index': index }"
                open
            >
                <summary class="dash_group-summary">
                    <Icon
                        class="dash_group-chevron"
                        name="material-symbols:keyboard-arrow-down"
                        aria-hidden="true"
                    />
                    <h2 class="dash_group-label">{{ group.label }}</h2>
                    <!--
                        The count is what makes a COLLAPSED topic still worth
                        reading: it says how much is behind it rather than
                        leaving a bare label.
                    -->
                    <span class="dash_group-count">{{ group.entries.length }}</span>
                </summary>

                <ul class="dash_group-list">
                    <li
                        v-for="entry in group.entries"
                        :key="entry.id"
                    >
                        <NuxtLink
                            class="dash_link"
                            :to="entry.to!"
                        >
                            <Icon
                                class="dash_link-icon"
                                :name="entry.icon"
                                aria-hidden="true"
                            />
                            <span class="dash_link-label">{{ entry.label }}</span>
                            <span class="dash_link-hint">{{ entry.description }}</span>
                        </NuxtLink>
                    </li>
                </ul>
            </details>
        </div>

        <!--
            Reachable state, not a dead end: a person with a session but no
            management read permission lands here, and is told which fact is
            true rather than shown an empty grid that could equally mean the
            page failed to load. Scoped to just this list: the sidebar may
            still offer Schedule/My settings links even when nobody has
            granted this person a management permission.
        -->
        <p
            v-else
            class="dash_empty"
        >
            You do not have read access to any management section in this
            institution. An administrator can grant it through your access role.
        </p>

        <DashboardPermissionSummary
            v-if="session"
            :permissions="session.permissions"
        />
    </CommonAppShell>
</template>

<script setup lang="ts">
import CommonAppShell from '~/components/common/CommonAppShell.vue';
import DashboardInstitutionCounts from '~/components/dashboard/InstitutionCounts.vue';
import DashboardPermissionSummary from '~/components/dashboard/PermissionSummary.vue';
import { logout, useSession } from '~/composables/session';
import { useManageSections } from '~/composables/navigation';
import { groupNavEntries } from '~/utils/navGroups';
import { useInstitutionCounts } from '~/composables/dashboardCounts';

useHead({ title: 'Home' });

const session = useSession();

// The manage-entities overview: what `/manage/index.vue` used to render on
// its own separate hub page. Schedule and My settings are one click away in
// CommonAppShell's sidebar already, so this list is deliberately scoped to
// just the entities, the one group numerous and varied enough to earn a
// described destination rather than a bare link.
const sections = useManageSections();

// The one taxonomy, not a second one authored here: `groupNavEntries` is what
// the sidebar groups by too, so the headings a visitor reads in the nav and
// the headings they read here are the same list in the same order.
const groups = computed(() => groupNavEntries(sections.value));

/*
 * THE TOP-LEVEL AWAIT LIVES HERE, not in the composable: `useInstitutionCounts`
 * stays synchronous so it keeps its Nuxt instance, and this page is what waits
 * for the first render's data. Awaiting also means SSR ships real numbers
 * rather than a skeleton the client has to replace.
 */
const { data: counts, status: countsStatus } = await useInstitutionCounts();

const greeting = computed(() => {
    const person = session.value?.activePerson;

    return person ? `Signed in as ${ person.givenName } ${ person.familyName }` : undefined;
});

// Shared between the two actions below: only one of them is ever reachable at
// a time (the buttons this guards render side by side), and both leave the
// page, so there is nothing to distinguish per-button.
const busy = ref(false);
const actionError = ref('');

/**
 * Switching goes back through the login page's selection step rather than
 * duplicating that UI here: the server treats a switch as a session mutation,
 * so no re-authentication is needed, only a new choice.
 */
async function switchTenant() {
    if (busy.value) {
        return;
    }

    busy.value = true;
    actionError.value = '';

    try {
        await navigateTo('/login?select=1');
    } finally {
        busy.value = false;
    }
}

/**
 * `logout()` hits the network before it clears local state, same guard shape
 * as login.vue's actions, so a slow or offline request cannot be fired twice
 * from one impatient click and a failure leaves a visible message rather than
 * silently doing nothing.
 */
async function signOut() {
    if (busy.value) {
        return;
    }

    busy.value = true;
    actionError.value = '';

    try {
        await logout();
    } catch {
        actionError.value = 'Could not sign out. Check your connection and try again.';
    } finally {
        busy.value = false;
    }
}
</script>

<style scoped lang="scss">
.dash {
    /*
     * Rhythm is the grouping: 32px between groups against 8px from a heading
     * to its own list, so the gaps say what belongs together before any label
     * is read. `--space-8` is the in-app ceiling on this scale; the larger
     * steps are the public landing surface's.
     */
    &_groups {
        display: flex;
        flex-direction: column;
        gap: var(--space-8);
    }

    &_group {
        /*
         * The one authored moment on this page, and it arrives per GROUP
         * rather than per destination. Staggering 24 cards individually read
         * as a scripted queue; five groups reads as the page settling, and it
         * lands inside a quarter second.
         */
        animation: dash-reveal 320ms cubic-bezier(0.16, 1, 0.3, 1) both;
        animation-delay: calc(var(--stagger-index, 0) * 50ms);

        /*
         * The whole summary is the hit target, so the topic toggles from
         * anywhere along its heading rather than from a chevron the size of a
         * full stop. `list-style: none` plus the WebKit pseudo-element removes
         * the native marker in every engine that ships one.
         */
        &-summary {
            cursor: pointer;

            display: flex;
            gap: var(--space-3);
            align-items: baseline;

            margin-bottom: var(--space-4);
            padding: var(--space-2) var(--space-5);
            border-radius: var(--radius-lg);

            list-style: none;

            transition: 0.15s;

            &::-webkit-details-marker { display: none; }

            @include hover() {
                &:hover {
                    background: $surface2;

                    .dash_group-label { color: $content3; }
                }
            }
        }

        /*
         * The 11px uppercase label register, which DESIGN.md reserves for
         * exactly this and which the sidebar's own group headings already use.
         * An `h2` inside the `summary` rather than beside it: the heading stays
         * in the document outline, and it is also the disclosure's own name.
         */
        &-label {
            margin: 0;

            font-size: var(--font-size-xs);
            font-weight: 650;
            color: $content7;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }

        /*
         * Tabular, because it sits in a column of other counts and these are
         * values that change when a permission changes.
         */
        &-count {
            font-size: var(--font-size-xs);
            font-variant-numeric: tabular-nums;
            color: $surface7;
        }

        /*
         * Rotates to point at the content it reveals. `transform` only, so it
         * composites, and the site-wide reduced-motion rule zeroes the duration
         * without needing a rule of its own here.
         */
        &-chevron {
            flex: none;

            width: 15px;
            height: 15px;

            color: $surface7;

            transition: transform 160ms cubic-bezier(0.16, 1, 0.3, 1);
        }

        &:not([open]) &-chevron {
            transform: rotate(-90deg);
        }

        &-list {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
            gap: var(--space-2);

            margin: 0;
            padding: 0;

            list-style: none;
        }
    }

    /*
     * Same shape, padding and hover as `CommonAppShell`'s sidebar link, on
     * purpose: this page and the nav offer the same destinations, so they
     * should feel like one control repeated rather than two designs of it.
     * What this one adds is the description, which is the whole reason to
     * land here rather than read the sidebar.
     */
    &_link {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        gap: var(--space-1) var(--space-4);
        align-items: baseline;

        padding: var(--space-4) var(--space-5);
        border-radius: var(--radius-lg);

        text-decoration: none;

        transition: 0.15s;

        @include hover() {
            &:hover {
                background: $surface2;

                .dash_link-label { color: $content1; }
            }
        }

        /*
         * `$surface7`, not the accent. Teal on 24 icons at once was the One
         * Signal Rule broken at scale: the colour that means "the system is
         * offering you something to act on" cannot also be the colour of
         * every icon on the home page. The nav's icons are this value.
         */
        &-icon {
            /* Optical: aligns the glyph's body to the label's cap height rather than its baseline. */
            transform: translateY(2px);

            grid-row: 1 / span 2;

            width: 17px;
            height: 17px;

            color: $surface7;
        }

        &-label {
            font-size: var(--font-size-md);
            font-weight: 600;
            color: $content5;
            transition: 0.15s;
        }

        &-hint {
            font-size: var(--font-size-sm);
            line-height: var(--leading-prose);
            color: $content7;
        }
    }

    &_empty {
        max-width: 52ch;
        margin: 0;
        padding: var(--space-8) var(--space-7);
        border-radius: var(--radius-xl);

        font-size: var(--font-size-md);
        line-height: var(--leading-prose);
        color: $content7;

        background: $surface0;
    }

    &_error {
        margin: 0;
        font-size: var(--font-size-md);
        color: $error600;
    }
}

@keyframes dash-reveal {
    from {
        transform: translateY(6px);
        opacity: 0;
    }

    to {
        transform: translateY(0);
        opacity: 1;
    }
}

// A network failure telling you nothing happened, or the user retrying,
// deserves an arrival of its own rather than a jump-cut in the layout.
.dash-error-enter-active {
    transition: opacity 200ms cubic-bezier(0.16, 1, 0.3, 1), transform 200ms cubic-bezier(0.16, 1, 0.3, 1);
}

.dash-error-leave-active {
    transition: opacity 120ms ease-in, transform 120ms ease-in;
}

.dash-error-enter-from,
.dash-error-leave-to {
    transform: translateY(-4px);
    opacity: 0;
}

/*
 * The site-wide rule in layout.scss zeroes every transition/animation
 * DURATION under reduced motion, but not `animation-delay`. Left alone, a
 * reduced-motion visitor would still wait up to 250ms staring at invisible
 * groups before they snapped into view. Zeroing the delay here is what makes
 * that wait disappear along with the motion.
 */
@media (prefers-reduced-motion: reduce) {
    .dash_group {
        animation-delay: 0ms !important;
    }
}
</style>
