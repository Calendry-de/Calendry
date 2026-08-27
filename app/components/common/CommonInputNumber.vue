<template>
    <CommonInputText
        v-model="inputValue"
        v-model:focused="focused"
        :height
        :input-attrs
        input-type="number"
        :placeholder
        @change="$emit('change', $event)"
        @input="$emit('input', $event)"
    >
        <slot/>
        <template
            v-if="$slots.icon"
            #icon
        >
            <slot name="icon"/>
        </template>
    </CommonInputText>
</template>

<script setup lang="ts">
import type { InputHTMLAttributes, PropType, VNode } from 'vue';
import CommonInputText from '~/components/common/CommonInputText.vue';

defineProps({
    inputAttrs: {
        type: Object as PropType<InputHTMLAttributes>,
        default: () => {},
    },
    height: {
        type: String,
        default: undefined,
    },
    placeholder: {
        type: String,
        default: undefined,
    },
});

defineEmits<{
    input: [event: Event];
    change: [event: Event];
}>();

defineSlots<{ default?: () => string; icon?: () => VNode[] }>();

const focused = defineModel('focused', { type: Boolean });
const model = defineModel({ type: Number as PropType<null | number>, default: null });

const inputValue = computed({
    get: () => model.value === null ? '' : String(model.value),
    set: (value: string) => {
        model.value = value === '' ? null : Number(value);
    },
});
</script>
