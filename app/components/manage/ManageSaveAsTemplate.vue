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
        >Save as template</CommonButton>

        <div
            v-else
            class="satmpl_form"
        >
            <label class="satmpl_label">
                <span>Template name</span>
                <input
                    v-model="name"
                    :disabled="busy"
                    placeholder="e.g. Maths — 4x/week"
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
                >{{ busy ? 'Saving…' : 'Save' }}</CommonButton>
                <CommonButton
                    :disabled="busy"
                    type="transparent"
                    @click="cancel"
                >Cancel</CommonButton>
            </div>

            <p
                v-if="error"
                class="satmpl_error"
                role="alert"
            >{{ error }}</p>

            <p
                v-if="justSaved"
                class="satmpl_ok"
            >Saved as a template — editing this offering later won't change it.</p>
        </div>
    </section>
</template>

<script setup lang="ts">
import type { ManageEntity, EntityRow } from '~/utils/manageRegistry';

/**
 * The reverse of `ManageTemplateStarter`: capture THIS row's current shape
 * into a new template, once, on click. Generic on the same terms that
 * component is — a resource and a builder function the registry supplies —
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
        await request(`/api/${props.config.resource}`, {
            method: 'POST',
            body: { name: trimmed, ...props.config.buildTemplate(props.row) },
        });

        expanded.value = false;
        name.value = '';
        justSaved.value = true;
    } catch (cause) {
        error.value = (cause as { statusMessage?: string })?.statusMessage ?? 'Could not save the template.';
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
