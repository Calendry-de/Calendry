<template>
    <div class="staff_page">
        <header class="staff_header">
            <h1>{{ t('staff.brand.heading') }}</h1>
            <CommonButton
                type="secondary"
                :disabled="loggingOut"
                @click="logout"
            >{{ loggingOut ? t('staff.tenants.signOutBusy') : t('staff.tenants.signOut') }}</CommonButton>
        </header>

        <section class="staff_section">
            <h2>{{ t('staff.tenants.heading') }}</h2>

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
                        <th>{{ t('common.field.slug') }}</th>
                        <th>{{ t('common.field.name') }}</th>
                        <th>{{ t('common.field.timezone') }}</th>
                        <th>{{ t('staff.tenants.column.federation') }}</th>
                        <th>{{ t('staff.tenants.column.locale') }}</th>
                        <th>{{ t('common.field.created') }}</th>
                        <th>{{ t('staff.tenants.column.erase') }}</th>
                    </tr>
                </thead>
                <tbody>
                    <template
                        v-for="tenant in tenants"
                        :key="tenant.id"
                    >
                        <tr>
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
                                    >{{ t('staff.tenants.noFederationOption') }}</option>
                                    <option
                                        v-for="federation in federations"
                                        :key="federation.id"
                                        :selected="federation.id === tenant.federation?.id"
                                        :value="federation.id"
                                    >{{ federation.name }}</option>
                                </select>
                            </td>
                            <td>
                                <!--
                                    A free-text BCP-47 tag, not a select: the
                                    column accepts any tag `Intl` recognises
                                    (`fr-FR` and `ja-JP` are storable and
                                    meaningful, see shared/language.ts), so a
                                    two-option dropdown would narrow in the UI
                                    what the schema deliberately does not.
                                    Saved on an explicit button rather than on
                                    change, because a half-typed tag
                                    (`de-`) is refused by the route and would
                                    otherwise error on every keystroke.
                                -->
                                <div class="staff_locale">
                                    <CommonInputText
                                        :disabled="savingLocaleTenantId === tenant.id"
                                        :input-attrs="{ 'aria-label': t('staff.tenants.localeAriaLabel', { slug: tenant.slug }), autocomplete: 'off' }"
                                        :model-value="localeDraft(tenant)"
                                        :placeholder="t('staff.tenants.localePlaceholder')"
                                        @update:model-value="localeDrafts[tenant.id] = $event ?? ''"
                                    />

                                    <CommonButton
                                        size="S"
                                        type="secondary"
                                        :disabled="savingLocaleTenantId === tenant.id || !localeChanged(tenant)"
                                        @click="saveLocale(tenant)"
                                    >{{ savingLocaleTenantId === tenant.id
                                        ? t('common.action.saving')
                                        : t('staff.tenants.localeSave') }}</CommonButton>
                                </div>
                            </td>
                            <td>{{ new Date(tenant.createdAt).toLocaleDateString() }}</td>
                            <td>
                                <CommonButton
                                    v-if="erasingTenantId !== tenant.id"
                                    size="S"
                                    type="destructive"
                                    @click="startErase(tenant.id)"
                                >{{ t('staff.tenants.eraseAction') }}</CommonButton>
                            </td>
                        </tr>

                        <!--
                            Issue #84: GDPR erasure. IMMEDIATE and
                            IRREVERSIBLE, so the confirmation is not a modal
                            that could be dismissed on reflex: the operator
                            must type the tenant's own slug back before the
                            button that actually erases becomes clickable.
                        -->
                        <tr v-if="erasingTenantId === tenant.id">
                            <td
                                class="staff_erase"
                                colspan="7"
                            >
                                <p class="staff_erase_warning" role="alert">
                                    {{ t('staff.tenants.eraseWarning', { slug: tenant.slug }) }}
                                </p>

                                <div class="staff_erase_row">
                                    <CommonInputText
                                        v-model="eraseConfirmInput"
                                        :disabled="erasing"
                                        :placeholder="tenant.slug"
                                    >{{ t('staff.tenants.confirmSlugLabel') }}</CommonInputText>

                                    <CommonButton
                                        :disabled="erasing || eraseConfirmInput !== tenant.slug"
                                        type="destructive"
                                        @click="confirmErase(tenant)"
                                    >{{ erasing
                                        ? t('staff.tenants.erasingBusy')
                                        : t('staff.tenants.erasePermanently', { slug: tenant.slug }) }}</CommonButton>

                                    <CommonButton
                                        :disabled="erasing"
                                        type="secondary"
                                        @click="cancelErase"
                                    >{{ t('common.action.cancel') }}</CommonButton>
                                </div>

                                <p
                                    v-if="eraseError"
                                    class="staff_note staff_note--error"
                                    role="alert"
                                >{{ eraseError }}</p>
                            </td>
                        </tr>
                    </template>
                    <tr v-if="tenants.length === 0">
                        <td colspan="7">{{ t('staff.tenants.empty') }}</td>
                    </tr>
                </tbody>
            </table>

            <!--
                `<i18n-t>` rather than a key either side of each `<code>`: the
                sentence carries two code samples inside its grammar, and
                German reorders clauses. Wording deliberately tracks
                `managePages.display.localeHint` and `my.account.localeHint`,
                the two places that already say what this column does.
            -->
            <i18n-t
                class="staff_note"
                keypath="staff.tenants.localeHint"
                scope="global"
                tag="p"
            >
                <template #germanTag>
                    <code>de-DE</code>
                </template>
                <template #britishTag>
                    <code>en-GB</code>
                </template>
            </i18n-t>

            <p
                v-if="federationAssignError"
                class="staff_note staff_note--error"
                role="alert"
            >{{ federationAssignError }}</p>

            <p
                v-if="localeError"
                class="staff_note staff_note--error"
                role="alert"
            >{{ localeError }}</p>

            <p
                v-if="localeSuccess"
                class="staff_note staff_note--success"
                role="status"
            >{{ localeSuccess }}</p>

            <p
                v-if="eraseSuccess"
                class="staff_note staff_note--success"
                role="status"
            >{{ eraseSuccess }}</p>
        </section>

        <section class="staff_section">
            <h2>{{ t('staff.federations.heading') }}</h2>

            <!--
                `<i18n-t>` rather than a key either side of the `<code>`:
                German reorders clauses, so a sentence split at the CLI name is
                one no translator can fix without editing this template. The
                slot name matches the placeholder.
            -->
            <i18n-t
                class="staff_note"
                keypath="staff.federations.cliNote"
                tag="p"
                scope="global"
            >
                <template #cli>
                    <code>provision:federation</code>
                </template>
            </i18n-t>

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
                        <th>{{ t('common.field.slug') }}</th>
                        <th>{{ t('common.field.name') }}</th>
                        <th>{{ t('staff.federations.column.members') }}</th>
                        <th>{{ t('common.field.created') }}</th>
                    </tr>
                </thead>
                <tbody>
                    <tr
                        v-for="federation in federations"
                        :key="federation.id"
                    >
                        <td>{{ federation.slug }}</td>
                        <td>{{ federation.name }}</td>
                        <td>{{ federation.tenants.map((member) => member.slug).join(', ')
                            || t('staff.federations.noMembers') }}</td>
                        <td>{{ new Date(federation.createdAt).toLocaleDateString() }}</td>
                    </tr>
                    <tr v-if="federations.length === 0">
                        <td colspan="4">{{ t('staff.federations.empty') }}</td>
                    </tr>
                </tbody>
            </table>

            <form
                class="staff_form"
                @submit.prevent="createFederation"
            >
                <CommonInputText
                    v-model="federationForm.slug"
                    :placeholder="t('common.field.slug')"
                    :disabled="creatingFederation"
                    :input-attrs="{ required: true, autocomplete: 'off' }"
                >{{ t('common.field.slug') }}</CommonInputText>

                <CommonInputText
                    v-model="federationForm.name"
                    :placeholder="t('staff.federations.namePlaceholder')"
                    :disabled="creatingFederation"
                    :input-attrs="{ required: true }"
                >{{ t('common.field.name') }}</CommonInputText>

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
                >{{ creatingFederation ? t('common.action.creating') : t('staff.federations.submit') }}</CommonButton>
            </form>
        </section>

        <section class="staff_section">
            <h2>{{ t('staff.createTenant.heading') }}</h2>

            <i18n-t
                class="staff_note"
                keypath="staff.createTenant.cliNote"
                tag="p"
                scope="global"
            >
                <template #cli>
                    <code>provision:tenant</code>
                </template>
            </i18n-t>

            <form
                class="staff_form"
                @submit.prevent="createTenant"
            >
                <CommonInputText
                    v-model="form.slug"
                    :placeholder="t('common.field.slug')"
                    :disabled="creating"
                    :input-attrs="{ required: true, autocomplete: 'off' }"
                >{{ t('common.field.slug') }}</CommonInputText>

                <CommonInputText
                    v-model="form.name"
                    :placeholder="t('staff.createTenant.namePlaceholder')"
                    :disabled="creating"
                    :input-attrs="{ required: true }"
                >{{ t('common.field.name') }}</CommonInputText>

                <CommonInputText
                    v-model="form.adminEmail"
                    :placeholder="t('staff.createTenant.adminEmail')"
                    input-type="email"
                    :disabled="creating"
                    :input-attrs="{ required: true }"
                >{{ t('staff.createTenant.adminEmail') }}</CommonInputText>

                <CommonInputText
                    v-model="form.adminName"
                    :placeholder="t('staff.createTenant.adminName')"
                    :disabled="creating"
                    :input-attrs="{ required: true }"
                >{{ t('staff.createTenant.adminName') }}</CommonInputText>

                <CommonInputText
                    v-model="form.federationSlug"
                    :placeholder="t('staff.createTenant.optionalPlaceholder')"
                    :disabled="creating"
                >{{ t('staff.createTenant.federationSlug') }}</CommonInputText>

                <!--
                    `placeholder="UTC"` stays a literal: it is an IANA zone
                    name, an example of the value this field takes, not copy
                    this repo authored about it.
                -->
                <CommonInputText
                    v-model="form.timezone"
                    placeholder="UTC"
                    :disabled="creating"
                >{{ t('common.field.timezone') }}</CommonInputText>

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
                >{{ creating ? t('common.action.creating') : t('staff.createTenant.submit') }}</CommonButton>
            </form>
        </section>
    </div>
