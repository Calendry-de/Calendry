<template>
    <div class="picker">
        <header class="picker_head">
            <h2>{{ def.label }}</h2>
            <span
                v-if="busy"
                class="picker_state"
            >{{ t('common.action.saving') }}</span>
            <span
                v-else-if="saved"
                class="picker_state picker_state--ok"
            >
                <Icon
                    name="material-symbols:check-small"
                    aria-hidden="true"
                />
                {{ t('manageUi.picker.saved') }}
            </span>
        </header>

        <p
            v-if="def.help"
            class="picker_help"
        >{{ def.help }}</p>

        <p
            v-if="error"
            class="picker_error"
            role="alert"
        >{{ error }}</p>

        <!--
            Advisory, and visually distinct from `picker_error` on purpose. An
            error means the write did NOT land; these mean it did, and here is
            what it implies. Rendered alongside rather than instead of the error,
            because they are answers to different questions, though in practice
            a failed write produces no warnings, since the hook runs after a
            successful replacement.

            `role="status"` rather than `alert`: assistive tech should announce
            it politely, not interrupt. Nothing is wrong.
        -->
        <p
            v-for="note in warnings ?? []"
            :key="note"
            class="picker_warning"
            role="status"
        >{{ note }}</p>

        <ul
            v-if="rows.length"
            class="picker_rows"
        >
            <li
                v-for="row in rows"
                :key="String(row[def.valueKey])"
                class="picker_row"
            >
                <span class="picker_row-name">{{ labelFor(String(row[def.valueKey])) }}</span>

                <label
                    v-if="def.extraReference"
                    class="picker_row-extra"
                >
                    <span class="sr-only">{{
                        t('manageUi.picker.extraRoleLabel', { label: def.label })
                    }}</span>
                    <select
                        :disabled="readonly || busy"
                        :value="(row[def.extraReference.key] as string) ?? ''"
                        @change="$emit('set-extra', {
                            value: String(row[def.valueKey]),
                            key: def.extraReference!.key,
                            extra: ($event.target as HTMLSelectElement).value || null,
                        })"
                    >
                        <!-- `:selected` so the assigned role survives SSR; see ManageField. -->
                        <option
                            :selected="!row[def.extraReference.key]"
                            value=""
                        >{{ def.extraReference.placeholder }}</option>
                        <option
                            v-for="option in extraOptions"
                            :key="String(option.id)"
                            :selected="String(option.id) === String(row[def.extraReference.key] ?? '')"
                            :value="String(option.id)"
                        >{{ def.extraReference.label(option) }}</option>
                    </select>
                </label>

                <label
                    v-if="def.quantity"
                    class="picker_row-extra"
                >
                    <span class="picker_row-qty-label">{{ def.quantity.label }}</span>
                    <input
                        class="picker_row-qty"
                        :disabled="readonly || busy"
                        min="1"
                        type="number"
                        :value="(row[def.quantity.key] as number) ?? ''"
                        @change="$emit('set-extra', {
                            value: String(row[def.valueKey]),
                            key: def.quantity!.key,
                            extra: ($event.target as HTMLInputElement).value
                                ? Number(($event.target as HTMLInputElement).value)
                                : null,
                        })"
                    >
                </label>

                <button
                    v-if="!readonly"
                    class="picker_remove"
                    :disabled="busy"
                    type="button"
                    :aria-label="t('manageUi.shared.removeAria', {
                        label: labelFor(String(row[def.valueKey])),
                    })"
                    @click="$emit('remove', String(row[def.valueKey]))"
                >
                    <Icon
                        name="material-symbols:close"
                        aria-hidden="true"
                    />
                </button>
            </li>
        </ul>

        <!--
            NOTHING ASSIGNED. Two renderings, because an empty set is not always
            the same fact: for most relations it is unremarkable, and for
            `access-roles` it means this person can sign in and be shown nothing.
            A relation says which by declaring `emptyWarning`, and when it does,
            the advisory REPLACES "None assigned." rather than joining it, since
            the warning already states the emptiness and two lines saying it is
            empty reads like two separate problems.

            `role="status"`, matching the warnings above: politely announced,
            nothing is broken. Deliberately shown in read-only mode too: a
            viewer who cannot fix it is still better off knowing.
        -->
        <p
            v-else-if="def.emptyWarning"
            class="picker_warning"
            role="status"
        >{{ def.emptyWarning }}</p>

        <p
            v-else
            class="picker_empty"
        >{{ t('manageUi.picker.noneAssigned') }}</p>

        <!--
            SEARCH, for a resource that can hold thousands of rows. The list is
            never fetched whole here, so there is nothing to scroll and nothing
            to filter client-side: every keystroke asks the server.
        -->
        <div
            v-if="!readonly && def.searchable"
            class="picker_search"
        >
            <label class="picker_search-field">
                <span class="sr-only">{{ t('manageUi.picker.searchLabel', { label: def.label }) }}</span>
                <Icon
                    class="picker_search-icon"
                    name="material-symbols:search"
                    aria-hidden="true"
                />
                <input
                    ref="searchInput"
                    v-model="term"
                    aria-autocomplete="list"
                    :aria-controls="`${listId}`"
                    :aria-expanded="showResults"
                    autocomplete="off"
                    :disabled="busy"
                    :placeholder="t('manageUi.picker.searchPlaceholder', { label: def.label })"
                    role="combobox"
                    type="text"
                    @keydown.down.prevent="moveActive(1)"
                    @keydown.up.prevent="moveActive(-1)"
                    @keydown.enter.prevent="addActive()"
                    @keydown.esc.prevent="term = ''"
                >
                <button
                    v-if="term"
                    class="picker_search-clear"
                    type="button"
                    :aria-label="t('manageUi.picker.clearSearch')"
                    @click="clearSearch"
                >
                    <Icon
                        name="material-symbols:close"
                        aria-hidden="true"
                    />
                </button>
            </label>

            <!--
                Every state named. A search box that renders nothing when it
                found nothing is the "no data vs. fetch failed" ambiguity in
                miniature: the user cannot tell a spelling mistake from a
                broken request, and neither can a test.
            -->
            <p
                v-if="searchError"
                class="picker_error"
                role="alert"
            >{{ searchError }}</p>
            <p
                v-else-if="!term.trim()"
                class="picker_hint"
            >{{ t('manageUi.picker.searchHint') }} <template
                v-if="rows.length"
            >{{ t('manageUi.picker.searchHintAssigned') }}</template></p>
            <p
                v-else-if="searching"
                class="picker_hint"
            >{{ t('manageUi.picker.searching') }}</p>
            <p
                v-else-if="!results.length"
                class="picker_hint"
            >{{ t('manageUi.picker.noMatches', { term: term.trim() }) }}</p>

            <ul
                v-else
                :id="listId"
                class="picker_results"
                role="listbox"
            >
                <li
                    v-for="(option, index) in results"
                    :key="option.value"
                    role="option"
                    :aria-selected="index === activeIndex"
                >
                    <button
                        class="picker_result"
                        :class="{ 'picker_result--active': index === activeIndex }"
                        :disabled="busy || option.taken"
                        type="button"
                        @click="emit('add', option.value)"
                        @mousemove="activeIndex = index"
                    >
                        <span>{{ option.label }}</span>
                        <span
                            v-if="option.taken"
                            class="picker_result-taken"
                        >{{ t('manageUi.picker.alreadyAdded') }}</span>
                    </button>
                </li>
            </ul>

            <!--
                The count is the honest part: a page of 20 out of 143 matches
                looks identical to all 20 matches without it, and the difference
                decides whether refining the search is worth doing.
            -->
            <p
                v-if="results.length && total > results.length"
                class="picker_hint"
            >{{ t('manageUi.picker.showingCount', { shown: results.length, total }) }}</p>
        </div>

        <label
            v-else-if="!readonly"
            class="picker_add"
        >
            <span class="sr-only">{{ t('manageUi.picker.addToLabel', { label: def.label }) }}</span>
            <select
                :disabled="busy || !available.length"
                :value="''"
                @change="onAdd($event)"
            >
                <option value="">{{
                    available.length
                        ? t('manageUi.picker.addOption', { label: def.label })
                        : t('manageUi.shared.nothingLeft')
                }}</option>
                <option
                    v-for="option in available"
                    :key="option.value"
                    :value="option.value"
                >{{ option.label }}</option>
            </select>
        </label>

        <!--
            An empty option list has two very different causes (the referenced
            entity has no rows at all, or everything is already assigned), and a
            select that is merely empty cannot tell them apart.

            NOT shown in search mode, where `options` carries only the assigned
            rows by design: empty is the ordinary state of an entity with
            nothing assigned yet, and calling it "nothing to choose from" would
            assert the tenant has no people at all.
        -->
        <p
            v-if="!readonly && !def.searchable && !options.length"
            class="picker_hint picker_hint--warn"
        >{{ def.emptyHint ?? t('manageUi.shared.nothingToChoose') }}</p>
    </div>
