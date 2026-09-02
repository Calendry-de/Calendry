<template>
    <li class="cvgroup">
        <button
            :aria-expanded="open"
            class="cvgroup_head"
            type="button"
            @click="open = !open"
        >
            <span
                class="crow_dot"
                :class="group.row.isEnabled ? 'crow_dot--on' : 'crow_dot--off'"
                aria-hidden="true"
            />
            <span class="cvgroup_name">{{ group.type.label }}</span>
            <span class="cvgroup_count">
                {{ t('manageUi.constraintVariantGroup.count', { count: group.entries.length }) }}
            </span>
            <Icon
                aria-hidden="true"
                class="cvgroup_chevron"
                :name="open ? 'material-symbols:expand-less' : 'material-symbols:expand-more'"
            />
        </button>

        <p class="cvgroup_sub">
            {{ t('manageUi.constraintVariantGroup.sub', { label: group.type.label }) }}
        </p>

        <ul
            :aria-label="t('manageUi.shared.appliesTo')"
            class="cvgroup_chips"
        >
            <li
                v-for="entry in group.entries"
                :key="entry.row.id"
                class="cvgroup_chip"
            >{{ entry.row.name }}</li>
        </ul>

        <!--
            COLLAPSED BY DEFAULT: the whole point of grouping is to save the
            scroll a tenant would otherwise spend reading N identical panels.
            Expanding reveals the REAL rows, each independently editable:
            grouping is presentational only, so a toggle or weight change
            here still targets exactly one underlying Constraint row, and a
            row that diverges from the rest simply falls out of this group on
            the next render.
        -->
        <ul
            v-if="open"
            class="cgrid_rows cvgroup_rows"
        >
            <ManageConstraintRow
                v-for="entry in group.entries"
                :key="entry.row.id"
                :busy="busy.has(entry.row.id)"
                :can-read-kinds="canReadKinds"
                :can-update="canUpdate"
                :heading="entry.row.name"
                :kinds="kinds"
                :row="entry.row"
                :scope-required="true"
                :subtitle="t('manageUi.constraintVariantGroup.variantSubtitle', {
                    label: entry.type.label,
                })"
                :type="entry.type"
                @update:enabled="$emit('update:enabled', { row: entry.row, value: $event })"
                @update:param="$emit('update:param', { row: entry.row, key: $event.key, value: $event.value })"
                @update:scopes="$emit('update:scopes', { row: entry.row, kindIds: $event })"
                @update:weight="$emit('update:weight', { row: entry.row, value: $event })"
            >
                <template #actions>
                    <CommonButton
                        icon="material-symbols:edit-outline"
                        :to="`/manage/constraints/${entry.row.id}`"
                        type="transparent"
                    >{{ t('common.action.edit') }}</CommonButton>
                </template>
            </ManageConstraintRow>
        </ul>
    </li>
</template>

<script setup lang="ts">
import type { ConstraintVariantGroup } from '~/utils/constraintGrouping';
import type { ConstraintRowData } from '~/components/manage/ManageConstraintRow.vue';
import ManageConstraintRow from '~/components/manage/ManageConstraintRow.vue';
import { useT } from '~/composables/i18n';

/**
 * ONE collapsible entry for several variant rows that share a configuration
 * (issue #103): same type, severity, weight, params and enabled state,
 * narrowed to different Offerings/Groups/kinds. Presentational only: this
 * component fetches nothing and writes nothing, it just re-emits each inner
 * `ManageConstraintRow`'s event tagged with which underlying row it came
 * from, so `ManageConstraintGrid` can `PATCH` exactly that row, identical
 * to how an ungrouped variant is written today.
 *
 * `ManageConstraintGrid` renders this ONLY for a group of more than one
 * entry; a singleton group renders as a plain `ManageConstraintRow`, same as
 * before grouping existed.
 */
defineProps<{
    group: ConstraintVariantGroup;
    kinds: { id: string; name: string }[];
    canReadKinds: boolean;
    canUpdate: boolean;
    busy: Set<string>;
}>();

defineEmits<{
    'update:enabled': [{ row: ConstraintRowData; value: boolean }];
    'update:weight': [{ row: ConstraintRowData; value: string }];
    'update:param': [{ row: ConstraintRowData; key: string; value: unknown }];
    'update:scopes': [{ row: ConstraintRowData; kindIds: string[] }];
}>();

const { t } = useT();

/** Collapsed by default; see the template note above the expanded list. */
const open = ref(false);
</script>

<style scoped lang="scss">
.cvgroup {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);

    padding: var(--space-5) var(--space-6);
    border: 1px solid $surface3;
    border-radius: var(--radius-lg);

    background: $surface0;

    &_head {
        cursor: pointer;

        display: flex;
        flex-wrap: wrap;
        gap: var(--space-4);
        align-items: center;

        margin: 0;
        padding: 0;
        border: 0;

        font: inherit;
        text-align: left;

        background: none;
    }

    &_name {
        font-size: var(--font-size-md);
        font-weight: 650;
        color: $content3;
    }

    &_count {
        padding: var(--space-1) var(--space-4);
        border-radius: var(--radius-sm);

        font-size: var(--font-size-xs);
        font-weight: 650;
        letter-spacing: 0.03em;
        color: $primary700;

        background: varToRgba('primary500', 0.14);
    }

    &_chevron {
        width: 16px;
        height: 16px;
        margin-left: auto;
        color: $surface7;
    }

    &_sub {
        max-width: 74ch;
        margin: 0;

        font-size: var(--font-size-sm);
        line-height: 1.5;
        color: $content7;
    }

    &_chips {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-3);

        margin: 0;
        padding: 0;

        list-style: none;
    }

    &_chip {
        padding: var(--space-2) var(--space-5);
        border: 1px solid $surface4;
        border-radius: var(--radius-lg);

        font-size: var(--font-size-sm);
        color: $content5;

        background: $surface1;
    }

    &_rows {
        margin-top: var(--space-2);
        padding-top: var(--space-5);
        border-top: 1px solid $surface3;
    }
}

/* Shared with ManageConstraintRow's read state dot: same meaning, same look. */
.crow_dot {
    flex: none;

    width: 9px;
    height: 9px;
    border-radius: 50%;

    background: $surface5;

    &--on { background: $success500; }
}
</style>
