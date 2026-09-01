<template>
    <div class="staff_page">
        <header class="staff_header">
            <h1>Calendry staff</h1>
            <CommonButton
                type="secondary"
                :disabled="loggingOut"
                @click="logout"
            >{{ loggingOut ? 'Signing out…' : 'Sign out' }}</CommonButton>
        </header>

        <section class="staff_section">
            <h2>Tenants</h2>

            <p
                v-if="listError"
                class="staff_note staff_note--error"
                role="alert"
            >{{ listError }}</p>

            <table
                v-else
                class="staff_table"
            >
                <thead>
                    <tr>
                        <th>Slug</th>
                        <th>Name</th>
                        <th>Timezone</th>
                        <th>Federation</th>
                        <th>Created</th>
                    </tr>
                </thead>
                <tbody>
                    <tr
                        v-for="tenant in tenants"
                        :key="tenant.id"
                    >
                        <td>{{ tenant.slug }}</td>
                        <td>{{ tenant.name }}</td>
                        <td>{{ tenant.timezone }}</td>
                        <td>
                            <select
                                :disabled="assigningTenantId === tenant.id"
                                :value="tenant.federation?.id ?? ''"
                                @change="setTenantFederation(tenant, ($event.target as HTMLSelectElement).value || null)"
                            >
                                <option
                                    :selected="!tenant.federation"
                                    value=""
                                >— none —</option>
                                <option
                                    v-for="federation in federations"
                                    :key="federation.id"
                                    :selected="federation.id === tenant.federation?.id"
                                    :value="federation.id"
                                >{{ federation.name }}</option>
                            </select>
                        </td>
                        <td>{{ new Date(tenant.createdAt).toLocaleDateString() }}</td>
                    </tr>
                    <tr v-if="tenants.length === 0">
                        <td colspan="5">No tenants yet.</td>
                    </tr>
                </tbody>
            </table>

            <p
                v-if="federationAssignError"
                class="staff_note staff_note--error"
                role="alert"
            >{{ federationAssignError }}</p>
        </section>

        <section class="staff_section">
            <h2>Federations</h2>

            <p class="staff_note">
                Same effect as the <code>provision:federation</code> CLI.
                Attach or detach a Tenant from the Federation column above.
            </p>

            <p
                v-if="federationsListError"
                class="staff_note staff_note--error"
                role="alert"
            >{{ federationsListError }}</p>

            <table
                v-else
                class="staff_table"
            >
                <thead>
                    <tr>
                        <th>Slug</th>
                        <th>Name</th>
                        <th>Member tenants</th>
                        <th>Created</th>
                    </tr>
                </thead>
                <tbody>
                    <tr
                        v-for="federation in federations"
                        :key="federation.id"
                    >
                        <td>{{ federation.slug }}</td>
                        <td>{{ federation.name }}</td>
                        <td>{{ federation.tenants.map((t) => t.slug).join(', ') || '—' }}</td>
                        <td>{{ new Date(federation.createdAt).toLocaleDateString() }}</td>
                    </tr>
                    <tr v-if="federations.length === 0">
                        <td colspan="4">No federations yet.</td>
                    </tr>
                </tbody>
            </table>

            <form
                class="staff_form"
                @submit.prevent="createFederation"
            >
                <CommonInputText
                    v-model="federationForm.slug"
                    placeholder="Slug"
                    :disabled="creatingFederation"
                    :input-attrs="{ required: true, autocomplete: 'off' }"
                >Slug</CommonInputText>

                <CommonInputText
                    v-model="federationForm.name"
                    placeholder="Federation name"
                    :disabled="creatingFederation"
                    :input-attrs="{ required: true }"
                >Name</CommonInputText>

                <p
                    v-if="createFederationError"
                    class="staff_note staff_note--error"
                    role="alert"
                >{{ createFederationError }}</p>

                <p
                    v-if="createFederationInfo"
                    class="staff_note staff_note--success"
                    role="status"
                >{{ createFederationInfo }}</p>

                <CommonButton
                    native-type="submit"
                    type="primary"
                    :disabled="creatingFederation"
                >{{ creatingFederation ? 'Creating…' : 'Create federation' }}</CommonButton>
            </form>
        </section>

        <section class="staff_section">
            <h2>Create a tenant</h2>

            <p class="staff_note">
                Same effect as the <code>provision:tenant</code> CLI.
            </p>

            <form
                class="staff_form"
                @submit.prevent="createTenant"
            >
                <CommonInputText
                    v-model="form.slug"
                    placeholder="Slug"
                    :disabled="creating"
                    :input-attrs="{ required: true, autocomplete: 'off' }"
                >Slug</CommonInputText>

                <CommonInputText
                    v-model="form.name"
                    placeholder="Institution name"
                    :disabled="creating"
                    :input-attrs="{ required: true }"
                >Name</CommonInputText>

                <CommonInputText
                    v-model="form.adminEmail"
                    placeholder="Admin email"
                    input-type="email"
                    :disabled="creating"
                    :input-attrs="{ required: true }"
                >Admin email</CommonInputText>

                <CommonInputText
                    v-model="form.adminName"
                    placeholder="Admin name"
                    :disabled="creating"
                    :input-attrs="{ required: true }"
                >Admin name</CommonInputText>

                <CommonInputText
                    v-model="form.federationSlug"
                    placeholder="(optional)"
                    :disabled="creating"
                >Federation slug</CommonInputText>

                <CommonInputText
                    v-model="form.timezone"
                    placeholder="UTC"
                    :disabled="creating"
                >Timezone</CommonInputText>

                <p
                    v-if="createError"
                    class="staff_note staff_note--error"
                    role="alert"
                >{{ createError }}</p>

                <p
                    v-if="createdInfo"
                    class="staff_note staff_note--success"
                    role="status"
                >{{ createdInfo }}</p>

                <CommonButton
                    native-type="submit"
                    type="primary"
                    :disabled="creating"
                >{{ creating ? 'Creating…' : 'Create tenant' }}</CommonButton>
            </form>
        </section>
    </div>