</template>

<script setup lang="ts">
import type { EntityRow, RelationDef } from '~/utils/manageRegistry';
import type { RelationRow } from '~/composables/entityRelations';
import { indentedOptions } from '~/utils/groupTree';
import { useT } from '~/composables/i18n';

/**
 * One relation, edited as a set.
 *
 * Every change is persisted immediately by the parent composable rather than
 * being staged for a Save button. See `useEntityRelations` for why. The
 * Saving/Saved state next to the heading is what makes that visible instead of
 * magical.
 */
const props = defineProps<{
    def: RelationDef;
    rows: RelationRow[];
    /**
     * WHAT THIS HOLDS DEPENDS ON `def.searchable`, and the two meanings are not
     * interchangeable:
     *
     *   not searchable  →  every row that may be chosen. Also supplies labels.
     *   searchable      →  ONLY the rows already assigned, to label them.
     *                      Candidates come from the server, per keystroke.
     *
     * One prop, because both cases answer the same question ("which rows can
     * this component name?"), and a searchable picker that also received a full
     * candidate list would be fetching the very list search exists to avoid.
     */
    options: EntityRow[];
    extraOptions: EntityRow[];
    busy?: boolean;
    saved?: boolean;
    error?: string;
    /** Advisory notes about what the SAVED set implies. Never a failure. */
    warnings?: string[];
    readonly?: boolean;
    /**
     * Extra query parameters for the search request: the searchable
     * equivalent of `def.scopeBy`, which the parent resolves against the row
     * being edited and this component has no way to evaluate itself.
     *
     * Omitted means an unscoped search. That is correct for `persons` and wrong
     * the moment a scoped relation becomes searchable, so `scopeBy` is resolved
     * into this by `useEntityRelations` rather than left to each call site.
     */
    searchParams?: Record<string, string>;
}>();

