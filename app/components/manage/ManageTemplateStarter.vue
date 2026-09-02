<template>
    <section
        v-if="canRead && rows.length"
        class="tstart"
    >
        <label class="tstart_label">
            <span>Start from a template</span>
            <select
                v-model="chosenId"
                @change="apply"
            >
                <option value="">Blank: decide every field myself</option>
                <option
                    v-for="row in rows"
                    :key="String(row.id)"
                    :selected="chosenId === String(row.id)"
                    :value="String(row.id)"
                >{{ config.label(row) }}</option>
            </select>
        </label>

        <p class="tstart_hint">
            Copies the template's fields onto this draft once; editing the template
            afterward will not change what you create here.
        </p>
    </section>
</template>

<script setup lang="ts">
import type { EntityRow, ManageEntity } from '~/utils/manageRegistry';

/**
 * Issue #8: an optional "seed the draft from a saved shape" picker, shown
 * above a create form for any entity whose registry entry declares
 * `startFromTemplate`. Generic on purpose (see that field's own comment), so
 * this is not Offering-specific machinery even though Offering is its
 * only caller today.
 *
 * OWNERSHIP BOUNDARY: this component only ever calls `config.apply(row,
 * draft)` once, on selection. It does not track "applied" state, does not
 * write anything back to the template, and holds no opinion about what
 * `apply` does beyond "mutate the object it was given"; the copy-not-link
 * guarantee lives entirely in each entity's own `apply` function.
 */
const props = defineProps<{
    config: NonNullable<ManageEntity['startFromTemplate']>;
    /** The create form's own draft, mutated in place on selection. */
    draft: Record<string, unknown>;
}>();

const canRead = useHasPermission(props.config.readPermission);
const request = useRequestFetch();

const templates = useAsyncData(
    `template-starter:${props.config.resource}`,
    () => request<EntityRow[]>(`/api/${props.config.resource}`),
    // A failed or forbidden fetch degrades to "no templates offered" rather
    // than blocking the create form entirely: starting from nothing must
    // always still work.
    { default: () => [] as EntityRow[] },
);

await templates;

const rows = computed(() => templates.data.value ?? []);

const chosenId = ref('');

function apply() {
    const row = rows.value.find((candidate) => String(candidate.id) === chosenId.value);

    if (row) {
        props.config.apply(row, props.draft);
    }
}
</script>

<style scoped lang="scss">
.tstart {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);

    margin-bottom: var(--space-6);
    padding: var(--space-5);
    border: 1px dashed $surface4;
    border-radius: var(--radius-lg);

    background: $surface1;

    &_label {
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
        font-size: var(--font-size-xs);
        color: $content7;
    }
}
</style>
