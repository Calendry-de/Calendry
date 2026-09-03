<template>
    <!--
        ONE FILTER DIMENSION, MANY VALUES. A checkbox list rather than a
        `<select multiple>`: the native listbox shows a selection only as
        highlighted rows, and a plain click on any row silently clears every
        other one, which is exactly the mistake a filter for "these three
        rooms" invites. Here every row is a checkbox, so adding a fourth can
        never lose the first three.

        The chosen values are ALSO drawn as removable chips above the list,
        because with seventy people the selected rows can be anywhere in a
        scrolled list, and a filter whose current value cannot be seen in one
        glance is a filter the reader has to trust rather than read.
    -->
    <fieldset class="mpick">
        <legend class="mpick_legend">
            <span class="mpick_label">{{ label }}</span>
            <button
                v-if="model.length"
                type="button"
                class="mpick_clear"
                @click="model = []"
            >{{ t('schedule.filters.clear') }}</button>
        </legend>

        <ul
            v-if="model.length"
            class="mpick_chips"
            :aria-label="t('schedule.filters.selected', { count: model.length }, model.length)"
        >
            <li
                v-for="id in model"
                :key="id"
            >
                <button
                    type="button"
                    class="mpick_chip"
                    :aria-label="t('schedule.filters.remove', { name: nameOf(id) })"
                    @click="toggle(id, false)"
                >
                    <span>{{ nameOf(id) }}</span>
                    <Icon
                        name="material-symbols:close"
                        aria-hidden="true"
                    />
                </button>
            </li>
        </ul>

        <!--
            Search only where a list is long enough to need it. Seven rows are
            read faster than they are typed for; a search box over them would
            be chrome. The threshold is about the LIST, so it lives here.
        -->
        <input
            v-if="options.length > SEARCH_FROM"
            v-model="needle"
            type="search"
            class="mpick_search"
            :placeholder="t('schedule.filters.search')"
            :aria-label="t('schedule.filters.searchIn', { label })"
        >

        <ul
            class="mpick_list"
            :class="{ 'mpick_list--scroll': options.length > SEARCH_FROM }"
        >
            <li
                v-for="option in visible"
                :key="option.id"
            >
                <label class="mpick_option">
                    <input
                        type="checkbox"
                        :checked="selected.has(option.id)"
                        @change="toggle(option.id, ($event.target as HTMLInputElement).checked)"
                    >
                    <span>{{ option.name }}</span>
                </label>
            </li>
        </ul>

        <!-- Said, not blank: an empty list under a search box otherwise reads
             as "nothing exists" rather than "nothing matched". -->
        <p
            v-if="!visible.length"
            class="mpick_none"
        >{{ t('schedule.filters.noMatches') }}</p>
    </fieldset>
</template>

<script setup lang="ts">
import type { NamedRow } from '~/composables/schedule';
import { useT } from '~/composables/i18n';

const SEARCH_FROM = 7;

const props = defineProps<{
    label: string;
    options: NamedRow[];
}>();

const model = defineModel<string[]>({ required: true });

const { t } = useT();

const needle = ref('');

const selected = computed(() => new Set(model.value));

const visible = computed(() => {
    const query = needle.value.trim().toLocaleLowerCase();

    return query
        ? props.options.filter((option) => option.name.toLocaleLowerCase().includes(query))
        : props.options;
});

/**
 * The id itself when the option list does not know it: a stale link can name
 * a room that has since gone, and the page's own reconciliation drops it a
 * tick later. Showing the id for that tick beats showing an empty chip.
 */
function nameOf(id: string): string {
    return props.options.find((option) => option.id === id)?.name ?? id;
}

function toggle(id: string, on: boolean) {
    const next = model.value.filter((value) => value !== id);

    model.value = on ? [...next, id] : next;
}
</script>