const { t } = useT();

const emit = defineEmits<{
    add: [value: string];
    remove: [value: string];
    'set-extra': [payload: { value: string; key: string; extra: unknown }];
}>();

/** Nesting stays visible in the flat select, so picking a cohort is not a guess. */
const allOptions = computed(() => (props.def.indentTree
    ? indentedOptions(props.options)
    : props.options.map((row) => ({ value: String(row.id), label: props.def.optionLabel(row) }))));

const available = computed(() => {
    const taken = new Set(props.rows.map((row) => String(row[props.def.valueKey])));

    return allOptions.value.filter((option) => !taken.has(option.value));
});

/**
 * Labels for rows this component has seen only in a search result.
 *
 * WHY A CACHE IS NOT OPTIONAL HERE. In search mode `options` holds the rows
 * assigned when the page loaded, and the parent does not refetch it on every
 * add. So a person just picked out of a search is in `rows` (rendered
 * immediately, optimistically) while being absent from `options`. Without this
 * they would appear as a raw cuid the instant they were added, which reads as
 * data loss rather than as a missing label.
 *
 * Grows only with what the user actually looked at, and dies with the
 * component. It is never consulted before `options`, so it cannot make a stale
 * name outlive a rename.
 */
const seen = ref(new Map<string, string>());

function remember(rows: EntityRow[]) {
    for (const row of rows) {
        seen.value.set(String(row.id), props.def.optionLabel(row));
    }
}

function labelFor(value: string): string {
    const row = props.options.find((option) => String(option.id) === value);

    if (row) {
        return props.def.optionLabel(row);
    }

    // Falling back to the raw id rather than an empty cell: an unresolvable
    // reference is something to see, not to hide.
    return seen.value.get(value) ?? value;
}

/**
 * The select is an action, not a value: choosing an option adds a row, then the
 * control resets to its placeholder. Leaving the choice selected would show the
 * last thing added as though it were the field's current value, which is not
 * what a set membership control means.
 */
function onAdd(event: Event) {
    const select = event.target as HTMLSelectElement;
    const value = select.value;

    select.value = '';

    if (value) {
        emit('add', value);
    }
}

/* ---------------------------------------------------------------- search --
 *
 * Only live when `def.searchable`. Everything below is inert otherwise: `term`
 * never changes, so the watcher never fires and no request is ever made.
 */

const request = useRequestFetch();

/**
 * A page, not the answer. The point of searching is that the full list is too
 * large to hold, so the result set has to be bounded too, and being bounded is
 * stated in the UI rather than hidden, because "20 matches" and "the first 20
 * of 143" call for different next actions from the user.
 */
