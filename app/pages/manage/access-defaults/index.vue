<template>
    <CommonAppShell
        :description="t('managePages.accessDefaults.description')"
        :title="t('managePages.accessDefaults.pageTitle')"
    >
        <p class="intro">
            {{ t('managePages.accessDefaults.intro') }}
        </p>

        <p
            v-if="loadError"
            class="note note--error"
            role="alert"
        >{{ loadError }}</p>

        <!--
            `<i18n-t>` so the two permission keys stay INSIDE one sentence: they
            are the sentence's objects, and German puts them elsewhere in the
            clause. The keys themselves are identifiers, not copy, so they are
            literals here rather than messages.
        -->
        <i18n-t
            v-else-if="!canEdit"
            class="note"
            keypath="managePages.accessDefaults.readOnly"
            scope="global"
            tag="p"
        >
            <template #tenantUpdate>
                <code>tenant.update</code>
            </template>
            <template #assign>
                <code>person_access_role.assign</code>
            </template>
        </i18n-t>

        <form
            class="panel"
            @submit.prevent="save"
        >
            <label
                class="panel_field"
                :for="selectId"
            >
                <span>{{ t('managePages.accessDefaults.roleLabel') }}</span>

                <select
                    :id="selectId"
                    v-model="form.defaultAccessRoleId"
                    :disabled="!canEdit"
                >
                    <option :value="null">{{ t('managePages.accessDefaults.roleNone') }}</option>
                    <option
                        v-for="role in roles"
                        :key="role.id"
                        :value="role.id"
                    >{{ role.name }}</option>
                </select>
            </label>

            <p
                v-if="form.defaultAccessRoleId"
                class="panel_hint"
            >
                {{ t('managePages.accessDefaults.roleHint') }}
            </p>

            <div
                v-if="canEdit"
                class="panel_actions"
            >
                <CommonButton
                    :disabled="saving || !dirty"
                    native-type="submit"
                    type="primary"
                >{{ saving ? t('common.action.saving') : t('common.action.save') }}</CommonButton>

                <p
                    v-if="saved"
                    class="panel_saved"
                    role="status"
                >{{ t('managePages.accessDefaults.saved') }}</p>
                <p
                    v-if="saveError"
                    class="note note--error"
                    role="alert"
                >{{ saveError }}</p>
            </div>
        </form>
    </CommonAppShell>
</template>

<script setup lang="ts">
import CommonButton from '~/components/common/CommonButton.vue';
import CommonAppShell from '~/components/common/CommonAppShell.vue';
import { useT } from '~/composables/i18n';
import { useHasPermission, useSession } from '~/composables/session';

/**
 * The tenant's authorization defaults (issue #25): a SINGLETON, not a list,
 * same reasoning `/manage/display` gives for being bespoke rather than a row
 * on the generic scaffold.
 */
definePageMeta({
    // Gated inline, not through the `manage` entity middleware: same reason
    // `/manage/display` is: this is not a registry entity.
    middleware: [
        () => {
            const held = new Set(useSession().value?.permissions ?? []);

            if (!held.has('tenant.read')) {
                return abortNavigation(createError({
                    statusCode: 403,
                    message: 'Viewing access defaults needs tenant.read.',
                }));
            }
        },
    ],
});

const { t } = useT();

useHead(() => ({ title: t('managePages.accessDefaults.pageTitle') }));

const selectId = useId();
// Both, not either: see index.put.ts's own note on why writing this needs
// the union of "may change tenant config" and "may grant access at all".
const canEdit = computed(() => useHasPermission('tenant.update').value
    && useHasPermission('person_access_role.assign').value);
const request = useRequestFetch();

interface AuthSettings {
    defaultAccessRoleId: string | null;
    defaultAccessRole: { id: string; name: string; key: string } | null;
    configured: boolean;
}

const settings = useAsyncData('auth-settings', () => request<AuthSettings>('/api/auth-settings'));
const rolesData = useAsyncData(
    'auth-settings:roles',
    () => request<{ rows: { id: string; key: string; name: string }[] }>('/api/access-roles', {
        query: { limit: 200 },
    }),
);

await Promise.all([settings, rolesData]);

const roles = computed(() => rolesData.data.value?.rows ?? []);

const loadError = computed(() => (settings.error.value || rolesData.error.value
    ? t('managePages.accessDefaults.loadError')
    : ''));

const form = reactive({
    defaultAccessRoleId: settings.data.value?.defaultAccessRoleId ?? null,
});

const initial = JSON.stringify(form);
const dirty = computed(() => JSON.stringify(form) !== initial);

const saving = ref(false);
const saved = ref(false);
const saveError = ref('');

async function save() {
    saving.value = true;
    saved.value = false;
    saveError.value = '';

    try {
        await request('/api/auth-settings', { method: 'PUT', body: { ...form } });
        await settings.refresh();
        saved.value = true;
    }
    catch (error) {
        saveError.value = serverErrorMessage(error)
            ?? t('managePages.accessDefaults.saveError');
    }
    finally {
        saving.value = false;
    }
}
</script>

<style scoped lang="scss">
.intro {
    max-width: 68ch;
    margin-bottom: var(--space-7);
    font-size: var(--font-size-md);
    color: $content6;
}

.note {
    max-width: 68ch;
    margin-bottom: var(--space-6);
    font-size: var(--font-size-sm);
    color: $content7;

    &--error {
        color: $error700;
    }

    code {
        font-family: monospace;
    }
}

.panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
    max-width: 68ch;

    &_field {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);

        font-size: var(--font-size-sm);
        font-weight: 600;
        color: $content4;

        select {
            padding: var(--space-3) var(--space-5);
            border: 1px solid $surface4;
            border-radius: var(--radius-lg);

            font-family: inherit;
            font-size: var(--font-size-md);
            font-weight: 400;
            color: $content4;

            background: $surface0;
        }
    }

    &_hint {
        margin: 0;
        font-size: var(--font-size-sm);
        line-height: 1.5;
        color: $content7;
    }

    &_actions {
        display: flex;
        gap: var(--space-4);
        align-items: center;
    }

    &_saved {
        margin: 0;
        font-size: var(--font-size-sm);
        color: $success700;
    }
}
</style>
