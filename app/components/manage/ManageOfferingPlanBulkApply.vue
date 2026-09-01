<template>
    <section
        v-if="canApply"
        class="bulk"
    >
        <header class="bulk_head">
            <h2>Roll out to several groups</h2>
        </header>

        <p class="bulk_help">
            Applies this plan to every group below, for one Term, in a single action —
            the moment a whole term's cohorts move forward together rather than one at a
            time. Filter by name and add every match at once, rather than picking groups
            one by one. Reuse still applies: a group that already has an offering from
            this plan joins it instead of getting a second one.
            <template v-if="preSelectedCount">
                {{ preSelectedCount }} group{{ preSelectedCount === 1 ? '' : 's' }} already
                {{ preSelectedCount === 1 ? 'names' : 'name' }} this as its curriculum plan and
                {{ preSelectedCount === 1 ? 'is' : 'are' }} pre-selected below — remove any that
                don’t belong in this rollout.
            </template>
        </p>

        <p
            v-if="error"
            class="bulk_error"
            role="alert"
        >{{ error }}</p>

        <ul
            v-if="selectedGroups.length"
            class="bulk_rows"
        >
            <li
                v-for="group in selectedGroups"
                :key="group.id"
                class="bulk_row"
            >
                <span>{{ group.name }}</span>
                <button
                    class="bulk_remove"
                    :disabled="busy"
                    type="button"
                    :aria-label="`Remove ${group.name}`"
                    @click="removeGroup(group.id)"
                >
                    <Icon
                        name="material-symbols:close"
                        aria-hidden="true"
                    />
                </button>
            </li>
        </ul>

        <div class="bulk_pick">
            <label class="bulk_filter">
                <span class="sr-only">Filter groups by name</span>
                <input
                    v-model="filter"
                    type="text"
                    placeholder="Filter groups by name…"
                    :disabled="busy"
                >
            </label>

            <CommonButton
                :disabled="busy || !filteredAvailableGroups.length"
                type="secondary"
                @click="addAllFiltered"
            >{{ addAllLabel }}</CommonButton>

            <label class="bulk_add">
                <span class="sr-only">Add one group</span>
                <select
                    :disabled="busy || !filteredAvailableGroups.length"
                    :value="''"
                    @change="addGroup($event)"
                >
                    <option value="">{{ filteredAvailableGroups.length ? 'Or add one…' : 'No matching groups left to add' }}</option>
                    <option
                        v-for="option in filteredAvailableGroups"
                        :key="option.id"
                        :value="String(option.id)"
                    >{{ option.name }}</option>
                </select>
            </label>
        </div>

        <div class="bulk_controls">
            <label class="bulk_field">
                <span>Term</span>
                <select
                    v-model="termId"
                    :disabled="busy"
                >
                    <option value="">Choose a term…</option>
                    <option
                        v-for="term in terms"
                        :key="term.id"
                        :value="term.id"
                    >{{ term.name }}</option>
                </select>
            </label>

            <CommonButton
                :disabled="busy || !termId || !selectedGroups.length"
                type="primary"
                @click="apply"
            >{{ busy ? 'Applying…' : `Apply to ${selectedGroups.length || ''} group${selectedGroups.length === 1 ? '' : 's'}` }}</CommonButton>
        </div>

        <p
            v-if="summary"
            class="bulk_ok"
        >{{ summary }}</p>
    </section>
</template>

<script setup lang="ts">
/**
 * The Plan-side complement to `ManageGroupApplyPlan`: that one applies ONE
 * plan to ONE group from the group's own page (including the "advance"
 * shortcut); this applies ONE plan to SEVERAL groups at once, from the
 * plan's own page — the shape a whole term's rollout actually takes, rather
 * than one apply-click per cohort.
 *
 * SAME IDEMPOTENCY GUARANTEE, so there is nothing to confirm here either: a
 * group already reached by this plan in this Term is a no-op entry in the
 * result, not a duplicate.
 *
 * THREE WAYS INTO THE LIST, cheapest first. `Group.curriculumPlanId` —
 * an intent set on the Group itself, before it has a single Offering —
 * pre-selects every Group already naming THIS plan, with nothing to click.
 * The filter + "add all" covers a Group that never set the field but shares
 * a name pattern with its cohort ("dIT25 S1", "dWI25 S1", …). The plain
 * dropdown is the fallback for the odd one out neither of those catches.
 * `groupIds` is still capped at 100 server-side
 * (`offering-plan-apply/[id].post.ts`'s zod schema); nothing here pre-empts
 * that — a plan whose pre-selection plus filter matches more than 100 groups
 * is refused the same way a 101st manual add would have been.
 */
const props = defineProps<{
    planId: string;
    readonly?: boolean;
}>();

interface GroupRow { id: string; name: string; curriculumPlanId: string | null }
interface TermRow { id: string; name: string }
interface AppliedResult { groupId: string; offerings: { id: string; title: string; action: string }[] }

const canApply = useHasPermission('offering_plan.apply');
const request = useRequestFetch();

const { data: groupsData } = await useAsyncData(
    'bulk-apply-plan:groups',
    () => request<GroupRow[]>('/api/groups'),
    { default: () => [] as GroupRow[] },
);

const { data: termsData } = await useAsyncData(
    'bulk-apply-plan:terms',
    () => request<TermRow[]>('/api/terms'),
    { default: () => [] as TermRow[] },
);

