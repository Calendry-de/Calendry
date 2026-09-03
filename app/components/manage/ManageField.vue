<template>
    <div
        class="field"
        :class="{ 'field--invalid': !!error }"
    >
        <label
            class="field_label"
            :for="controlId"
        >
            {{ field.label }}
            <span
                v-if="field.required"
                class="field_required"
                aria-hidden="true"
            >*</span>
        </label>

        <!--
            Read-only renders as TEXT, not a disabled input. A disabled control
            reads as "unavailable right now"; static text reads as "this is the
            value, and it is not yours to change", which is what a missing
            update permission actually means.
        -->
        <p
            v-if="readonly"
            :id="controlId"
            class="field_static"
        >{{ staticText }}</p>

        <textarea
            v-else-if="field.type === 'textarea'"
            :id="controlId"
            class="field_control field_control--area"
            :value="(model as string)"
            :placeholder="field.placeholder"
            rows="3"
            @input="emitValue(($event.target as HTMLTextAreaElement).value)"
        />

        <label
            v-else-if="field.type === 'boolean'"
            class="field_switch"
        >
            <input
                :id="controlId"
                type="checkbox"
                :checked="Boolean(model)"
                @change="emitValue(($event.target as HTMLInputElement).checked)"
            >
            <span>{{ model ? t('manageUi.shared.yes') : t('manageUi.shared.no') }}</span>
        </label>

        <!--
            `:selected` on the options, not just `:value` on the select.

            `value` is a PROPERTY of a select element, not an attribute, so
            server rendering drops it entirely and the browser falls back to the
            first option. A term that has a time grid rendered as "(None)"
            until hydration corrected it: the page stating the opposite of the
            truth, briefly, with a hydration mismatch behind it. `selected` IS a
            real attribute and survives SSR.
        -->
        <select
            v-else-if="field.type === 'reference' || field.type === 'select'"
            :id="controlId"
            class="field_control"
            :value="(model as string) ?? ''"
            @change="emitValue(($event.target as HTMLSelectElement).value || null)"
        >
            <option
                v-if="field.type === 'reference' && field.reference?.nullable"
                :selected="model === null || model === undefined || model === ''"
                value=""
            >{{ t('manageUi.field.noneOption') }}</option>
            <option
                v-for="option in options"
                :key="String(option.value)"
                :selected="String(option.value) === String(model ?? '')"
                :value="option.value"
            >{{ option.label }}</option>
        </select>

        <!-- One implementation, shared with the display-settings page. -->
        <!--
            TAGS: one text control, comma-separated, emitted as a string array
            on CHANGE rather than on input, so typing a comma does not split
            the value under the cursor. Trimmed and deduplicated here for the
            display; the server does the same at the write.
        -->
        <input
            v-else-if="field.type === 'tags'"
            :id="controlId"
            class="field_control"
            type="text"
            :value="tagsText"
            :placeholder="field.placeholder"
            @change="emitValue(parseTags(($event.target as HTMLInputElement).value))"
        >

        <ManageColorField
            v-else-if="field.type === 'color'"
            :model-value="(model as string) ?? null"
            @update:model-value="emitValue($event)"
        />

        <input
            v-else
            :id="controlId"
            class="field_control"
            :type="inputType"
            :value="inputValue"
            :placeholder="field.placeholder"
            :min="field.min"
            :max="field.max"
            @input="emitValue(($event.target as HTMLInputElement).value)"
        >

        <!--
            An empty reference select is a dead end unless it says why. Without
            this the user sees a select with nothing in it and no way to tell
            whether it failed to load or the entity genuinely has no rows.
        -->
        <p
            v-if="!readonly && field.type === 'reference' && !options.length"
            class="field_hint field_hint--warn"
        >{{ field.reference?.emptyHint ?? t('manageUi.shared.nothingToChoose') }}</p>

        <p
            v-if="error"
            class="field_error"
            role="alert"
        >{{ error }}</p>

        <p
            v-else-if="field.help"
            class="field_hint"
        >{{ field.help }}</p>

        <!-- A server-computed explanation of what leaving this blank means.
             Rendered BESIDE the help rather than replacing it: the help says
             the rule, this says what the rule currently evaluates to. -->
        <p
            v-if="note"
            class="field_derived"
        >{{ note }}</p>
    </div>
</template>

<script setup lang="ts">
import ManageColorField from '~/components/manage/ManageColorField.vue';
import type { EntityRow, FieldDef } from '~/utils/manageRegistry';
import { useT } from '~/composables/i18n';

/**
 * One field of a management form.
 *
 * The dispatcher for the registry's field types. Every generic entity's form is
 * a list of these, which is what stops five entities growing five slightly
 * different text inputs.
 */
const props = defineProps<{
    field: FieldDef;
    /** Rows for a `reference` field's select, keyed by resource upstream. */
    referenceRows?: EntityRow[];
    error?: string;
    readonly?: boolean;
    /** Server-computed line shown under the control; see FieldDef.derived. */
    note?: string;
}>();

const model = defineModel<unknown>();

const { t } = useT();

const controlId = useId();

const inputType = computed(() => {
    switch (props.field.type) {
        case 'email': return 'email';
        case 'number': return 'number';
        case 'date': return 'date';
        default: return 'text';
    }
});