</template>

<script setup lang="ts">
import CommonButton from '~/components/common/CommonButton.vue';
import CommonInputText from '~/components/common/CommonInputText.vue';
import { STAFF_LOGIN_ROUTE } from '~/utils/routes';
import { useT } from '~/composables/i18n';

/**
 * Staff tenant list + creation (issue #76), plus Federation list, creation
 * and Tenant attach/detach (issue #64's UI half). Deliberately NOT wrapped in
 * `CommonAppShell`/`useNavRegistry`: those back the TENANT-scoped nav, and a
 * staff session has no tenant context to render that shell around (an
 * internal tool, not a polished tenant-facing surface).
 *
 * Every request here goes through `POST/GET /api/staff/*`, gated by
 * `requireStaffIdentity`: a tenant Account session cannot reach these
 * routes at all, so there is nothing to gate client-side beyond "do we have
 * a staff session"; `auth.global.ts` deliberately does not check that (see
 * `STAFF_ROUTE` in `ANONYMOUS_ROUTES`), so this page checks it itself by
 * simply trying the fetch and redirecting to `/staff/login` on 401/403.
 */
definePageMeta({ layout: 'empty' });

const { t } = useT();

// A getter, so the tab title follows a language change instead of freezing at
// whatever was active when this page first mounted.
useHead(() => ({ title: t('staff.tenants.pageTitle') }));

