<template>
    <div class="tree">
        <div class="tree_tools">
            <label class="tree_search">
                <Icon
                    name="material-symbols:search"
                    aria-hidden="true"
                />
                <input
                    v-model="search"
                    type="search"
                    :placeholder="t('manageUi.groupTree.searchPlaceholder')"
                    autocomplete="off"
                >
            </label>

            <span class="tree_count">{{
                list.isFiltered.value
                    ? t('manageUi.shared.countMatching', { count: list.total.value })
                    : t('manageUi.shared.countTotal', { count: list.total.value })
            }}</span>
        </div>

        <p
            v-if="list.error.value"
            class="tree_blank tree_blank--error"
            role="alert"
        >
            {{ t('manageUi.groupTree.loadFailed') }}
            {{
                serverErrorMessage(list.error.value)
                    ?? t('manageUi.shared.requestFailed')
            }}
        </p>

        <div
            v-else-if="list.pending.value && !list.rows.value.length"
            class="tree_loading"
        >
            <CommonLoader/>
        </div>

        <p
            v-else-if="!list.rows.value.length"
            class="tree_blank"
        >
            <template v-if="list.isFiltered.value">{{
                t('manageUi.groupTree.noMatch', { search })
            }}</template>
            <template v-else>{{ t('manageUi.groupTree.empty') }}</template>
        </p>

        <template v-else>
            <!--
                The tree is only shown when the full set is in hand. Built from a
                partial page it would silently promote children to roots, their
                parents simply absent, and there would be nothing on screen to
                say the hierarchy on display is wrong. Saying so and dropping to
                a flat list is the honest alternative.
            -->
            <p
                v-if="!showTree"
                class="tree_notice"
            >
                <Icon
                    name="material-symbols:info-outline"
                    aria-hidden="true"
                />
                <span v-if="list.isFiltered.value">
                    {{ t('manageUi.groupTree.flatFiltered') }}
                </span>
                <span v-else>
                    {{ t('manageUi.groupTree.flatPartial', {
                        shown: list.rows.value.length,
                        total: list.total.value,
                    }) }}
                </span>
            </p>

            <ul class="tree_list">
                <li
                    v-for="node in visibleNodes"
                    :key="node.id"
                    class="tree_node"
                    :style="{ '--depth': showTree ? node.depth : 0 }"
                >
                    <button
                        v-if="showTree && node.children.length"
                        class="tree_toggle"
                        type="button"
                        :aria-expanded="!collapsed.has(node.id)"
                        :aria-label="collapsed.has(node.id)
                            ? t('manageUi.groupTree.expand')
                            : t('manageUi.groupTree.collapse')"
                        @click="toggle(node.id)"
                    >
                        <Icon
                            :name="collapsed.has(node.id)
                                ? 'material-symbols:chevron-right'
                                : 'material-symbols:keyboard-arrow-down'"
                            aria-hidden="true"
                        />
                    </button>
                    <span
                        v-else-if="showTree"
                        class="tree_toggle tree_toggle--leaf"
                        aria-hidden="true"
                    />

                    <NuxtLink
                        class="tree_link"
                        :to="`/manage/groups/${node.id}`"
                    >
                        <span class="tree_name">{{ node.row.name }}</span>
                        <span
                            v-if="node.children.length"
                            class="tree_meta"
                        >{{ t('manageUi.groupTree.nestedCount', { count: node.children.length }) }}</span>
                        <span
                            v-if="node.row.expectedSize"
                            class="tree_meta"
                        >{{ t('manageUi.groupTree.sizeApprox', { count: node.row.expectedSize }) }}</span>
                        <span
                            v-else-if="showTree && derivedSizes.get(node.id)"
                            class="tree_meta"
                        >{{ t('manageUi.groupTree.sizeDerived', { count: derivedSizes.get(node.id) }) }}</span>
                    </NuxtLink>
                </li>
            </ul>
        </template>

        <nav
            v-if="list.pageCount.value > 1"
            class="tree_pager"
            :aria-label="t('manageUi.shared.pagerLabel')"
        >
            <CommonButton
                :disabled="page === 0"
                type="secondary"
                @click="page = Math.max(0, page - 1)"
            >{{ t('common.action.previous') }}</CommonButton>
            <span>{{ t('manageUi.shared.pageOf', { page: page + 1, total: list.pageCount.value }) }}</span>
            <CommonButton
                :disabled="page + 1 >= list.pageCount.value"
                type="secondary"
                @click="page = Math.min(list.pageCount.value - 1, page + 1)"
            >{{ t('common.action.next') }}</CommonButton>
        </nav>
    </div>
</template>

<script setup lang="ts">
import type { useEntityList } from '~/composables/entityList';
import type { ManageEntity } from '~/utils/manageRegistry';
import { useT } from '~/composables/i18n';
import { buildGroupTree, estimatedSizes, flattenTree } from '~/utils/groupTree';

/**
 * Groups as a hierarchy, because a flat table of nested things loses the only
 * property that distinguishes them (TAXONOMY.md §2, §6).
 *
 * This is the ONE entity with a bespoke list. Everything else about the page
 * (shell, header, permissions, create affordance) is still the shared scaffold;
 * only the rows in the middle are different.
 */
