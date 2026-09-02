<template>
    <section
        v-if="canCreate"
        class="satmpl"
    >
        <CommonButton
            v-if="!expanded"
            icon="material-symbols:content-copy-outline"
            type="transparent"
            @click="open"
        >{{ t('manageUi.saveAsTemplate.action') }}</CommonButton>

        <div
            v-else
            class="satmpl_form"
        >
            <label class="satmpl_label">
                <span>{{ t('manageUi.saveAsTemplate.nameLabel') }}</span>
                <input
                    v-model="name"
                    :disabled="busy"
                    :placeholder="t('manageUi.saveAsTemplate.namePlaceholder')"
                    type="text"
                    @keydown.enter="save"
                    @keydown.esc="cancel"
                >
            </label>

            <div class="satmpl_actions">
                <CommonButton
                    :disabled="busy || !name.trim()"
                    type="primary"
                    @click="save"
                >{{ busy ? t('common.action.saving') : t('common.action.save') }}</CommonButton>
                <CommonButton
                    :disabled="busy"
                    type="transparent"
                    @click="cancel"
                >{{ t('common.action.cancel') }}</CommonButton>
            </div>

            <p
                v-if="error"
                class="satmpl_error"
                role="alert"
            >{{ error }}</p>

            <p
                v-if="justSaved"
                class="satmpl_ok"
            >{{ t('manageUi.saveAsTemplate.saved') }}</p>
        </div>
    </section>
</template>

<script setup lang="ts">
import type { ManageEntity, EntityRow } from '~/utils/manageRegistry';
import { useT } from '~/composables/i18n';

/**
 * The reverse of `ManageTemplateStarter`: capture THIS row's current shape
 * into a new template, once, on click. Generic on the same terms that
 * component is: a resource and a builder function the registry supplies,
 * so this is not Offering-specific despite being Offering's only caller.
 *
 * EDIT-PAGE ONLY, by construction: it needs an existing row to read values
 * from, which is exactly why `startFromTemplate` sits on the create page and
 * this one does not.
 */
const props = defineProps<{
    config: NonNullable<ManageEntity['saveAsTemplate']>;
    row: EntityRow;
}>();

const { t } = useT();

const canCreate = useHasPermission(props.config.createPermission);
const request = useRequestFetch();

const expanded = ref(false);
const name = ref('');
const busy = ref(false);
const error = ref('');
const justSaved = ref(false);

function open() {
    expanded.value = true;
    justSaved.value = false;
}

function cancel() {
    expanded.value = false;
    name.value = '';
    error.value = '';
}

async function save() {
    const trimmed = name.value.trim();

    if (!trimmed || busy.value) {
        return;
    }

    busy.value = true;
    error.value = '';

    try {
        // Explicit type argument, not left to infer: an untyped dynamic
        // `/api/${resource}` URL leads Nuxt's typed-fetch overloads to match
        // it against a GET-only route pattern and reject `method: 'POST'`,
        // same as the working pattern in `ManageOfferingPlanBulkApply.vue`.
        await request<EntityRow>(`/api/${props.config.resource}`, {
            method: 'POST',
            body: { name: trimmed, ...props.config.buildTemplate(props.row) },
        });

        expanded.value = false;
        name.value = '';
        justSaved.value = true;
    } catch (cause) {
        error.value = serverErrorMessage(cause)
            ?? t('manageUi.saveAsTemplate.error');
    } finally {
        busy.value = false;
    }
}
</script>

<style scoped lang="scss">
.satmpl {
    margin-bottom: var(--space-6);

    &_form {
        display: flex;
        flex-direction: column;
        gap: var(--space-3);

        padding: var(--space-5);
        border: 1px dashed $surface4;
        border-radius: var(--radius-lg);

        background: $surface1;
    }

    &_label {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);

        font-size: var(--font-size-sm);
        font-weight: 600;
        color: $content4;

        input {
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

    &_actions {
        display: flex;
        gap: var(--space-3);
    }

    &_error {
        margin: 0;
        font-size: var(--font-size-xs);
        color: $error700;
    }

    &_ok {
        margin: 0;
        font-size: var(--font-size-xs);
        color: $success700;
    }
}
</style>
