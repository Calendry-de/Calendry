<template>
    <CommonAppShell
        :title="session?.activeTenant?.name ?? t('dashboard.page.fallbackTitle')"
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
        <!--
            THE CALENDAR THE NUMBERS BELOW ARE ABOUT. Every count on this page
            is implicitly scoped to a term and the page named none of them, so
            "12 offerings" could equally describe a term halfway through or one
            that starts in five months. Four states, kept apart on purpose (see
            `~/utils/currentTerm`): no line at all when the caller has no
            `term.read`, the term and week when there is one, a plain statement
            when the tenant has authored no Term yet, and a DIFFERENT one when
            the request failed.
        -->
        <template #meta>
            <!--
                The `v-if` is on the paragraph rather than on the `<template>`:
                the shell renders `<slot name="meta"/>` bare, with no wrapper to
                leave behind, so an empty slot costs nothing and this avoids
                making slot PRESENCE conditional.
            -->
            <p
                v-if="term"
                class="dash_term"
                :class="{ 'dash_term--unavailable': term.kind === 'unavailable' }"
            >{{ termLine }}</p>
        </template>

        <!--
            QUIET, both of them. Sign out was `secondary-black`, a filled grey
            block and the single loudest element on the home page, for an
            action the header's account control already offers on every page.
            The hairline ghost (`dash_action`) matches the schedule toolbar's
            control shape: present, findable, not the headline.
        -->
        <template #actions>
            <CommonButton
                v-if="(session?.availableTenants.length ?? 0) > 1"
                class="dash_action"
                type="secondary"
                :disabled="busy"
                @click="switchTenant"
            >{{ t('dashboard.action.switchInstitution') }}</CommonButton>

            <CommonButton
                class="dash_action"
                type="secondary"
                :disabled="busy"
                @click="signOut"
            >{{ busy ? t('dashboard.action.signOutBusy') : t('dashboard.action.signOut') }}</CommonButton>
        </template>

        <Transition name="dash-error">
            <p
                v-if="actionError"
                class="dash_error"
                role="alert"
            >{{ actionError }}</p>
        </Transition>

        <!--
            ABOVE the shape strip, deliberately. Both are counts, but only one
            of them is a request: "4 proposals waiting" is the answer to "what
            should I do now", and the institution's shape is ambient. A reader
            who holds none of the review permissions sees nothing here and
            the page opens on the shape strip exactly as it did before.
        -->
        <!--
            ONE RECESSED BAND FOR BOTH FACTS ROWS. They were two strips of
            tiles (three 24px numerals, then six 17px ones) stacked over ~190px;
            as two text lines sharing a heading column they read as a small
            table, and `$surface0` recesses them the way the grid's empty
            cells recess: ambient ground, not raised chrome.
        -->
        <div
            v-if="queuesStatus === 'pending' || countsStatus === 'pending' || queues?.length || counts?.length"
            class="dash_facts"
        >
            <DashboardReviewQueues
                :queues="queues ?? []"
                :pending="queuesStatus === 'pending'"
            />

            <DashboardInstitutionCounts
                :counts="counts ?? []"
                :pending="countsStatus === 'pending'"
            />
        </div>

        <!--
            GROUPED BY `groupNavEntries`, the same helper the sidebar reads.
            This was one flat `auto-fill` grid of 24 undifferentiated cards:
            every destination the same size, the same weight and in no order a
            reader could name, sitting beside a sidebar that grouped the very
            same routes under headings. The taxonomy already existed; the more
            prominent surface was the one throwing it away.

            GROUPS AS COLUMNS, LINKS AS ONE LINE EACH. The next iteration kept
            a two-line blurb under every destination, three per row: 24 × 60px
            of prose repeating what the sidebar beside it already lists, which
            is what made the home page long. A group is now a column of plain
            links, five columns across at desktop, and the blurb survives as
            the link's `title`, where a reader who wants it hovers for it.

            No card containers, still: proximity and the label register do the
            grouping, as they do in the sidebar.
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
                :key="group.id"
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
                            :title="entry.description"
                        >
                            <Icon
                                class="dash_link-icon"
                                :name="entry.icon"
                                aria-hidden="true"
                            />
                            <span class="dash_link-label">{{ entry.label }}</span>
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
            {{ t('dashboard.empty.noManageAccess') }}
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
import DashboardReviewQueues from '~/components/dashboard/ReviewQueues.vue';
import DashboardPermissionSummary from '~/components/dashboard/PermissionSummary.vue';
import { logout, useSession } from '~/composables/session';
import { useManageSections } from '~/composables/navigation';
import { groupNavEntries } from '~/utils/navGroups';
import { useInstitutionCounts, useReviewQueueCounts } from '~/composables/dashboardCounts';
import { useCurrentTerm } from '~/composables/currentTerm';
import { termContextKey } from '~/utils/currentTerm';
import { useT } from '~/composables/i18n';

const session = useSession();
const { t } = useT();

// A getter, not a plain string: `useHead` re-evaluates it, so the tab title
// follows a language change instead of freezing at whatever was active when
// this page first mounted.
useHead(() => ({ title: t('dashboard.page.title') }));

// The manage-entities overview: what `/manage/index.vue` used to render on
// its own separate hub page. Schedule and My settings are one click away in
// CommonAppShell's sidebar already, so this list is deliberately scoped to
// just the entities, the one group numerous and varied enough to earn a
// described destination rather than a bare link.
const sections = useManageSections();