const SEARCH_LIMIT = 20;
const DEBOUNCE_MS = 250;

const term = ref('');
const searching = ref(false);
const searchError = ref('');
const matches = ref<EntityRow[]>([]);
const total = ref(0);
const activeIndex = ref(0);
const searchInput = useTemplateRef<HTMLInputElement>('searchInput');
const listId = computed(() => `picker-results-${props.def.key}`);

const results = computed(() => {
    const taken = new Set(props.rows.map((row) => String(row[props.def.valueKey])));

    /**
     * Matches are shown even when already assigned, flagged rather than
     * filtered out. Silently dropping them makes a search for someone who IS
     * assigned answer "no matches", which reads as "this person does not
     * exist": the opposite of the truth, and the single most confusing thing a
     * picker can say.
     */
    return matches.value.map((row) => ({
        value: String(row.id),
        label: props.def.optionLabel(row),
        taken: taken.has(String(row.id)),
    }));
});

const showResults = computed(() => results.value.length > 0);

/**
 * Guards against a slow earlier response landing after a faster later one.
 * Typing "ma" then "mar" issues two requests, and without this the "ma" results
 * can arrive second and be shown under the word "mar": stale data that looks
 * exactly like correct data.
 */
let sequence = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

async function runSearch(query: string) {
    const ticket = ++sequence;

    searching.value = true;
    searchError.value = '';

    try {
        const params = new URLSearchParams({
            ...(props.searchParams ?? {}),
            q: query,
            limit: String(SEARCH_LIMIT),
        });

        /**
         * `limit` is what makes this `{ rows, total }` rather than a bare array:
         * `/api/[resource]` switches shape on it. Typed explicitly and read
         * structurally so a change to that contract fails here rather than
         * rendering an empty list, which is indistinguishable from no matches.
         */
        const page = await request<{ rows: EntityRow[]; total: number }>(
            `/api/${props.def.resource}?${params.toString()}`,
        );

        if (ticket !== sequence) {
            return;
        }

        matches.value = page.rows;
        total.value = page.total;
        activeIndex.value = 0;
        remember(page.rows);
    } catch (cause) {
        if (ticket !== sequence) {
            return;
        }

        matches.value = [];
        total.value = 0;
        // Named as a failure, never as an empty result. "No matches" for a
        // request that never completed is the exact lie this codebase keeps
        // finding in its own empty states.
        searchError.value = serverErrorMessage(cause)
            ?? t('manageUi.picker.searchFailed');
    } finally {
        if (ticket === sequence) {
            searching.value = false;
        }
    }
}

watch(term, (next) => {
    clearTimeout(timer);

    const query = next.trim();

    if (!query) {
        // Bumping the sequence cancels any request still in flight, so clearing
        // the box cannot be undone a moment later by its own stale response.
        sequence += 1;
        matches.value = [];
        total.value = 0;
        searching.value = false;
        searchError.value = '';

        return;
    }

    searching.value = true;
    timer = setTimeout(() => void runSearch(query), DEBOUNCE_MS);
});

onBeforeUnmount(() => clearTimeout(timer));

function moveActive(delta: number) {
    if (!results.value.length) {
        return;
    }

    const count = results.value.length;

    activeIndex.value = (activeIndex.value + delta + count) % count;
}

function addActive() {
    const option = results.value[activeIndex.value];

    if (option && !option.taken && !props.busy) {
        emit('add', option.value);
    }
}

function clearSearch() {
    term.value = '';
    searchInput.value?.focus();
}
</script>