</template>

<script setup lang="ts">
import CommonButton from '~/components/common/CommonButton.vue';
import CommonInputText from '~/components/common/CommonInputText.vue';
import { STAFF_LOGIN_ROUTE } from '~/utils/routes';

/**
 * Staff tenant list + creation (issue #76), plus Federation list, creation
 * and Tenant attach/detach (issue #64's UI half). Deliberately NOT wrapped in
 * `CommonAppShell`/`useNavRegistry`: those back the TENANT-scoped nav, and a
 * staff session has no tenant context to render that shell around (an
 * internal tool, not a polished tenant-facing surface).
 *
 * Every request here goes through `POST/GET /api/staff/*`, gated by
 * `requireStaffIdentity` — a tenant Account session cannot reach these
 * routes at all, so there is nothing to gate client-side beyond "do we have
 * a staff session"; `auth.global.ts` deliberately does not check that (see
 * `STAFF_ROUTE` in `ANONYMOUS_ROUTES`), so this page checks it itself by
 * simply trying the fetch and redirecting to `/staff/login` on 401/403.
 */
definePageMeta({ layout: 'empty' });
useHead({ title: 'Staff — tenants' });

interface StaffTenant {
    id: string;
    slug: string;
    name: string;
    timezone: string;
    createdAt: string;
    federation: { id: string; slug: string; name: string } | null;
}

interface StaffFederation {
    id: string;
    slug: string;
    name: string;
    createdAt: string;
    tenants: { id: string; slug: string; name: string }[];
}

const route = useRoute();
const request = useRequestFetch();

const { data, error, refresh } = await useAsyncData(
    'staff-tenants',
    () => request<{ rows: StaffTenant[] }>('/api/staff/tenants'),
);

// No staff session (or one that expired/was revoked): bounce to the staff
// login page rather than rendering an empty, indistinguishable-from-"no
// tenants yet" table — the exact "no data vs. fetch failed" trap CLAUDE.md
// names.
if (error.value) {
    await navigateTo({ path: STAFF_LOGIN_ROUTE, query: { redirect: route.fullPath } });
}

const tenants = computed(() => data.value?.rows ?? []);
const listError = computed(() => (error.value ? 'Could not load tenants.' : ''));

/**
 * Federation list — issue #64's UI half. A SEPARATE `useAsyncData` rather
 * than folded into the tenants response: the two are independent resources
 * (a Federation without a Tenant yet is a normal, freshly-created state),
 * and the tenants fetch above already owns the "no session, bounce to
 * login" redirect for this page — a second identical redirect here would be
 * redundant, so a failure here just renders its own error note instead.
 */
const federationsData = await useAsyncData(
    'staff-federations',
    () => request<{ rows: StaffFederation[] }>('/api/staff/federations'),
);

const federations = computed(() => federationsData.data.value?.rows ?? []);
const federationsListError = computed(() => (federationsData.error.value ? 'Could not load federations.' : ''));

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

const form = reactive({
    slug: '',
    name: '',
    adminEmail: '',
    adminName: '',
    federationSlug: '',
    timezone: '',
});