const options = computed(() => {
    if (props.field.type === 'select') {
        return props.field.options ?? [];
    }

    const reference = props.field.reference;

    if (!reference) {
        return [];
    }

    return (props.referenceRows ?? []).map((row) => ({
        value: String(row.id),
        label: reference.label(row),
    }));
});

/** What the read-only view prints: resolved labels, not raw foreign keys. */
/**
 * A value this control can meaningfully render as text.
 *
 * ARRAYS AND OBJECTS ARE NOT, and saying so here is what closes a whole
 * category. `String([{…}])` is `"[object Object]"`, a string that renders
 * happily, passes every type check, and tells the reader nothing. It shipped
 * for real: `time_grid.breaks` is an array declared `type: 'text'`, and a
 * viewer's read-only page displayed exactly that under the label "Named
 * breaks".
 *
 * The field-specific cause is fixed where it belongs (the TimeGrid editor no
 * longer hands `breaks` to this component). This guard is the mechanism: no
 * future registry entry can produce `[object Object]` here, whatever it
 * declares, because a structured value now renders as "no value" instead of as
 * a lie about one.
 */
function isRenderablePrimitive(value: unknown): boolean {
    return value === null
        || value === undefined
        || typeof value === 'string'
        || typeof value === 'number'
        || typeof value === 'boolean';
}

/** `string[]` ⇄ "a, b, c". Empty input is an empty list, never `['']`. */
function parseTags(text: string): string[] {
    return [...new Set(text.split(',').map((tag) => tag.trim()).filter(Boolean))];
}

const tagsText = computed(() => (Array.isArray(model.value) ? (model.value as string[]).join(', ') : ''));

const staticText = computed(() => {
    if (props.field.type === 'tags') {
        return Array.isArray(model.value) && model.value.length ? (model.value as string[]).join(', ') : '-';
    }

    if (props.field.type === 'boolean') {
        return model.value ? t('manageUi.shared.yes') : t('manageUi.shared.no');
    }

    if (props.field.type === 'reference' || props.field.type === 'select') {
        const match = options.value.find((option) => String(option.value) === String(model.value));

        if (match) {
            return match.label;
        }

        /*
         * THE RAW VALUE, not a dash placeholder, when a value exists but cannot
         * be resolved to a label. Same rule as `ManageRelationPicker.labelFor`:
         * an unresolvable reference is something to see, not to hide.
         *
         * It matters most where the option list failed to load: `'-'` there
         * claims the field is EMPTY over a record that has a reference, which
         * is the "no data and fetch failed look identical" trap. An id is ugly
         * and true.
         */
        const value = model.value;

        return value === null || value === undefined || value === '' ? '-' : String(value);
    }

    const value = model.value;

    if (!isRenderablePrimitive(value)) {
        return '-';
    }

    return value === null || value === undefined || value === '' ? '-' : String(value);
});

/**
 * The editable twin of the guard above.
 *
 * An array bound to `<input type="text">` is worse than the read-only case: it
 * renders as an EMPTY box that looks editable, and one keystroke replaces the
 * whole structure with a string on the next save. Binding empty makes the
 * control inert-looking rather than destructive, and the field should not be
 * reaching this component at all, which is the other half of the fix.
 */
const inputValue = computed(() => (isRenderablePrimitive(model.value) ? (model.value ?? '') : ''));

function emitValue(value: unknown) {
    model.value = value;
}
</script>

<style scoped lang="scss">
.field {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);

    &_label {
        font-size: var(--font-size-sm);
        font-weight: 650;
        color: $content4;
    }

    &_required {
        margin-left: var(--space-1);
        color: $error500;
    }

    &_control {
        width: 100%;
        padding: 10px var(--space-5);
        border: 1px solid $surface4;
        border-radius: var(--radius-lg);

        font-family: inherit;
        font-size: var(--font-size-md);
        color: $content3;

        background: $surface0;

        transition: 0.15s;

        &--area {
            resize: vertical;
            min-height: 76px;
        }

        &:focus {
            border-color: $primary500;
            outline: none;
        }
    }

    &_color {
        display: flex;
        gap: var(--space-4);
        align-items: center;

        input[type='color'] {
            cursor: pointer;

            flex: none;

            width: 40px;
            height: 38px;
            padding: var(--space-1);
            border: 1px solid $surface4;
            border-radius: var(--radius-lg);

            background: $surface0;
        }
    }

    &_switch {
        cursor: pointer;

        display: flex;
        gap: var(--space-4);
        align-items: center;

        font-size: var(--font-size-md);
        color: $content4;

        input {
            width: 16px;
            height: 16px;
            accent-color: $primary500;
        }
    }

    &_static {
        margin: 0;
        padding: 10px 0;
        font-size: var(--font-size-md);
        color: $content3;
    }

    &_derived {
        margin: 0;
        font-size: var(--font-size-xs);
        color: var(--primary400, #8f70c6);
    }

    &_hint {
        margin: 0;
        font-size: var(--font-size-sm);
        color: $content7;

        &--warn { color: $warning700; }
    }

    &_error {
        margin: 0;
        font-size: var(--font-size-sm);
        font-weight: 600;
        color: $error700;
    }

    &--invalid &_control { border-color: $error500; }
}
</style>
