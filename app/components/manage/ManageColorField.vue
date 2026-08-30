<template>
    <div class="colorfield">
        <label
            v-if="label"
            class="colorfield_label"
            :for="controlId"
        >{{ label }}</label>

        <!--
            Swatch plus text, not a bare colour picker. The stored value is a CSS
            colour string the schedule reads directly, so it has to stay readable
            and CLEARABLE — a native picker cannot express "no colour", and every
            colour in this product is nullable because null means "inherit".
        -->
        <div class="colorfield_row">
            <input
                type="color"
                :value="model || FALLBACK_SWATCH"
                :aria-label="`${label || 'Colour'} picker`"
                :disabled="disabled"
                @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
            >
            <input
                :id="controlId"
                class="colorfield_text"
                type="text"
                :value="model ?? ''"
                :placeholder="FALLBACK_SWATCH"
                :disabled="disabled"
                @input="emit('update:modelValue', ($event.target as HTMLInputElement).value || null)"
            >
            <CommonButton
                v-if="model && !disabled"
                type="secondary"
                @click="emit('update:modelValue', null)"
            >Clear</CommonButton>
        </div>

        <p
            v-if="help"
            class="colorfield_help"
        >{{ help }}</p>
    </div>
</template>

<script setup lang="ts">
import CommonButton from '~/components/common/CommonButton.vue';
import { colorsList } from '~/utils/styles';

/**
 * One colour control, two callers.
 *
 * Extracted from `ManageField`'s `type: 'color'` branch rather than written a
 * second time for the display-settings page. The registry field and a standalone
 * form field are the same control with different plumbing, and a second copy is
 * how the two would end up disagreeing about what "clear" means.
 *
 * The picker's opening swatch is the BRAND colour, resolved from the palette.
 * It was the literal `#7c59bc` — the violet `colorsList` records as retired when
 * the brand went teal — so every colour a tenant had never set opened on a value
 * the design system no longer contains.
 */
const FALLBACK_SWATCH = colorsList.primary500;

const props = defineProps<{
    modelValue: string | null;
    label?: string;
    help?: string;
    disabled?: boolean;
}>();

const emit = defineEmits<{ 'update:modelValue': [value: string | null] }>();

const model = computed(() => props.modelValue);
const controlId = useId();
</script>

<style scoped lang="scss">
.colorfield {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);

    &_label {
        font-size: var(--font-size-sm);
        font-weight: 650;
        color: $content4;
    }

    &_row {
        display: flex;
        gap: var(--space-4);
        align-items: center;

        input[type='color'] {
            cursor: pointer;

            flex: none;

            width: 44px;
            height: 44px;
            padding: var(--space-1);
            border: 1px solid $surface5;
            border-radius: var(--radius-lg);

            background: $surface0;

            &:disabled {
                cursor: default;
                opacity: 0.5;
            }
        }
    }

    &_text {
        flex: 1 1 auto;

        min-height: 44px;
        padding: var(--space-3) var(--space-4);
        border: 1px solid $content7;
        border-radius: var(--radius-md);

        font-family: inherit;
        font-size: var(--font-size-md);
        font-variant-numeric: tabular-nums;
        color: $content2;

        background: $surface0;

        &:disabled { opacity: 0.5; }
    }

    &_help {
        font-size: var(--font-size-sm);
        color: $content6;
    }
}
</style>