interface StaffTenant {
    id: string;
    slug: string;
    name: string;
    timezone: string;
    createdAt: string;
    /** `TenantDisplaySettings.defaultLocale`, flattened by the list route. */
    defaultLocale: string | null;
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
// tenants yet" table, the exact "no data vs. fetch failed" trap CLAUDE.md
// names.
if (error.value) {
    await navigateTo({ path: STAFF_LOGIN_ROUTE, query: { redirect: route.fullPath } });
}

const tenants = computed(() => data.value?.rows ?? []);
const listError = computed(() => (error.value ? t('staff.tenants.loadError') : ''));

/**
 * Federation list, issue #64's UI half. A SEPARATE `useAsyncData` rather
 * than folded into the tenants response: the two are independent resources
 * (a Federation without a Tenant yet is a normal, freshly-created state),
 * and the tenants fetch above already owns the "no session, bounce to
 * login" redirect for this page, and a second identical redirect here would be
 * redundant, so a failure here just renders its own error note instead.
 */
const federationsData = await useAsyncData(
    'staff-federations',
    () => request<{ rows: StaffFederation[] }>('/api/staff/federations'),
);

const federations = computed(() => federationsData.data.value?.rows ?? []);
const federationsListError = computed(() => (
    federationsData.error.value ? t('staff.federations.loadError') : ''
));

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
            ? t('staff.createTenant.createdWithPassword', {
                slug: result.tenant.slug,
                password: result.initialPassword,
            })
            : t('staff.createTenant.createdReusedAccount', {
                slug: result.tenant.slug,
                email: result.person.email,
            });

