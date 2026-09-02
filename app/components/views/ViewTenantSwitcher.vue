<template>
    <div
        v-if="activeTenant"
        class="tswitch"
    >
        <select
            v-if="activeTenants.length > 1"
            class="tswitch_select"
            :value="activeTenant.id"
            :disabled="switching"
            :title="activeTenant.name"
            aria-label="Switch institution"
            @change="onSelect(($event.target as HTMLSelectElement).value)"
        >
            <option
                v-for="t in activeTenants"
                :key="t.tenantId"
                :value="t.tenantId"
                :selected="t.tenantId === activeTenant.id"
            >{{ t.name }}</option>
        </select>

        <span
            v-else
            class="tswitch_name"
        >{{ activeTenant.name }}</span>

        <p
            v-if="switchError"
            class="tswitch_error"
            role="alert"
        >{{ switchError }}</p>
    </div>
</template>

<script setup lang="ts">
import { fetchSession, useSession } from '~/composables/session';
import { resolveHomeRoute } from '~/utils/routes';

/**
 * Which institution the signed-in Account is currently acting in, and (only
 * when the Account has more than one) a way to switch without signing out
 * (issue #67's "indication of scope" half; the tenant-selector-at-login half
 * already exists in `login.vue`).
 *
 * PLAIN TEXT, NOT A SELECT, for a single-tenant Account: rendering a
 * one-option dropdown would invite clicking it for nothing, and "is this a
 * control or a label" is exactly the ambiguity a disabled-looking select
 * creates. `activeTenants` filters `isActive` itself: `GET /api/auth/session`
 * returns every identity including a deactivated Person, same shape
 * `login.post.ts` already filters before building ITS picker.
 */
const session = useSession();

const activeTenant = computed(() => session.value?.activeTenant ?? null);
const activeTenants = computed(() => session.value?.availableTenants.filter((t) => t.isActive) ?? []);

const switching = ref(false);
const switchError = ref('');

/**
 * `POST /api/auth/select-tenant` mutates the session in place, no
 * re-authentication, but everything already rendered (nav, cached fetches)
 * was drawn for the OLD tenant. A full reload, not `navigateTo()`, is
 * deliberate: it is the only way to guarantee nothing tenant-scoped survives
 * from before the switch, the same reasoning `logout()` sending the browser to
 * `/login` relies on implicitly by leaving the whole app tree behind.
 */
async function onSelect(tenantId: string) {
    if (switching.value || tenantId === activeTenant.value?.id) {
        return;
    }

    switching.value = true;
    switchError.value = '';

    try {
        await $fetch('/api/auth/select-tenant', { method: 'POST', body: { tenantId } });

        const fresh = await fetchSession(true);

        window.location.href = resolveHomeRoute(fresh?.permissions ?? []);
    } catch {
        switchError.value = 'Could not switch institution.';
        switching.value = false;
    }
}
</script>

<style scoped lang="scss">
.tswitch {
    display: flex;
    flex-direction: column;
    align-items: flex-end;

    &_name {
        overflow: hidden;

        max-width: 160px;

        font-size: var(--font-size-sm);
        color: $content7;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    &_select {
        cursor: pointer;

        max-width: 160px;
        padding: var(--space-2) var(--space-3);
        border: 1px solid $surface5;
        border-radius: var(--radius-md);

        font-family: inherit;
        font-size: var(--font-size-sm);
        color: $content5;
        text-overflow: ellipsis;

        background: $surface0;

        &:focus-visible {
            outline: 2px solid $primary600;
            outline-offset: 1px;
        }
    }

    &_error {
        margin: 0;
        font-size: var(--font-size-xs);
        color: $error600;
    }
}
</style>