const creating = ref(false);
const createError = ref('');
const createdInfo = ref('');

interface CreateTenantResult {
    tenant: { id: string; slug: string; name: string };
    person: { id: string; email: string };
    account: { id: string; reusedAccount: boolean };
    initialPassword: string | null;
}

async function createTenant() {
    if (creating.value) {
        return;
    }

    createError.value = '';
    createdInfo.value = '';
    creating.value = true;

    try {
        const result = await $fetch<CreateTenantResult>('/api/staff/tenants', {
            method: 'POST',
            body: {
                slug: form.slug,
                name: form.name,
                adminEmail: form.adminEmail,
                adminName: form.adminName,
                federationSlug: form.federationSlug || undefined,
                timezone: form.timezone || undefined,
            },
        });

        createdInfo.value = result.initialPassword
            ? `Created '${result.tenant.slug}'. Initial admin password (shown once): ${result.initialPassword}`
            : `Created '${result.tenant.slug}'. Reused the existing account for ${result.person.email} — its password is unchanged.`;

        form.slug = '';
        form.name = '';
        form.adminEmail = '';
        form.adminName = '';
        form.federationSlug = '';
        form.timezone = '';

        await refresh();
        // A new tenant may have named an existing federationSlug — that
        // federation's member list just changed too.
        await federationsData.refresh();
    } catch (caught) {
        const statusCode = (caught as { statusCode?: number; data?: { statusMessage?: string } })?.statusCode;
        const statusMessage = (caught as { data?: { statusMessage?: string } })?.data?.statusMessage;

        createError.value = statusCode === 409
            ? (statusMessage ?? `A tenant with slug '${form.slug}' already exists.`)
            : (statusMessage ?? 'Could not create the tenant.');
    } finally {
        creating.value = false;
    }
}

const federationForm = reactive({ slug: '', name: '' });
const creatingFederation = ref(false);
const createFederationError = ref('');
const createFederationInfo = ref('');

interface CreateFederationResult {
    federation: { id: string; slug: string; name: string };
    alreadyExisted: boolean;
}

async function createFederation() {
    if (creatingFederation.value) {
        return;
    }

    createFederationError.value = '';
    createFederationInfo.value = '';
    creatingFederation.value = true;

    try {
        const result = await $fetch<CreateFederationResult>('/api/staff/federations', {
            method: 'POST',
            body: { slug: federationForm.slug, name: federationForm.name },
        });

        createFederationInfo.value = result.alreadyExisted
            ? `Federation '${result.federation.slug}' already existed — nothing created.`
            : `Created federation '${result.federation.slug}'.`;

        federationForm.slug = '';
        federationForm.name = '';

        await federationsData.refresh();
    } catch (caught) {
        const statusMessage = (caught as { data?: { statusMessage?: string } })?.data?.statusMessage;

        createFederationError.value = statusMessage ?? 'Could not create the federation.';
    } finally {
        creatingFederation.value = false;
    }
}

const assigningTenantId = ref('');
const federationAssignError = ref('');

/** Attach (`federationId` set) or detach (`null`) one Tenant's Federation, from the select in the Tenants table. */
async function setTenantFederation(tenant: StaffTenant, federationId: string | null) {
    assigningTenantId.value = tenant.id;
    federationAssignError.value = '';

    try {
        await $fetch(`/api/staff/tenants/${tenant.id}`, {
            method: 'PATCH',
            body: { federationId },
        });

        await refresh();
        await federationsData.refresh();
    } catch (caught) {
        const statusMessage = (caught as { data?: { statusMessage?: string } })?.data?.statusMessage;

        federationAssignError.value = statusMessage ?? `Could not update '${tenant.slug}''s federation.`;
    } finally {
        assigningTenantId.value = '';
    }
}
</script>

<style scoped lang="scss">
.staff {
    &_page {
        display: flex;
        flex-direction: column;
        gap: 24px;
        max-width: 720px;
        margin: 0 auto;
        padding: 32px 16px;
    }

    &_header {
        display: flex;
        align-items: center;
        justify-content: space-between;
    }

    &_section {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    &_table {
        width: 100%;
        border-collapse: collapse;

        th, td {
            text-align: left;
            padding: 8px;
            border-bottom: 1px solid $content2;
        }
    }

    &_form {
        display: flex;
        flex-direction: column;
        gap: 12px;
        max-width: 360px;
    }

    &_note {
        margin: 0;
        font-size: var(--font-size-sm);
        color: $content6;

        &--error {
            color: $error400;
        }

        &--success {
            color: $success300;
        }
    }
}
</style>
