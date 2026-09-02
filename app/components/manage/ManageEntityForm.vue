<template>
    <form
        class="entity-form"
        @submit.prevent="$emit('save')"
    >
        <p
            v-if="readonlyReason"
            class="entity-form_banner"
        >
            <Icon
                name="material-symbols:lock-outline"
                aria-hidden="true"
            />
            {{ readonlyReason }}
        </p>

        <p
            v-if="form.formError.value"
            class="entity-form_error"
            role="alert"
        >{{ form.formError.value }}</p>

        <div class="entity-form_fields">
            <!--
                Bespoke fields go here, above the generic ones, because they are
                always the defining part of the record (a group's parent, a
                grid's shape) and burying them under boilerplate inverts that.
            -->
            <slot
                name="fields"
                :readonly="readonly"
            />

            <ManageField
                v-for="field in primaryFields"
                :key="field.key"
                v-model="draft[field.key]"
                :error="form.fieldErrors.value[field.key]"
                :field="field"
                :readonly="readonly || form.isFieldLocked(field)"
                :reference-rows="field.reference ? form.references.value[field.reference.resource] : undefined"
                :note="noteFor(field)"
            />

            <!--
                PROGRESSIVE DISCLOSURE, NEVER REMOVAL (issue #8): a tenant's
                mode only decides which fields lead: every one of them is
                still reachable, saved and validated exactly as before.
            -->
            <details
                v-if="advancedFields.length"
                class="entity-form_advanced"
            >
                <summary>{{ t('manageUi.entityForm.moreFields') }}</summary>

                <ManageField
                    v-for="field in advancedFields"
                    :key="field.key"
                    v-model="draft[field.key]"
                    :error="form.fieldErrors.value[field.key]"
                    :field="field"
                    :readonly="readonly || form.isFieldLocked(field)"
                    :reference-rows="field.reference ? form.references.value[field.reference.resource] : undefined"
                    :note="noteFor(field)"
                />
            </details>
        </div>

        <footer
            v-if="!readonly"
            class="entity-form_actions"
        >
            <CommonButton
                :disabled="form.busy.value || !form.isDirty.value"
                type="primary"
                @click="$emit('save')"
            >{{ form.busy.value ? t('common.action.saving') : saveLabel }}</CommonButton>

            <CommonButton
                v-if="form.isDirty.value"
                :disabled="form.busy.value"
                type="secondary"
                @click="$emit('reset')"
            >{{ t('manageUi.entityForm.discard') }}</CommonButton>

            <span class="entity-form_spacer"/>

            <CommonButton
                v-if="canDelete && mode === 'edit' && !form.isSystemRow.value"
                :disabled="form.busy.value"
                type="destructive"
                @click="$emit('request-delete')"
            >{{ t('common.action.delete') }}</CommonButton>
        </footer>

        <p
            v-if="mode === 'edit' && form.isSystemRow.value"
            class="entity-form_hint"
        >
            {{ t('manageUi.entityForm.systemRowHint') }}
        </p>
    </form>
</template>

<script setup lang="ts">
import type { useEntityForm } from '~/composables/entityForm';
import type { FieldDef } from '~/utils/manageRegistry';
import ManageField from '~/components/manage/ManageField.vue';
import { useT } from '~/composables/i18n';

/**
 * The generic form body: registry fields in, one row edited out.
 *
 * The form composable is created by the PAGE, not here, because the page holds
 * the single top-level `await` on its data. This component renders what it is
 * given and emits intent.
 */
const props = defineProps<{
    /** Read-only view of the form's state. The draft is a model, not a prop. */
    form: ReturnType<typeof useEntityForm>;
    mode: 'create' | 'edit';
    canUpdate: boolean;
    canDelete: boolean;
}>();

defineEmits<{ save: []; reset: []; 'request-delete': [] }>();

defineSlots<{ fields?: (props: { readonly: boolean }) => unknown }>();

const { t } = useT();

/**
 * Fields this component renders. `custom` ones are part of the record (draft,
 * dirty tracking, payload, error mapping), but their control is supplied by the
 * bespoke detail component through the `fields` slot.
 */
const genericFields = computed(() => props.form.fields.filter((field) => !field.custom));

/**
 * Split by the entity's own `advancedFieldsForMode` hook (issue #8), a UI
 * bias, so it is computed here rather than in the registry, which stays pure
 * data. Most entities declare no hook and get an empty advanced set, i.e. no
 * behaviour change from before this existed.
 */
const tenantMode = useTenantMode();

const advancedKeys = computed(() => props.form.entity.advancedFieldsForMode?.(tenantMode.value) ?? new Set());

const primaryFields = computed(() => genericFields.value.filter((field) => !advancedKeys.value.has(field.key)));
const advancedFields = computed(() => genericFields.value.filter((field) => advancedKeys.value.has(field.key)));

/**
 * Server-computed notes for fields declaring `derived`.
 *
 * Fetched here rather than in `ManageField` because the ROW ID lives at this
 * level, and a field component that had to be told its own row's id would be a
 * worse seam than one extra prop.
 *
 * Edit only: on the create page there is no id to compute against, the same
 * reason relations are unavailable there.
 */
const derivedNotes = ref<Record<string, string>>({});

const request = useRequestFetch();

async function loadDerived() {
    const id = (props.form.row.value as { id?: string } | null)?.id;

    if (!id || props.mode !== 'edit') {
        return;
    }

    for (const field of props.form.fields) {
        if (!field.derived) {
            continue;
        }

        try {
            const data = await request<Record<string, unknown>>(field.derived.path.replace(':id', id));

            derivedNotes.value = { ...derivedNotes.value, [field.key]: field.derived.describe(data) };
        } catch {
            /*
             * Degraded silently ON PURPOSE, and this is the one place that is
             * right: the note is explanatory, and a failed fetch showing an
             * error beside an unrelated input would suggest the FIELD is wrong.
             * The stored value and the save path are untouched by its absence.
             */
        }
    }
}

/*
 * Re-run whenever the row changes, so editing another Offering does not show
 * the previous one's number. `immediate` is safe here because this is not
 * first-render state: the note is additive, and SSR simply omits it.
 */
watch(() => (props.form.row.value as { id?: string } | null)?.id, loadDerived, { immediate: true });

/**
 * The draft is the one thing this component writes, so it travels as a model.
 * Reaching into `form.draft` through the prop would work and would also make
 * the page unable to see, at the call site, that its state is being edited here.
 */
const draft = defineModel<Record<string, unknown>>('draft', { required: true });

/**
 * Two independent reasons a row cannot be edited, and they are not the same
 * fact, so they do not share a sentence: one is about this caller, the other is
 * about who owns the row.
 */
const readonly = computed(() => !props.canUpdate || props.form.isForeignOwned.value);

const readonlyReason = computed(() => {
    if (props.form.isForeignOwned.value) {
        return t('manageUi.entityForm.readonlyFederation');
    }

    if (!props.canUpdate) {
        return t('manageUi.entityForm.readonlyPermission');
    }

    return '';
});

/**
 * The field's note, plus the one the FORM has to add.
 *
 * A locked reference must say why it is locked, or it reads as a field somebody
 * decided to freeze. It also has to say what happens on save (the value is left
 * alone, not cleared), because "read-only" alone does not distinguish the two,
 * and the difference is a record's data.
 *
 * Composed rather than replacing `derivedNotes`: both can apply to the same
 * field, and dropping the derived one to make room would trade one silence for
 * another.
 */
function noteFor(field: FieldDef): string {
    const derived = derivedNotes.value[field.key] ?? '';

    if (!props.form.isFieldLocked(field)) {
        return derived;
    }

    const locked = t('manageUi.entityForm.lockedFieldNote');

    /*
     * Two complete sentences joined by a space, not one message interpolating
     * the other (i18n/CONVENTIONS.md § "Assembled sentences"): the space is
     * punctuation between finished items, and a translator handed `{derived}`
     * could not see what it holds.
     */
    return derived ? `${derived} ${locked}` : locked;
}

const saveLabel = computed(() => (props.mode === 'create'
    ? t('common.action.create')
    : t('manageUi.entityForm.saveChanges')));
</script>

<style scoped lang="scss">
.entity-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);

    max-width: 620px;
    padding: var(--space-7);
    border-radius: var(--radius-xl);

    background: $surface1;

    &_fields {
        display: flex;
        flex-direction: column;
        gap: var(--space-6);
    }

    &_advanced {
        display: flex;
        flex-direction: column;
        gap: var(--space-6);

        padding-top: var(--space-2);
        border-top: 1px dashed $surface3;

        > summary {
            cursor: pointer;

            padding: var(--space-2) 0;

            font-size: var(--font-size-sm);
            font-weight: 600;
            color: $content6;
        }
    }

    &_banner {
        display: flex;
        gap: var(--space-4);
        align-items: center;

        margin: 0;
        padding: 10px var(--space-5);
        border-radius: var(--radius-lg);

        font-size: var(--font-size-sm);
        color: $content5;

        background: $surface3;

        svg {
            flex: none;
            width: 16px;
            height: 16px;
        }
    }

    &_error {
        margin: 0;
        padding: 10px var(--space-5);
        border-radius: var(--radius-lg);

        font-size: var(--font-size-md);
        font-weight: 600;
        color: $error700;

        background: varToRgba('error500', 0.14);
    }

    &_actions {
        display: flex;
        gap: var(--space-4);
        align-items: center;

        padding-top: var(--space-5);
        border-top: 1px solid $surface3;
    }

    &_spacer { flex: 1; }

    &_hint {
        margin: 0;
        font-size: var(--font-size-sm);
        color: $content7;
    }
}
</style>
