<template>
    <section class="sources">
        <header class="sources_head">
            <h2>Built from other groups</h2>
            <span
                v-if="busy"
                class="sources_state"
            >Working…</span>
        </header>

        <p class="sources_help">
            For a track taught across cohorts — two semesters’ Management students in
            one room. Name the groups it draws from, then copy their members in.
            <strong>Members are copied, not linked</strong>: the group stays as it is
            until you regenerate, so a solve today and a solve tomorrow see the same
            people.
        </p>

        <p
            v-if="error"
            class="sources_error"
            role="alert"
        >{{ error }}</p>

        <ul
            v-if="rows.length"
            class="sources_rows"
        >
            <li
                v-for="row in rows"
                :key="row.sourceGroupId"
                class="sources_row"
            >
                <span>{{ nameOf(row.sourceGroupId) }}</span>
                <button
                    v-if="!readonly"
                    class="sources_remove"
                    :disabled="busy"
                    type="button"
                    :aria-label="`Remove ${nameOf(row.sourceGroupId)}`"
                    @click="remove(row.sourceGroupId)"
                >
                    <Icon
                        name="material-symbols:close"
                        aria-hidden="true"
                    />
                </button>
            </li>
        </ul>

        <p
            v-else
            class="sources_empty"
        >
            This is an ordinary group — its members are whoever you put in it.
        </p>

        <label
            v-if="!readonly"
            class="sources_add"
        >
            <span class="sr-only">Add a source group</span>
            <select
                :disabled="busy || !available.length"
                :value="''"
                @change="add($event)"
            >
                <option value="">{{ available.length ? 'Draw from another group…' : 'Nothing left to add' }}</option>
                <option
                    v-for="option in available"
                    :key="option.value"
                    :value="option.value"
                >{{ option.label }}</option>
            </select>
        </label>

        <!--
            THE STALENESS READOUT, which is the price of materialising and the
            only thing that makes materialising acceptable. Three states, named
            separately, because "never generated", "generated and current" and
            "generated and behind" call for different words and read identically
            as a member count.
        -->
        <div
            v-if="rows.length && drift"
            class="sources_drift"
            :class="{ 'sources_drift--stale': isStale }"
        >
            <p class="sources_drift-line">
                <template v-if="!drift.generatedAt">
                    Never copied — this group holds {{ drift.memberCount }}
                    {{ drift.memberCount === 1 ? 'person' : 'people' }}, its sources hold
                    {{ drift.expectedCount }}.
                </template>
                <template v-else-if="!isStale">
                    {{ drift.memberCount }} {{ drift.memberCount === 1 ? 'person' : 'people' }},
                    matching the sources as of {{ generatedLabel }}.
                </template>
                <template v-else>
                    The sources have moved on since {{ generatedLabel }}:
                    {{ drift.added }} to add, {{ drift.removed }} to remove.
                </template>
            </p>

            <CommonButton
                v-if="!readonly"
                :disabled="busy"
                type="primary"
                @click="regenerate"
            >{{ drift.generatedAt ? 'Regenerate members' : 'Copy members in' }}</CommonButton>
        </div>
    </section>
</template>

<script setup lang="ts">
import type { EntityRow } from '~/utils/manageRegistry';
import { indentedOptions } from '~/utils/groupTree';

/**
 * A Group whose membership was copied from other Groups.
 *
 * NOT A SECOND PARENT. Two cohorts' Management tracks taught together would be
 * a DAG if the combining group sat above them, and the hierarchy is a tree on
 * the wire and in every closure walk. A combined group is an ordinary
 * root-level Group with its own membership, which is what already works — a
 * student in both their cohort and this group is double-booked on the PERSON
 * axis. What this adds is a record of where the membership came from.
 *
 * SAVES IMMEDIATELY, like `ManageGroupAvailability` beside it and for the same
 * reason: it is a sub-resource with its own endpoint, and staging it behind the
 * form's Save button would let the entity and its sources half-succeed.
 */
const props = defineProps<{
    groupId: string;
    /** Every Group, for naming sources and offering the ones not yet used. */
    allGroups: EntityRow[];
    readonly?: boolean;
}>();

interface SourceRow { sourceGroupId: string }
interface Drift {
    sourceCount: number;
    generatedAt: string | null;
    memberCount: number;
    expectedCount: number;
    added: number;
    removed: number;
}

const request = useRequestFetch();

const { data, refresh } = await useAsyncData(`group-sources:${props.groupId}`, async () => {
    const [rows, drift] = await Promise.all([
        request<SourceRow[]>(`/api/groups/${props.groupId}/sources`),
        request<Drift>(`/api/group-sources/${props.groupId}/drift`),
    ]);

    return { rows, drift };
});

const rows = computed(() => data.value?.rows ?? []);
const drift = computed(() => data.value?.drift ?? null);

/*
 * Stale means the sources DIFFER, not that time has passed. A group regenerated
 * a year ago whose sources have not moved is current, and saying otherwise
 * would train people to press a button that does nothing.
 */
const isStale = computed(() => Boolean(drift.value && (drift.value.added || drift.value.removed)));

const generatedLabel = computed(() => (drift.value?.generatedAt
    ? new Date(drift.value.generatedAt).toLocaleDateString()
    : ''));

function nameOf(id: string): string {
    const row = props.allGroups.find((g) => String(g.id) === id);

    // The raw id rather than a blank: an unresolvable source is something to
    // see, and it is the shape a cross-tenant reference would take.
    return row ? String(row.name) : id;
}

const available = computed(() => {
    const taken = new Set(rows.value.map((r) => r.sourceGroupId));

    // A group cannot draw from itself — the database refuses it, and offering
    // it here would be a control whose only outcome is an error.
    taken.add(props.groupId);

    return indentedOptions(props.allGroups).filter((option) => !taken.has(option.value));
});

const busy = ref(false);
const error = ref('');

async function save(next: SourceRow[]) {
    busy.value = true;
    error.value = '';

    try {
        // A bare array is the body `[relation].put.ts` parses — NOT `{ rows }`.
        await request(`/api/groups/${props.groupId}/sources`, { method: 'PUT', body: next });
        await refresh();
    } catch (cause) {
        error.value = (cause as { statusMessage?: string })?.statusMessage
            ?? 'Could not save the source groups.';
    } finally {
        busy.value = false;
    }
}

function add(event: Event) {
    const select = event.target as HTMLSelectElement;
    const value = select.value;

    select.value = '';

    if (value) {
        void save([...rows.value, { sourceGroupId: value }]);
    }
}

function remove(sourceGroupId: string) {
    void save(rows.value.filter((r) => r.sourceGroupId !== sourceGroupId));
}

async function regenerate() {
    busy.value = true;
    error.value = '';

    try {
        await request(`/api/group-sources/${props.groupId}/regenerate`, { method: 'POST', body: {} });
        await refresh();
    } catch (cause) {
        error.value = (cause as { statusMessage?: string })?.statusMessage
            ?? 'Could not copy the members in.';
    } finally {
        busy.value = false;
    }
}
</script>

<style scoped lang="scss">
.sources {
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

    &_drift {
        display: flex;
        gap: var(--space-4);
        align-items: center;
        justify-content: space-between;

        padding: var(--space-4) var(--space-5);
        border-radius: var(--radius-lg);

        background: $surface0;

        &--stale {
            color: $warning700;
            background: varToRgba('warning500', 0.12);
        }

        &-line {
            margin: 0;
            font-size: var(--font-size-sm);
            line-height: 1.5;
        }
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
