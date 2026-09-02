<template>
    <fieldset class="features">
        <legend v-if="label">{{ label }}</legend>

        <!--
            EMPTY IS ITS OWN STATE, and it is not "no preference".
            A tenant that has defined no equipment cannot express a room-type
            preference at all, which renders identically to a person who simply
            has none unless it is said out loud: the "no data and fetch failed
            look the same" failure, in its quietest form.
        -->
        <p
            v-if="!options.length"
            class="features_empty"
        >{{ emptyHint }}</p>

        <template v-else>
            <label
                v-for="option in options"
                :key="option.id"
                class="features_tag"
                :class="{ 'features_tag--on': selected.includes(option.id) }"
            >
                <input
                    :checked="selected.includes(option.id)"
                    :disabled="readonly"
                    type="checkbox"
                    @change="toggle(option.id)"
                >
                <span>{{ option.name || option.key }}</span>
            </label>
        </template>

        <p
            v-if="error"
            class="features_error"
            role="alert"
        >{{ error }}</p>

        <p
            v-else-if="help"
            class="features_help"
        >{{ help }}</p>
    </fieldset>
</template>

<script setup lang="ts">
/**
 * Which room types a Person would rather teach in: the third axis of a
 * preference, beside days and blocks.
 *
 * THE VALUE IS EQUIPMENT IDS, not feature keys. Ids are how this app references
 * an entity everywhere else, and the assembly resolves them to `equipment.key`
 * at the wire, which is the vocabulary `Room.feature_tags` speaks. A picker
 * holding keys would be the one place equipment is referenced by name, and a
 * renamed key would silently void every selection.
 *
 * The option list is PASSED IN rather than fetched here. Both pages that use
 * this are gated on an availability permission, which does not imply
 * `equipment.read`, so the options travel with each page's own payload, and a
 * component fetching them itself would reintroduce exactly the cross-permission
 * dependency that blanks a page with no error.
 */
export interface RoomFeatureOption {
    id: string;
    key: string;
    name: string;
}

withDefaults(defineProps<{
    options: RoomFeatureOption[];
    label?: string;
    help?: string;
    error?: string;
    readonly?: boolean;
    emptyHint?: string;
}>(), {
    label: undefined,
    help: undefined,
    error: undefined,
    readonly: false,
    emptyHint: 'This institution has not defined any equipment yet, so there are no room types to choose between.',
});

const selected = defineModel<string[]>({ required: true });

function toggle(id: string) {
    const next = new Set(selected.value ?? []);

    if (next.has(id)) next.delete(id);
    else next.add(id);

    // Sorted, like the weekday picker: an unsorted array makes dirty-tracking
    // depend on click order, and the assembly sorts again before hashing.
    selected.value = [...next].sort();
}
</script>

<style scoped lang="scss">
.features {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);

    margin: 0;
    padding: 0;
    border: 0;

    legend {
        padding: 0 0 var(--space-3);
        font-size: var(--font-size-sm);
        font-weight: 650;
        color: $content4;
    }

    &_tag {
        cursor: pointer;

        display: flex;
        gap: var(--space-3);
        align-items: center;

        padding: var(--space-3) var(--space-5);
        border: 1px solid $surface4;
        border-radius: var(--radius-lg);

        font-size: var(--font-size-sm);
        font-weight: 600;
        color: $content5;

        transition: 0.12s;

        input { accent-color: $primary500; }

        &--on {
            border-color: $primary500;
            color: $primary700;
            background: varToRgba('primary500', 0.12);
        }
    }

    &_empty,
    &_error,
    &_help {
        flex-basis: 100%;
        margin: var(--space-2) 0 0;
        font-size: var(--font-size-sm);
    }

    &_empty {
        margin: 0;
        line-height: 1.5;
        color: $content7;
    }

    &_error {
        font-weight: 600;
        color: $error700;
    }

    &_help {
        line-height: 1.5;
        color: $content7;
    }
}
</style>