<style scoped lang="scss">
.picker {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);

    padding: var(--space-6);
    border-radius: var(--radius-xl);

    background: $surface1;

    &_head {
        display: flex;
        gap: var(--space-4);
        align-items: baseline;

        h2 {
            margin: 0;
            font-size: var(--font-size-md);
            font-weight: 680;
            color: $content2;
        }
    }

    &_state {
        font-size: var(--font-size-xs);
        color: $content7;

        &--ok {
            display: inline-flex;
            gap: var(--space-1);
            align-items: center;
            color: $success700;

            svg {
                width: 14px;
                height: 14px;
            }
        }
    }

    &_help {
        margin: 0;
        font-size: var(--font-size-sm);
        line-height: 1.5;
        color: $content7;
    }

    &_error {
        margin: 0;
        padding: var(--space-3) var(--space-5);
        border-radius: var(--radius-lg);

        font-size: var(--font-size-sm);
        font-weight: 600;
        color: $error700;

        background: varToRgba('error500', 0.14);
    }

    /* Deliberately the warning palette, not the error one: same weight of
       attention, different meaning. A user who has just saved successfully must
       not be shown red. */
    &_warning {
        margin: 0;
        padding: var(--space-3) var(--space-5);
        border-radius: var(--radius-lg);

        font-size: var(--font-size-sm);
        line-height: 1.5;
        color: $warning700;

        background: varToRgba('warning500', 0.14);
    }

    &_rows {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);

        margin: 0;
        padding: 0;

        list-style: none;
    }

    &_row {
        display: flex;
        gap: var(--space-4);
        align-items: center;

        padding: var(--space-3) var(--space-4);
        border-radius: var(--radius-lg);

        background: $surface0;

        &-name {
            flex: 1;
            min-width: 0;
            font-size: var(--font-size-md);
            color: $content3;
        }

        &-extra {
            display: flex;
            flex: none;
            gap: var(--space-2);
            align-items: center;

            select,
            input {
                padding: var(--space-2) var(--space-3);
                border: 1px solid $surface4;
                border-radius: var(--radius-sm);

                font-family: inherit;
                font-size: var(--font-size-sm);
                color: $content4;

                background: $surface1;
            }
        }

        &-qty {
            width: 72px;
        }

        &-qty-label {
            font-size: var(--font-size-xs);
            color: $content7;
        }
    }

    &_remove {
        cursor: pointer;

        display: flex;
        flex: none;
        align-items: center;
        justify-content: center;

        width: 24px;
        height: 24px;
        border: 0;
        border-radius: var(--radius-sm);

        color: $surface7;

        background: none;

        svg {
            width: 16px;
            height: 16px;
        }

        @include hover() {
            &:hover {
                color: $error700;
                background: varToRgba('error500', 0.14);
            }
        }
    }

    &_empty {
        margin: 0;
        font-size: var(--font-size-sm);
        font-style: italic;
        color: $content7;
    }

    &_add select {
        width: 100%;
        padding: var(--space-3) var(--space-5);
        border: 1px solid $surface4;
        border-radius: var(--radius-lg);

        font-family: inherit;
        font-size: var(--font-size-md);
        color: $content4;

        background: $surface0;
    }

    &_search {
        display: flex;
        flex-direction: column;
        gap: var(--space-3);

        &-field {
            position: relative;
            display: flex;
            align-items: center;

            input {
                width: 100%;

                /* Room for the icon left and the clear button right, so a long
                   name never slides under either. */
                padding: var(--space-3) var(--space-9) var(--space-3) var(--space-9);
                border: 1px solid $surface4;
                border-radius: var(--radius-lg);

                font-family: inherit;
                font-size: var(--font-size-md);
                color: $content4;

                background: $surface0;

                &::placeholder { color: $content7; }
            }
        }

        &-icon {
            pointer-events: none;

            position: absolute;
            left: var(--space-4);

            width: 16px;
            height: 16px;

            color: $content7;
        }

        &-clear {
            cursor: pointer;

            position: absolute;
            right: var(--space-3);

            display: flex;
            align-items: center;
            justify-content: center;

            width: 24px;
            height: 24px;
            border: 0;
            border-radius: var(--radius-sm);

            color: $surface7;

            background: none;

            svg {
                width: 16px;
                height: 16px;
            }

            @include hover() {
                &:hover { color: $content4; }
            }
        }
    }

    &_results {
        /* Bounded so a full page of matches cannot push the form's own
           controls off screen; the count line below says how many there are. */
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: var(--space-1);

        max-height: 280px;
        margin: 0;
        padding: 0;

        list-style: none;
    }

    &_result {
        cursor: pointer;

        display: flex;
        gap: var(--space-4);
        align-items: center;
        justify-content: space-between;

        width: 100%;
        padding: var(--space-3) var(--space-4);
        border: 0;
        border-radius: var(--radius-lg);

        font-family: inherit;
        font-size: var(--font-size-md);
        color: $content3;
        text-align: left;

        background: $surface0;

        &--active { background: $surface2; }

        &:disabled {
            cursor: default;
            color: $content7;
        }

        &-taken {
            flex: none;
            font-size: var(--font-size-xs);
            color: $content7;
        }
    }

    &_hint {
        margin: 0;
        font-size: var(--font-size-sm);
        color: $content7;

        &--warn { color: $warning700; }
    }
}

.sr-only {
    position: absolute;

    overflow: hidden;

    width: 1px;
    height: 1px;

    clip-path: inset(50%);
}
</style>