        form.slug = '';
        form.name = '';
        form.adminEmail = '';
        form.adminName = '';
        form.federationSlug = '';
        form.timezone = '';

        await refresh();
        // A new tenant may have named an existing federationSlug, so that
        // federation's member list just changed too.
        await federationsData.refresh();
    } catch (caught) {
        const statusCode = (caught as { statusCode?: number })?.statusCode;
        const stated = serverErrorMessage(caught);

        createError.value = statusCode === 409
            ? (stated ?? t('staff.createTenant.conflict', { slug: form.slug }))
            : (stated ?? t('staff.createTenant.error'));
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
            ? t('staff.federations.alreadyExisted', { slug: result.federation.slug })
            : t('staff.federations.created', { slug: result.federation.slug });

        federationForm.slug = '';
        federationForm.name = '';

        await federationsData.refresh();
    } catch (caught) {
        const stated = serverErrorMessage(caught);

        createFederationError.value = stated ?? t('staff.federations.error');
    } finally {
        creatingFederation.value = false;
    }
}

const assigningTenantId = ref('');
const federationAssignError = ref('');

// --- default locale --------------------------------------------------------

/**
 * Per-tenant edit buffer for `TenantDisplaySettings.defaultLocale`, written
 * through `PATCH /api/staff/tenants/:id/locale` (a SECURITY DEFINER function
 * on the ordinary connection, never the owner connection: see
 * `server/utils/staffTenantLocale.ts`).
 *
 * A MAP KEYED BY TENANT ID rather than a `ref` per row seeded by a watcher:
 * Vue does not flush watchers during SSR (CLAUDE.md), so a
 * `watch(data, seed, { immediate: true })` would run once before the fetch
 * resolved and never again. `localeDraft()` reads through to the AWAITED row
 * whenever this map holds no entry for it, so first render, a `refresh()`
 * after a save, and a value another operator changed all show the stored
 * value with no seeding step to get wrong.
 */
const localeDrafts = reactive<Record<string, string | undefined>>({});
const savingLocaleTenantId = ref('');
const localeError = ref('');
const localeSuccess = ref('');

function localeDraft(tenant: StaffTenant): string {
    return localeDrafts[tenant.id] ?? tenant.defaultLocale ?? '';
}

/**
 * Whether this row's buffer differs from what is stored, which is what the
 * Save button is enabled on. Empty input and a null column are the SAME
 * state: "no tenant default, defer to Accept-Language" (the column's schema
 * comment), so clearing an already-empty field is not a change to save.
 */
function localeChanged(tenant: StaffTenant): boolean {
    return localeDraft(tenant).trim() !== (tenant.defaultLocale ?? '');
}