const props = defineProps<{
    entity: ManageEntity;
    list: ReturnType<typeof useEntityList>;
    canCreate: boolean;
}>();

const { t } = useT();

const search = defineModel<string>('search', { required: true });
const page = defineModel<number>('page', { required: true });

const collapsed = ref(new Set<string>());

/**
 * Two conditions, both required. A filtered set is incomplete by construction
 * even when the page holds every matching row, because a match's parent may not
 * itself match.
 */
const showTree = computed(() => props.list.isComplete.value && !props.list.isFiltered.value);

/**
 * Only meaningful alongside `showTree`: summing nested groups needs the whole
 * set in hand, the same requirement `buildGroupTree` has for the hierarchy
 * itself. Read as `derivedSizes.get(node.id)`, never for a node whose own
 * `expectedSize` is already set, which always wins.
 */
const derivedSizes = computed(() => estimatedSizes(props.list.rows.value));

const visibleNodes = computed(() => {
    if (!showTree.value) {
        return props.list.rows.value.map((row) => ({
            id: String(row.id),
            row,
            depth: 0,
            parentId: null,
            children: [],
        }));
    }

    return flattenTree(buildGroupTree(props.list.rows.value), collapsed.value);
});

function toggle(id: string) {
    // Replaced rather than mutated: a Set mutated in place is not a reactive
    // change, and the tree would keep rendering its previous shape.
    const next = new Set(collapsed.value);

    if (next.has(id)) next.delete(id);
    else next.add(id);

    collapsed.value = next;
}
</script>

<style scoped lang="scss">
.tree {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);

    &_tools {
        display: flex;
        gap: var(--space-5);
        align-items: center;
        justify-content: space-between;
    }

    &_search {
        display: flex;
        gap: var(--space-4);
        align-items: center;

        width: 100%;
        max-width: 320px;
        padding: var(--space-3) var(--space-5);
        border: 1px solid $surface4;
        border-radius: var(--radius-lg);

        background: $surface0;

        svg {
            flex: none;
            width: 16px;
            height: 16px;
            color: $surface7;
        }

        input {
            width: 100%;
            border: 0;

            font-family: inherit;
            font-size: var(--font-size-md);
            color: $content3;

            background: none;
            outline: none;
        }

        &:focus-within { border-color: $primary500; }
    }

    &_count {
        flex: none;
        font-size: var(--font-size-sm);
        font-variant-numeric: tabular-nums;
        color: $content7;
    }

    &_notice {
        display: flex;
        gap: var(--space-4);
        align-items: flex-start;

        margin: 0;
        padding: var(--space-4) var(--space-5);
        border-radius: var(--radius-lg);

        font-size: var(--font-size-sm);
        line-height: 1.5;
        color: $content5;

        background: $surface3;

        svg {
            flex: none;
            width: 16px;
            height: 16px;
        }
    }

    &_list {
        overflow: hidden;

        margin: 0;
        padding: var(--space-3);
        border-radius: var(--radius-xl);

        list-style: none;

        background: $surface1;
    }

    &_node {
        display: flex;
        gap: var(--space-2);
        align-items: center;

        // Indent guides the eye without a rendering a rule per level.
        padding-left: calc(var(--depth) * var(--space-7));
    }

    &_toggle {
        cursor: pointer;

        display: flex;
        flex: none;
        align-items: center;
        justify-content: center;

        width: 22px;
        height: 22px;
        border: 0;
        border-radius: var(--radius-sm);

        color: $surface7;

        background: none;

        svg {
            width: 18px;
            height: 18px;
        }

        &--leaf { cursor: default; }

        @include hover() {
            &:hover:not(&--leaf) {
                color: $content3;
                background: $surface3;
            }
        }
    }

    &_link {
        display: flex;
        flex: 1;
        gap: var(--space-5);
        align-items: baseline;

        min-width: 0;
        padding: var(--space-4) var(--space-5);
        border-radius: var(--radius-lg);

        text-decoration: none;

        @include hover() {
            &:hover { background: $surface2; }
        }

        &:focus-visible {
            outline: 2px solid $primary600;
            outline-offset: -2px;
        }
    }

    &_name {
        font-size: var(--font-size-md);
        font-weight: 600;
        color: $content3;
    }

    &_meta {
        font-size: var(--font-size-sm);
        color: $content7;
    }

    &_blank {
        margin: 0;
        padding: var(--space-8) var(--space-7);
        border-radius: var(--radius-xl);

        font-size: var(--font-size-md);
        color: $content7;

        background: $surface1;

        &--error {
            font-weight: 600;
            color: $error700;
            background: varToRgba('error500', 0.12);
        }
    }

    &_loading {
        display: flex;
        justify-content: center;
        padding: 60px 0; // Empty-state spacing, hand-tuned, not on the scale.
    }

    &_pager {
        display: flex;
        gap: var(--space-5);
        align-items: center;
        justify-content: center;

        font-size: var(--font-size-sm);
        color: $content7;
    }
}
</style>