<style scoped lang="scss">
.mpick {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);

    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;

    &_legend {
        display: flex;
        gap: var(--space-4);
        align-items: baseline;
        justify-content: space-between;

        width: 100%;
        margin-bottom: var(--space-2);
        padding: 0;
    }

    &_label {
        font-size: var(--font-size-xs);
        font-weight: 600;
        color: $content7;
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }

    &_clear {
        cursor: pointer;

        margin: 0;
        padding: 0;
        border: 0;

        font-family: inherit;
        font-size: var(--font-size-xs);
        color: $content6;
        text-decoration: underline;

        background: none;

        @include hover() {
            &:hover { color: $content3; }
        }

        &:focus-visible {
            outline: 2px solid $primary600;
            outline-offset: 2px;
        }
    }

    &_chips {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-2);

        margin: 0;
        padding: 0;

        list-style: none;
    }

    /*
     * A CHOSEN VALUE, in the chip material (`$surface3` on `$surface1`) at the
     * chip radius: the same object the grid draws a session as, one size
     * down, so "selected" reads as a thing rather than as a coloured pill.
     * The whole chip is the remove button; the × says so.
     */
    &_chip {
        cursor: pointer;

        display: flex;
        gap: var(--space-2);
        align-items: center;

        max-width: 100%;
        min-height: 28px;
        padding: var(--space-1) var(--space-2) var(--space-1) var(--space-4);
        border: 1px solid $surface5;
        border-radius: var(--radius-md);

        font-family: inherit;
        font-size: var(--font-size-sm);
        color: $content3;

        background: $surface3;

        transition: background 140ms cubic-bezier(0.16, 1, 0.3, 1);

        span {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        svg {
            flex: none;
            width: 14px;
            height: 14px;
            color: $content6;
        }

        @include hover() {
            &:hover {
                background: $surface4;

                svg { color: $content2; }
            }
        }

        &:focus-visible {
            outline: 2px solid $primary600;
            outline-offset: 1px;
        }
    }

    &_search {
        width: 100%;
        min-height: 36px;
        padding: var(--space-3) var(--space-4);
        border: 1px solid $surface5;
        border-radius: var(--radius-md);

        font-family: inherit;
        font-size: var(--font-size-sm);
        color: $content4;

        background: $surface0;

        &::placeholder { color: $content7; }

        /* The field's own border is the whole indicator (DESIGN.md, Inputs). */
        &:focus-visible {
            border-color: $primary500;
            outline: none;
        }
    }

    &_list {
        display: flex;
        flex-direction: column;

        margin: 0;
        padding: 0;

        list-style: none;

        /*
         * Bounded and scrolling only for the long lists, the ones that also
         * got a search box. A short list stays whole: a scrollbar on five
         * rows would hide the fifth for nothing.
         */
        &--scroll {
            scrollbar-width: thin;

            overflow-y: auto;

            max-height: 232px;
            padding: var(--space-1);
            border: 1px solid $surface5;
            border-radius: var(--radius-md);

            background: $surface0;
        }
    }

    &_option {
        cursor: pointer;

        display: flex;
        gap: var(--space-4);
        align-items: center;

        min-height: 32px;
        padding: var(--space-2) var(--space-3);
        border-radius: var(--radius-sm);

        font-size: var(--font-size-sm);
        color: $content5;

        transition: background 140ms cubic-bezier(0.16, 1, 0.3, 1);

        input {
            flex: none;

            width: 16px;
            height: 16px;
            margin: 0;

            accent-color: $primary500;
        }

        span {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        @include hover() {
            &:hover { background: $surface2; }
        }

        &:has(input:checked) {
            color: $content2;
        }

        &:has(input:focus-visible) {
            outline: 2px solid $primary600;
            outline-offset: -2px;
        }

        // Thumb-reached below 700px, where the drawer is the whole screen.
        @include mobileOnly() { min-height: 44px; }
    }

    &_none {
        margin: 0;
        padding: var(--space-3) var(--space-3);
        font-size: var(--font-size-sm);
        color: $content7;
    }
}
</style>