async function saveLocale(tenant: StaffTenant) {
    if (savingLocaleTenantId.value) {
        return;
    }

    savingLocaleTenantId.value = tenant.id;
    localeError.value = '';
    localeSuccess.value = '';

    // Empty input CLEARS the default, so it is sent as an explicit `null`,
    // never as `''`: the route validates with `isUsableLocale()`, which
    // refuses the empty string, and the key must be PRESENT for the route to
    // act at all.
    const draft = localeDraft(tenant).trim();
    const defaultLocale = draft === '' ? null : draft;

    try {
        const result = await $fetch<{ defaultLocale: string | null }>(
            `/api/staff/tenants/${tenant.id}/locale`,
            { method: 'PATCH', body: { defaultLocale } },
        );

        // ONE KEY PER STATE, not one sentence interpolating "none": a cleared
        // default is a different fact than a set one, and a translator must
        // be able to phrase each on its own.
        localeSuccess.value = result.defaultLocale === null
            ? t('staff.tenants.localeCleared', { slug: tenant.slug })
            : t('staff.tenants.localeSaved', { slug: tenant.slug, locale: result.defaultLocale });

        /*
         * Buffer set back to `undefined` so the row reads through to the
         * refreshed row again rather than pinning whatever was typed.
         * `undefined` rather than `delete`, which eslint's
         * `no-dynamic-delete` refuses and which `localeDraft()`'s `??` reads
         * identically anyway.
         */
        localeDrafts[tenant.id] = undefined;
        await refresh();
    } catch (caught) {
        const stated = serverErrorMessage(caught);

        localeError.value = stated ?? t('staff.tenants.localeError', { slug: tenant.slug });
    } finally {
        savingLocaleTenantId.value = '';
    }
}

// --- erasure (issue #84) ---------------------------------------------------

const erasingTenantId = ref('');
const eraseConfirmInput = ref('');
const erasing = ref(false);
const eraseError = ref('');
const eraseSuccess = ref('');

function startErase(tenantId: string) {
    erasingTenantId.value = tenantId;
    eraseConfirmInput.value = '';
    eraseError.value = '';
    eraseSuccess.value = '';
}

function cancelErase() {
    erasingTenantId.value = '';
    eraseConfirmInput.value = '';
    eraseError.value = '';
}

interface EraseTenantResult { personCount: number; accountsErased: number }

async function confirmErase(tenant: StaffTenant) {
    if (erasing.value || eraseConfirmInput.value !== tenant.slug) {
        return;
    }

    erasing.value = true;
    eraseError.value = '';

    try {
        const result = await $fetch<EraseTenantResult>(`/api/staff/tenants/${tenant.id}`, {
            method: 'DELETE',
            body: { confirmSlug: eraseConfirmInput.value },
        });

        /*
         * TWO INDEPENDENT COUNTS, so two plural messages folded into one
         * carrier sentence (i18n/CONVENTIONS.md § "Pluralisation"): vue-i18n
         * chooses a form from ONE count, and this sentence agrees with two.
         * What it must not be is the version this replaced, which flipped
         * `person`/`people` and an `s` inside the template literal: German has
         * no `-s` plural, and a word assembled from a ternary has no key at
         * all. The conjunction stays inside `eraseSuccess`, so a translator can
         * move both clauses.
         */
        eraseSuccess.value = t('staff.tenants.eraseSuccess', {
            slug: tenant.slug,
            people: t('staff.tenants.erasePeopleCount', result.personCount),
            logins: t('staff.tenants.eraseLoginCount', result.accountsErased),
        });

        cancelErase();
        await refresh();
    } catch (caught) {
        const stated = serverErrorMessage(caught);

        eraseError.value = stated ?? t('staff.tenants.eraseError', { slug: tenant.slug });
    } finally {
        erasing.value = false;
    }
}

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
        const stated = serverErrorMessage(caught);

        federationAssignError.value = stated
            ?? t('staff.tenants.federationUpdateError', { slug: tenant.slug });
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

    &_locale {
        display: flex;
        gap: 8px;
        align-items: center;
        min-width: 260px;
    }

    &_erase {
        padding: 16px;
        background: varToRgba('error500', 0.08);

        &_warning {
            margin: 0 0 12px;
            font-size: var(--font-size-sm);
            font-weight: 600;
            color: $error400;
        }

        &_row {
            display: flex;
            flex-wrap: wrap;
            gap: 12px;
            align-items: flex-end;
        }
    }
}
</style>
