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

        <Transition name="landing-error">
            <p
                v-if="actionError"
                class="landing_error"
                role="alert"
            >{{ actionError }}</p>
        </Transition>

        <div
            v-if="sections.length"
            class="landing_cards"
        >
            <NuxtLink
                v-for="(section, index) in sections"
                :key="section.id"
                class="landing_cards-card"
                :to="section.to!"
                :style="{ '--stagger-index': index }"
            >
                <Icon
                    class="landing_cards-icon"
                    :name="section.icon"
                    aria-hidden="true"
                />
                <span class="landing_cards-label">{{ section.label }}</span>
                <span class="landing_cards-hint">{{ section.description }}</span>
            </NuxtLink>
        </div>

        <!--
            Reachable state, not a dead end: a person with a session but no
            management read permission lands here, and is told which fact is
            true rather than shown an empty grid that could equally mean the
            page failed to load. Scoped to just this grid — the sidebar may
            still offer Schedule/My settings links even when nobody has
            granted this person a management permission.
        -->
        <p
            v-else
            class="landing_empty"
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
import DashboardPermissionSummary from '~/components/dashboard/PermissionSummary.vue';
import { logout, useSession } from '~/composables/session';
import { useManageSections } from '~/composables/navigation';

useHead({ title: 'Home' });

const session = useSession();

// The manage-entities overview — what `/manage/index.vue` used to render on
// its own separate hub page. Schedule and My settings are one click away in
// CommonAppShell's sidebar already, so this grid is deliberately scoped to
// just the entities, the one group numerous and varied enough to earn an
// icon+description card instead of a plain link.
const sections = useManageSections();

const greeting = computed(() => {
    const person = session.value?.activePerson;

    return person ? `Signed in as ${ person.givenName } ${ person.familyName }` : undefined;
});

// Shared between the two actions below: only one of them is ever reachable at
// a time (the buttons this guards render side by side), and both leave the
// page — there is nothing to distinguish per-button.
const busy = ref(false);
const actionError = ref('');

/**
 * Switching goes back through the login page's selection step rather than
 * duplicating that UI here — the server treats a switch as a session mutation,
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
 * `logout()` hits the network before it clears local state — same guard shape
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
        actionError.value = 'Could not sign out — check your connection and try again.';
    } finally {
        busy.value = false;
    }
}
</script>

<style scoped lang="scss">
.landing {
    &_cards {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
        gap: var(--space-5);

        /*
         * The one authored moment this page earns: these cards are the
         * actual reason to land here, so they arrive as a LIST rather than
         * snapping in with the rest of the chrome. Staggered by the index
         * each card already carries; capped at the 7th so a tenant with many
         * entities still settles inside a quarter second, not a scripted
         * queue.
         */
        &-card {
            display: flex;
            flex-direction: column;
            gap: var(--space-2);

            padding: var(--space-6);
            border: 1px solid transparent;
            border-radius: var(--radius-xl);

            text-decoration: none;

            background: $surface1;

            transition: 0.15s;
            animation: landing-reveal 320ms cubic-bezier(0.16, 1, 0.3, 1) both;
            animation-delay: calc(var(--stagger-index, 0) * 40ms);

            @include hover() {
                &:hover {
                    border-color: $primary400;
                    background: $surface2;
                }
            }
        }

        &-card:nth-child(n+7) {
            animation-delay: 240ms;
        }

        &-icon {
            width: 22px;
            height: 22px;
            margin-bottom: var(--space-3);
            color: $primary600;
        }

        &-label {
            font-size: var(--font-size-md);
            font-weight: 680;
            color: $content1;
        }

        &-hint {
            font-size: var(--font-size-sm);
            line-height: 1.45;
            color: $content7;
        }
    }

    &_empty {
        max-width: 52ch;
        margin: 0;
        padding: var(--space-8) var(--space-7);
        border-radius: var(--radius-xl);

        font-size: var(--font-size-md);
        line-height: 1.55;
        color: $content7;

        background: $surface1;
    }

    &_error {
        margin: 0;
        font-size: var(--font-size-md);
        color: $error600;
    }
}

@keyframes landing-reveal {
    from {
        opacity: 0;
        transform: translateY(6px);
    }

    to {
        opacity: 1;
        transform: translateY(0);
    }
}

// A network failure telling you nothing happened, or the user retrying,
// deserves an arrival of its own rather than a jump-cut in the layout.
.landing-error-enter-active {
    transition: opacity 200ms cubic-bezier(0.16, 1, 0.3, 1), transform 200ms cubic-bezier(0.16, 1, 0.3, 1);
}

.landing-error-leave-active {
    transition: opacity 120ms ease-in, transform 120ms ease-in;
}

.landing-error-enter-from,
.landing-error-leave-to {
    opacity: 0;
    transform: translateY(-4px);
}

/*
 * The site-wide rule in layout.scss zeroes every transition/animation
 * DURATION under reduced motion, but not `animation-delay` — left alone, a
 * reduced-motion visitor would still wait up to 240ms staring at invisible
 * cards before they snapped into view. Zeroing the delay here is what makes
 * that wait disappear along with the motion.
 */
@media (prefers-reduced-motion: reduce) {
    .landing_cards-card {
        animation-delay: 0ms !important;
    }
}
</style>