const allGroups = computed(() => groupsData.value ?? []);
const terms = computed(() => termsData.value ?? []);

// PRE-SELECTED, not just offered: `Group.curriculumPlanId` is exactly the
// "we already know who this plan is for" intent this panel exists to act on,
// so a Group naming this plan starts in the list rather than waiting to be
// found through the filter. Still just a starting point — every row below
// has its own remove button, and the manual add/filter still reaches a Group
// that never set the field.
const preSelectedCount = allGroups.value.filter((g) => g.curriculumPlanId === props.planId).length;
const selectedGroupIds = ref<string[]>(
    allGroups.value.filter((g) => g.curriculumPlanId === props.planId).map((g) => String(g.id)),
);
const selectedGroups = computed(() => selectedGroupIds.value
    .map((id) => allGroups.value.find((g) => String(g.id) === id))
    .filter((g): g is GroupRow => Boolean(g)));

const availableGroups = computed(() => {
    const taken = new Set(selectedGroupIds.value);

    return allGroups.value.filter((g) => !taken.has(String(g.id)));
});

const filter = ref('');

// Case-insensitive substring, matching the manage list's own search
// convention — a group is a name to a human doing this, not an id.
const filteredAvailableGroups = computed(() => {
    const needle = filter.value.trim().toLowerCase();

    return needle
        ? availableGroups.value.filter((g) => g.name.toLowerCase().includes(needle))
        : availableGroups.value;
});

const addAllLabel = computed(() => (filter.value.trim()
    ? `Add all ${filteredAvailableGroups.value.length} matching`
    : `Add all ${filteredAvailableGroups.value.length}`));

const termId = ref('');
const busy = ref(false);
const error = ref('');
const summary = ref('');

function addGroup(event: Event) {
    const select = event.target as HTMLSelectElement;
    const value = select.value;

    select.value = '';

    if (value) {
        selectedGroupIds.value = [...selectedGroupIds.value, value];
    }
}

// The whole point: going from "one dropdown pick per group" to "every group
// this filter already identifies, in one click" — the manual add above still
// covers the odd one out the filter didn't catch.
function addAllFiltered() {
    if (!filteredAvailableGroups.value.length) {
        return;
    }

    selectedGroupIds.value = [
        ...selectedGroupIds.value,
        ...filteredAvailableGroups.value.map((g) => String(g.id)),
    ];
    filter.value = '';
}

function removeGroup(id: string) {
    selectedGroupIds.value = selectedGroupIds.value.filter((existing) => existing !== id);
}

function describe(results: AppliedResult[]): string {
    const created = results.reduce((sum, r) => sum + r.offerings.filter((o) => o.action === 'created').length, 0);
    const attached = results.reduce((sum, r) => sum + r.offerings.filter((o) => o.action === 'attached').length, 0);
    const already = results.reduce((sum, r) => sum + r.offerings.filter((o) => o.action === 'already-attached').length, 0);

    if (!created && !attached) {
        return `Every one of these ${results.length} group${results.length === 1 ? '' : 's'} already had every offering in this plan for this term.`;
    }

    const parts = [
        ...(created ? [`created ${created} offering${created === 1 ? '' : 's'}`] : []),
        ...(attached ? [`made ${attached} group-join${attached === 1 ? '' : 's'} to existing offerings`] : []),
    ];

    const alreadyClause = already ? ` (${already} were already in place)` : '';

    return `Done across ${results.length} group${results.length === 1 ? '' : 's'} — ${parts.join(' and ')}${alreadyClause}.`;
}

async function apply() {
    if (!termId.value || !selectedGroupIds.value.length || busy.value) {
        return;
    }

    busy.value = true;
    error.value = '';
    summary.value = '';

    try {
        const result = await request<{ results: AppliedResult[] }>(
            `/api/offering-plan-apply/${props.planId}`,
            { method: 'POST', body: { termId: termId.value, groupIds: selectedGroupIds.value } },
        );

        summary.value = describe(result.results);
    } catch (cause) {
        // h3 nests a custom `data` one level inside the response body — see
        // `useEntityForm`'s own comment on this, verified against a live error.
        const body = (cause as { data?: { statusMessage?: string } }).data;

        error.value = body?.statusMessage ?? 'Could not apply this plan.';
    } finally {
        busy.value = false;
    }
}
</script>

<style scoped lang="scss">
.bulk {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);

    padding: var(--space-6);
    border-radius: var(--radius-xl);

    background: $surface1;

    &_head h2 {
        margin: 0;
        font-size: var(--font-size-md);
        font-weight: 680;
        color: $content2;
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
        justify-content: space-between;

        padding: var(--space-3) var(--space-4);
        border-radius: var(--radius-lg);

        font-size: var(--font-size-md);
        color: $content3;

        background: $surface0;
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

    &_pick {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-3);
        align-items: center;
    }

    &_filter {
        flex: 1 1 200px;

        input {
            width: 100%;
            padding: var(--space-3) var(--space-5);
            border: 1px solid $surface4;
            border-radius: var(--radius-lg);

            font-family: inherit;
            font-size: var(--font-size-md);
            color: $content4;

            background: $surface0;
        }
    }

    &_add {
        flex: 1 1 200px;
    }

    &_controls {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-4);
        align-items: flex-end;
    }

    &_field {
        display: flex;
        flex: 1 1 200px;
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

    &_ok {
        margin: 0;
        font-size: var(--font-size-sm);
        font-weight: 600;
        color: $success700;
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
