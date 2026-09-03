<template>
    <StaffPanel
        :title="t('staff.tenants.heading')"
        :lead="t('staff.tenants.lead')"
    >
        <template #aside>
            <p class="tenants_count">{{ t('staff.tenants.count', { count: tenants.length }, tenants.length) }}</p>
        </template>

        <p
            v-if="listError"
            class="tenants_note tenants_note--error"
            role="alert"
        >{{ listError }}</p>

        <p
            v-else-if="tenants.length === 0"
            class="tenants_empty"
        >{{ t('staff.tenants.empty') }}</p>

        <div
            v-else
            class="tenants_tablewrap"
        >
            <table class="tenants_table">
                <thead>
                    <tr>
                        <th scope="col">{{ t('common.field.name') }}</th>
                        <th scope="col">{{ t('common.field.timezone') }}</th>
                        <th scope="col">{{ t('staff.tenants.column.federation') }}</th>
                        <th scope="col">{{ t('staff.tenants.column.locale') }}</th>
                        <th scope="col">{{ t('common.field.created') }}</th>
                        <th scope="col"><span class="sr-only">{{ t('staff.tenants.column.erase') }}</span></th>
                    </tr>
                </thead>
                <tbody>
                    <template
                        v-for="tenant in tenants"
                        :key="tenant.id"
                    >
                        <tr>
                            <td class="tenants_name">
                                <span class="tenants_name-title">{{ tenant.name }}</span>
                                <code class="tenants_slug">{{ tenant.slug }}</code>
                            </td>
                            <td class="tenants_muted">{{ tenant.timezone }}</td>
                            <td>
                                <select
                                    class="tenants_control"
                                    :aria-label="t('staff.tenants.federationAriaLabel', { slug: tenant.slug })"
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
                                    change, because a half-typed tag (`de-`)
                                    is refused by the route and would
                                    otherwise error on every keystroke.
                                -->
                                <div class="tenants_locale">
                                    <input
                                        class="tenants_control tenants_control--locale"
                                        type="text"
                                        autocomplete="off"
                                        :aria-label="t('staff.tenants.localeAriaLabel', { slug: tenant.slug })"
                                        :disabled="savingLocaleTenantId === tenant.id"
                                        :placeholder="t('staff.tenants.localePlaceholder')"
                                        :value="localeDraft(tenant)"
                                        @input="localeDrafts[tenant.id] = ($event.target as HTMLInputElement).value"
                                    >
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
                            <td class="tenants_muted">
                                <time :datetime="tenant.createdAt">{{ formatDate(tenant.createdAt, locale) }}</time>
                            </td>
                            <td class="tenants_erase-cell">
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
                                class="tenants_erase"
                                colspan="6"
                            >
                                <p
                                    class="tenants_erase-warning"
                                    role="alert"
                                >{{ t('staff.tenants.eraseWarning', { slug: tenant.slug }) }}</p>

                                <div class="tenants_erase-row">
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
                                    class="tenants_note tenants_note--error"
                                    role="alert"
                                >{{ eraseError }}</p>
                            </td>
                        </tr>
                    </template>
                </tbody>
            </table>
        </div>

        <!--
            `<i18n-t>` rather than a key either side of each `<code>`: the
            sentence carries two code samples inside its grammar, and German
            reorders clauses. Wording deliberately tracks
            `managePages.display.localeHint` and `my.account.localeHint`, the
            two places that already say what this column does.
        -->
        <i18n-t
            class="tenants_hint"
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
            v-for="message in errors"
            :key="message"
            class="tenants_note tenants_note--error"
            role="alert"
        >{{ message }}</p>

        <p
            v-for="message in successes"
            :key="message"
            class="tenants_note tenants_note--success"
            role="status"
        >{{ message }}</p>
    </StaffPanel>
</template>

<script setup lang="ts">
import CommonButton from '~/components/common/CommonButton.vue';
import CommonInputText from '~/components/common/CommonInputText.vue';
import StaffPanel from '~/components/staff/StaffPanel.vue';
import { useT } from '~/composables/i18n';
import { useViewerLocale } from '~/composables/locale';
import { formatDate } from '~/utils/formatDate';
import type { StaffFederation, StaffTenant } from '~/utils/staff';

/**
 * The tenant table (issue #76), with the Federation column (issue #64), the
 * default-locale column and GDPR erasure (issue #84). Behaviour moved here
 * from `pages/staff/index.vue` unchanged; the page keeps the data and this
 * component asks it to refresh after every write, since a tenant's federation
 * change also changes that federation's member list on the other tab.
 */
const props = defineProps<{
    tenants: StaffTenant[];
    federations: StaffFederation[];
    listError: string;
}>();

const emit = defineEmits<{ refresh: [] }>();

const { t } = useT();
const locale = useViewerLocale();

// --- federation ---------------------------------------------------------------

const assigningTenantId = ref('');
const federationAssignError = ref('');

