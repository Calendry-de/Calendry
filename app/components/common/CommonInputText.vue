<template>
    <div
        class="input"
        :class="{ 'input--focused': focused }"
    >
        <!--
            A REAL <label for>, not a styled div.
            This was a `<div class="input_label">` sitting OUTSIDE the `<label>`
            that wraps the input, with no `for`, no `id` and no aria-label, so
            the visible text was not associated with the field at all and the
            accessible name fell back to the placeholder, or to nothing. Every
            form in the product was affected; it surfaced on the landing page
            because that form's two named fields are its only conversion path.
        -->
        <label
            v-if="$slots.default"
            class="input_label"
            :for="inputId"
        >
            <slot/>
        </label>
        <div
            class="input_container"
            :class="{ 'input_container--error': isLengthExceeded && inputLengthCheck }"
        >
            <!--
                A <div>, not a second <label>: the association now lives on the
                visible label above, and two labels for one control makes the
                accessible name order implementation-defined.
            -->
            <div class="input__input">
                <Icon
                    v-if="icon"
                    class="input__input_icon"
                    :name="icon"
                />
                <input
                    :id="inputId"
                    ref="inputRef"
                    v-bind="inputAttrs"
                    v-model="model"
                    :disabled="disabled"
                    :placeholder
                    :type="inputType"
                    @blur="focused = false"
                    @change="$emit('change', $event)"
                    @focus="focused = true"
                    @focusout="focused = false"
                    @input="$emit('input', $event)"
                >
            </div>
        </div>
        <div
            v-if="inputLengthCheck"
            class="input_counter"
            :class="{ 'input_counter--exceeded': isLengthExceeded }"
        >
            {{ currentLength }} / {{ maxInputLength }}
        </div>
    </div>
</template>

<script setup lang="ts">
import type { InputHTMLAttributes } from 'vue';
    const props = defineProps({
    inputAttrs: {
        type: Object as PropType<InputHTMLAttributes>,
        default: () => {},
    },
    inputType: {
        type: String,
        default: 'text',
    },
    height: {
        type: String,
        default: undefined,
    },
    placeholder: {
        type: String,
        default: undefined,
    },
    disabled: {
        type: Boolean,
    },
    icon: {
        type: String,
        default: undefined,
    },
    maxInputLength: {
        type: Number,
        default: 100,
    },
    inputLengthCheck: {
        type: Boolean,
        default: false,
    },
});

defineEmits<{
    input: [event: Event];
    change: [event: Event];
}>();

defineSlots<{ default?: () => string }>();

const focused = defineModel('focused', { type: Boolean });
const model = defineModel({ type: String, default: null });

const inputRef = ref<HTMLInputElement | null>(null);

/**
 * `useId()` rather than a random string: it is stable across server and client,
 * so the `for`/`id` pair survives hydration instead of mismatching.
 */
const inputId = useId();

const currentLength = computed(() => model.value?.length);
const isLengthExceeded = computed(() => (currentLength.value ?? 0) > props.maxInputLength);

defineExpose({
    input: inputRef,
});
</script>

<style scoped lang="scss">
.input {
    width: 100%;

    &_label {
        margin-bottom: 8px;
        font-size: var(--font-size-md);
        font-weight: 600;

        @include mobile {
            font-size: var(--font-size-xs);
        }
    }

    &_container {
        display: flex;
        gap: var(--space-6);
        align-items: center;

        width: 100%;
        height: v-bind(height);
        padding: 0 16px;
        border: 2px solid transparent;
        border-radius: var(--radius-lg);

        background: $surface2;

        transition: 0.3s;

        @include hover {
            &:hover {
                border-color: $surface5;
            }
        }
    }

    &--focused .input_container {
        border-color: $primary500
    }

    &_container--error {
        border-color: $error500 !important;
    }

    &__input {
        display: flex;
        gap: var(--space-5);
        align-items: center;
        width: 100%;

        input {
            width: 100%;
            padding: var(--space-5) 0;
            border: none;

            font-family: $defaultFont;
            font-size: var(--font-size-md);
            font-weight: 600;
            color:$content4;

            appearance: none;
            background: none;
            outline: none;
            box-shadow: none;

            @include mobile {
                font-size: var(--font-size-xs);
            }

            &::placeholder {
                color: varToRgba('content4', 0.5);
                opacity: 1
            }
        }
    }

    &_counter {
        margin-top: 4px;
        margin-bottom: 10px;

        font-size: var(--font-size-xs);
        color: $content7;
        text-align: right;

        &--exceeded {
            font-weight: 700;
            color: $error500;
        }
    }
}
</style>
