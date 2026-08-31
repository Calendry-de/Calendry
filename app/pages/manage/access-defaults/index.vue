<template>
    <ManageShell
        description="Whether a newly created Person is granted an access role automatically."
        title="Access defaults"
    >
        <p class="intro">
            Off by default. Granting a role to somebody is normally a deliberate
            decision made on their own page — this setting reverses that for every
            new Person at once, so choose it deliberately too. Every grant it makes
            is marked as coming from this default, distinct from a role assigned by
            hand.
        </p>

        <p
            v-if="loadError"
            class="note note--error"
            role="alert"
        >{{ loadError }}</p>

        <p
            v-else-if="!canEdit"
            class="note"
        >
            You can see this setting but not change it. Changing it needs both
            <code>tenant.update</code> and <code>person_access_role.assign</code>.
        </p>

        <form
            class="panel"
            @submit.prevent="save"
        >
            <label
                class="panel_field"
                :for="selectId"
            >
                <span>Default access role for new People</span>

                <select
                    :id="selectId"
                    v-model="form.defaultAccessRoleId"
                    :disabled="!canEdit"
                >
                    <option :value="null">None — grant nothing automatically</option>
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
                Every Person created from now on will hold this role immediately —
                including through bulk creation, once that exists. Deleting this
                role while it is the default is refused; choose a different default
                (or None) first.
            </p>

            <div
                v-if="canEdit"
                class="panel_actions"
            >
                <CommonButton
                    :disabled="saving || !dirty"
                    native-type="submit"
                    type="primary"
                >{{ saving ? 'Saving…' : 'Save' }}</CommonButton>

                <p
                    v-if="saved"
                    class="panel_saved"
                    role="status"
                >Saved.</p>
                <p
                    v-if="saveError"
                    class="note note--error"
                    role="alert"
                >{{ saveError }}</p>
            </div>
        </form>
    </ManageShell>
</template>

<script setup lang="ts">
import CommonButton from '~/components/common/CommonButton.vue';
import ManageShell from '~/components/manage/ManageShell.vue';
import { useHasPermission, useSession } from '~/composables/session';

/**
 * The tenant's authorization defaults (issue #25) — a SINGLETON, not a list,
 * same reasoning `/manage/display` gives for being bespoke rather than a row
 * on the generic scaffold.
 */
definePageMeta({
    // Gated inline, not through the `manage` entity middleware — same reason
    // `/manage/display` is: this is not a registry entity.
    middleware: [
        () => {
            const held = new Set(useSession().value?.permissions ?? []);

            if (!held.has('tenant.read')) {
                return abortNavigation(createError({
                    statusCode: 403,
                    statusMessage: 'Viewing access defaults needs tenant.read.',
                }));
            }
        },
    ],
});

useHead({ title: 'Access defaults' });

const selectId = useId();
// Both, not either — see index.put.ts's own note on why writing this needs
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
    ? 'Could not load access defaults. Nothing has been changed.'
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
        saveError.value = (error as { statusMessage?: string }).statusMessage
            ?? 'Could not save. Nothing has been changed.';
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