async function setTenantFederation(tenant: StaffTenant, federationId: string | null) {
    assigningTenantId.value = tenant.id;
    federationAssignError.value = '';

    try {
        await $fetch(`/api/staff/tenants/${tenant.id}`, { method: 'PATCH', body: { federationId } });
        emit('refresh');
    } catch (caught) {
        federationAssignError.value = serverErrorMessage(caught)
            ?? t('staff.tenants.federationUpdateError', { slug: tenant.slug });
    } finally {
        assigningTenantId.value = '';
    }
}

// --- default locale -------------------------------------------------------------

const localeDrafts = reactive<Record<string, string | undefined>>({});
const savingLocaleTenantId = ref('');
const localeError = ref('');
const localeSuccess = ref('');

function localeDraft(tenant: StaffTenant): string {
    return localeDrafts[tenant.id] ?? tenant.defaultLocale ?? '';
}

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

        localeDrafts[tenant.id] = undefined;
        emit('refresh');
    } catch (caught) {
        localeError.value = serverErrorMessage(caught) ?? t('staff.tenants.localeError', { slug: tenant.slug });
    } finally {
        savingLocaleTenantId.value = '';
    }
}

// --- erasure (issue #84) -------------------------------------------------------

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

        eraseSuccess.value = t('staff.tenants.eraseSuccess', {
            slug: tenant.slug,
            people: t('staff.tenants.erasePeopleCount', result.personCount),
            logins: t('staff.tenants.eraseLoginCount', result.accountsErased),
        });

        cancelErase();
        emit('refresh');
    } catch (caught) {
        eraseError.value = serverErrorMessage(caught) ?? t('staff.tenants.eraseError', { slug: tenant.slug });
    } finally {
        erasing.value = false;
    }
}

const errors = computed(() => [federationAssignError.value, localeError.value].filter(Boolean));
const successes = computed(() => [localeSuccess.value, eraseSuccess.value].filter(Boolean));

// `props` is read in the template; named so the unused-locals rule is
// satisfied without a bare expression statement.
void props;
</script>

<style scoped lang="scss">
.tenants {
    &_count {
        margin: 0;
        font-size: var(--font-size-sm);
        font-variant-numeric: tabular-nums;
        color: $content7;
    }

    &_tablewrap {
        overflow-x: auto;
        border: 1px solid $surface4;
        border-radius: var(--radius-xl);
    }

    &_table {
        border-collapse: collapse;
        width: 100%;
        min-width: 880px;
        font-size: var(--font-size-sm);

        th {
            padding: var(--space-3) var(--space-4);
            border-bottom: 1px solid $surface4;

            font-size: var(--font-size-xs);
            font-weight: 650;
            color: $content7;
            text-align: left;
            text-transform: uppercase;
            letter-spacing: 0.05em;

            background: $surface1;
        }

        td {
            padding: var(--space-3) var(--space-4);
            border-bottom: 1px solid $surface3;
            vertical-align: middle;
        }

        tbody tr:last-child td { border-bottom: none; }
    }

    &_name {
        display: flex;
        flex-direction: column;
        gap: var(--space-1);

        &-title {
            font-size: var(--font-size-md);
            color: $content2;
        }
    }

    &_slug {
        font-size: var(--font-size-xs);
        color: $content7;
    }

    &_muted {
        font-variant-numeric: tabular-nums;
        color: $content6;
        white-space: nowrap;
    }

    &_control {
        min-height: 32px;
        padding: 0 var(--space-3);
        border: 1px solid $surface4;
        border-radius: var(--radius-lg);

        font-family: inherit;
        font-size: var(--font-size-sm);
        color: $content3;

        background: $surface1;

        &:focus {
            border-color: $primary500;
            outline: none;
        }
        &--locale { width: 140px; }
    }

    &_locale {
        display: flex;
        gap: var(--space-2);
        align-items: center;
    }

    &_erase-cell { text-align: right; }

    &_erase {
        background: varToRgba('error500', 0.06);

        &-warning {
            margin: 0 0 var(--space-4);
            font-size: var(--font-size-sm);
            line-height: var(--leading-prose);
            color: $error700;
        }

        &-row {
            display: flex;
            flex-wrap: wrap;
            gap: var(--space-4);
            align-items: flex-end;
        }
    }

    &_hint {
        margin: 0;
        font-size: var(--font-size-sm);
        line-height: var(--leading-prose);
        color: $content7;

        code { font-size: var(--font-size-xs); }
    }

    &_empty {
        margin: 0;
        padding: var(--space-7) var(--space-5);
        border: 1px dashed $surface4;
        border-radius: var(--radius-xl);

        font-size: var(--font-size-sm);
        color: $content7;
        text-align: center;
    }

    &_note {
        margin: 0;
        font-size: var(--font-size-sm);

        &--error { color: $error700; }
        &--success { color: $success700; }
    }
}
</style>