// The one taxonomy, not a second one authored here: `groupNavEntries` is what
// the sidebar groups by too, so the headings a visitor reads in the nav and
// the headings they read here are the same list in the same order.
const groups = computed(() => groupNavEntries(sections.value, t));

/*
 * THREE HANDLES, ALL CALLED BEFORE ANY AWAIT, then awaited in turn.
 *
 * SEPARATE because they answer three different questions from three different
 * routes with three different gates: what the institution looks like, what is
 * waiting for a decision, and which term and week it is. One `useAsyncData`
 * key over three unrelated failure surfaces would let a slow term lookup hold
 * the room count's first render, and give one skeleton to things that are not
 * the same thing.
 *
 * CALLED FIRST, AWAITED SECOND, and the order matters twice over. `useAsyncData`
 * starts its fetch when it is CALLED, so calling all three up front makes them
 * one parallel wave; awaiting each in sequence at the point of call, as this
 * page used to, serialised three round-trips into every server render for no
 * reason. It also keeps all three composables on the synchronous side of the
 * first `await`, where the Nuxt instance is unambiguously theirs, rather than
 * relying on it surviving an await to reach the second and third.
 *
 * THE TOP-LEVEL AWAIT LIVES HERE, not in the composables: each one stays
 * synchronous so it keeps that instance (CLAUDE.md), and this page is what
 * waits for the first render's data. Awaiting also means SSR ships real numbers
 * rather than a skeleton the client has to replace.
 */
const countsHandle = useInstitutionCounts();
const queuesHandle = useReviewQueueCounts();
const termHandle = useCurrentTerm();

const { data: counts, status: countsStatus } = await countsHandle;
const { data: queues, status: queuesStatus } = await queuesHandle;
const { data: term } = await termHandle;

/**
 * The header's calendar line.
 *
 * The phase→key mapping is `termContextKey()`'s, not written here, so the four
 * states have one definition a test can read. Only the interpolation is this
 * page's, and it is passed unconditionally: a message that ignores `week` and
 * `total` (the "no term configured" one) simply does not use them, which is
 * cheaper than branching the call.
 */
const termLine = computed(() => {
    const context = term.value;

    if (!context) {
        return '';
    }

    return t(termContextKey(context), context.kind === 'term'
        ? { name: context.name, week: context.week, total: context.totalWeeks }
        : {});
});

const greeting = computed(() => {
    const person = session.value?.activePerson;

    return person
        ? t('dashboard.greeting.signedInAs', { givenName: person.givenName, familyName: person.familyName })
        : undefined;
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
        actionError.value = t('dashboard.error.signOut');
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
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
        gap: var(--space-7) var(--space-6);
        align-items: start;
    }

    /*
     * THE FACTS BAND. Two rows, one hairline between them, recessed on
     * `$surface0`. Padding inset by the rows' own negative item margins so
     * the numerals sit on the band's text edge.
     */
    &_facts {
        display: flex;
        flex-direction: column;
        gap: var(--space-4);

        padding: var(--space-5) var(--space-6);
        border-radius: var(--radius-lg);

        background: $surface0;

        > * + * {
            padding-top: var(--space-4);
            border-top: 1px solid $surface3;
        }
    }

    /* The bar's control shape (see `ScheduleToolbar`), on the header's two
       account actions. `.button` in the selector outranks `CommonButton`'s own
       variant rules without touching them. */
    &_action.button {
        gap: var(--space-3);

        min-height: 36px;
        padding: var(--space-3) var(--space-5);
        border: 1px solid $surface5;
        border-radius: var(--radius-md);

        font-size: var(--font-size-sm);
        color: $content5;

        background: $surface0;

        @include hover() {
            &:hover {
                border-color: $surface6;
                color: $content2;
                background: $surface0;
            }
        }

        &:active,
        &:focus {
            background: $surface2;
        }
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
            display: flex;
            flex-direction: column;
            gap: 1px; // Rows touch; the hover fill is what separates them.

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
        display: flex;
        gap: var(--space-4);
        align-items: center;

        min-width: 0;
        padding: var(--space-3) var(--space-5);
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
         * Signal Rule broken at scale. The nav's icons are this value.
         */
        &-icon {
            flex: none;
            width: 17px;
            height: 17px;
            color: $surface7;
        }

        /* `sm`, so "Lehrveranstaltungsvorlagen" fits a 200px column; a label
           that still must wrap may, and the icon stays on its first line. */
        &-label {
            min-width: 0;

            font-size: var(--font-size-sm);
            font-weight: 600;
            color: $content5;

            transition: 0.15s;
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

    /*
     * The 11px uppercase register the two strips' headings and the sidebar's
     * group headings use, so the page's calendar scope reads as a LABEL on the
     * heading block rather than as a third line of prose under the greeting.
     * `tabular-nums` because the week number changes in place every Monday.
     */
    &_term {
        margin: 0;

        font-size: var(--font-size-xs);
        font-weight: 650;
        font-variant-numeric: tabular-nums;
        color: $content7;
        text-transform: uppercase;
        letter-spacing: 0.05em;

        /*
         * A FAILED READ IS NOT A CALENDAR FACT, so it does not get the label
         * register: sentence case at the body size, in `$warning800` (the ramp's
         * own text step, DESIGN.md's Measured-Contrast Rule: `warning700` fails
         * AA at 3.73:1). Not `$error600`, which this page spends on an action
         * that failed in front of the reader; a header line that could not be
         * read is a degraded page, not a rejected click.
         */
        &--unavailable {
            font-size: var(--font-size-sm);
            font-weight: 400;
            color: $warning800;
            text-transform: none;
            letter-spacing: normal;
        }
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
