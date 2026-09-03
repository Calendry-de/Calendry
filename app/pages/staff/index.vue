<template>
    <StaffShell
        :active="activeTab"
        :tabs="tabs"
    >
        <template #actions>
            <CommonButton
                type="secondary"
                :disabled="loggingOut"
                @click="logout"
            >{{ loggingOut ? t('staff.tenants.signOutBusy') : t('staff.tenants.signOut') }}</CommonButton>
        </template>

        <template v-if="activeTab === 'tenants'">
            <StaffTenantsPanel
                :federations="federations"
                :list-error="listError"
                :tenants="tenants"
                @refresh="refreshAll"
            />
            <StaffCreateTenantPanel @created="refreshAll"/>
        </template>

        <StaffFederationsPanel
            v-else-if="activeTab === 'federations'"
            :federations="federations"
            :list-error="federationsListError"
            @refresh="refreshAll"
        />

        <StaffAuditLog
            v-else
            :tenants="tenants"
        />
    </StaffShell>
</template>

<script setup lang="ts">
import CommonButton from '~/components/common/CommonButton.vue';
import StaffAuditLog from '~/components/staff/StaffAuditLog.vue';
import StaffCreateTenantPanel from '~/components/staff/StaffCreateTenantPanel.vue';
import StaffFederationsPanel from '~/components/staff/StaffFederationsPanel.vue';
import StaffShell from '~/components/staff/StaffShell.vue';
import type { StaffTab } from '~/components/staff/StaffShell.vue';
import StaffTenantsPanel from '~/components/staff/StaffTenantsPanel.vue';
import { STAFF_LOGIN_ROUTE } from '~/utils/routes';
import type { StaffFederation, StaffTenant } from '~/utils/staff';
import { useT } from '~/composables/i18n';

/**
 * The staff plane: tenants and their creation (issue #76), federations
 * (issue #64), and, since the audit log became readable, the cross-tenant
 * audit log (issue #78). Three tabs in a shell of its own, deliberately NOT
 * `CommonAppShell`: that shell's rail is the TENANT-scoped nav, and a staff
 * session has no tenant to render it around.
 *
 * THIS PAGE OWNS THE DATA the tenant and federation tabs share. A tenant's
 * federation change alters that federation's member list, and a created
 * tenant may join one, so both lists are fetched here once and refreshed
 * together after any write; the panels only ask.
 *
 * Every request goes through `/api/staff/*`, gated by `requireStaffIdentity`:
 * a tenant Account session cannot reach these routes at all, so there is
 * nothing to gate client-side beyond "do we have a staff session".
 * `auth.global.ts` deliberately does not check that (see `STAFF_ROUTE` in
 * `ANONYMOUS_ROUTES`), so this page checks it itself by trying the fetch and
 * redirecting to `/staff/login` on 401/403.
 */
definePageMeta({ layout: 'empty' });

const { t } = useT();
const route = useRoute();
const request = useRequestFetch();

// A getter, so the tab title follows a language change instead of freezing at
// whatever was active when this page first mounted.
useHead(() => ({ title: t('staff.tenants.pageTitle') }));

const TABS = ['tenants', 'federations', 'audit'] as const;
type TabId = (typeof TABS)[number];

/** The URL is the tab; an unknown or absent value is the first tab. */
const activeTab = computed<TabId>(() => {
    const raw = route.query.tab;

    return typeof raw === 'string' && (TABS as readonly string[]).includes(raw) ? raw as TabId : 'tenants';
});

const { data, error, refresh } = await useAsyncData(
    'staff-tenants',
    () => request<{ rows: StaffTenant[] }>('/api/staff/tenants'),
);

// No staff session (or one that expired/was revoked): bounce to the staff
// login page rather than rendering an empty, indistinguishable-from-"no
// tenants yet" table, the exact "no data vs. fetch failed" trap CLAUDE.md
// names.
if (error.value) {
    await navigateTo({ path: STAFF_LOGIN_ROUTE, query: { redirect: route.fullPath } });
}

const tenants = computed(() => data.value?.rows ?? []);
const listError = computed(() => (error.value ? t('staff.tenants.loadError') : ''));

/**
 * A SEPARATE `useAsyncData` rather than folded into the tenants response: the
 * two are independent resources (a Federation without a Tenant yet is a
 * normal, freshly-created state), and the tenants fetch above already owns
 * the "no session, bounce to login" redirect, so a failure here renders its
 * own error note instead.
 */
const federationsData = await useAsyncData(
    'staff-federations',
    () => request<{ rows: StaffFederation[] }>('/api/staff/federations'),
);

const federations = computed(() => federationsData.data.value?.rows ?? []);
const federationsListError = computed(() => (
    federationsData.error.value ? t('staff.federations.loadError') : ''
));

async function refreshAll() {
    await refresh();
    await federationsData.refresh();
}

const tabs = computed<StaffTab[]>(() => [
    { id: 'tenants', label: t('staff.shell.tab.tenants'), icon: 'material-symbols:domain', count: tenants.value.length },
    { id: 'federations', label: t('staff.shell.tab.federations'), icon: 'material-symbols:hub-outline', count: federations.value.length },
    { id: 'audit', label: t('staff.shell.tab.audit'), icon: 'material-symbols:history' },
]);

const loggingOut = ref(false);

async function logout() {
    if (loggingOut.value) {
        return;
    }

    loggingOut.value = true;

    try {
        await $fetch('/api/staff-auth/logout', { method: 'POST' }).catch(() => undefined);
        await navigateTo(STAFF_LOGIN_ROUTE);
    } finally {
        loggingOut.value = false;
    }
}
</script>
