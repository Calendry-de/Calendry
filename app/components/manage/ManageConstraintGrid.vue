<template>
    <div class="cgrid">
        <p
            v-if="!list.isComplete.value"
            class="cgrid_alarm"
            role="alert"
        >
            Showing {{ list.rows.value.length }} of {{ list.total.value }} rules. This view needs the
            whole set to group them correctly — raise <code>listPageSize</code> for constraints.
        </p>

        <p
            v-if="missingTypes.length"
            class="cgrid_alarm"
            role="alert"
        >
            {{ missingTypes.length }} rule{{ missingTypes.length === 1 ? '' : 's' }} in the catalogue
            {{ missingTypes.length === 1 ? 'has' : 'have' }} no row for this tenant and
            {{ missingTypes.length === 1 ? 'is' : 'are' }} therefore <strong>not evaluated at all</strong>:
            <code>{{ missingTypes.map((t) => t.key).join(', ') }}</code>.
            An operator can repair this with <code>bun run backfill:constraints -- --all-missing</code>.
        </p>

        <section
            v-for="group in groups"
            :key="group.severity"
            class="cgrid_group"
        >
            <header class="cgrid_head">
                <h2>
                    <span
                        class="cgrid_sev"
                        :class="`cgrid_sev--${group.severity.toLowerCase()}`"
                    >{{ group.severity }}</span>
                    {{ group.title }}
                </h2>
                <p>{{ group.blurb }}</p>
            </header>

            <ul class="cgrid_rows">
                <li
                    v-for="entry in group.entries"
                    :key="entry.type.key"
                    class="cgrid_row"
                    :class="{ 'cgrid_row--off': !entry.row.isEnabled }"
                >
                    <div class="cgrid_main">
                        <label class="cgrid_toggle">
                            <input
                                :checked="entry.row.isEnabled"
                                :disabled="!canUpdate || busy.has(entry.row.id)"
                                type="checkbox"
                                @change="setEnabled(entry.row, ($event.target as HTMLInputElement).checked)"
                            >
                            <span class="cgrid_name">{{ entry.type.label }}</span>
                        </label>

                        <p class="cgrid_desc">{{ entry.type.description }}</p>

                        <div class="cgrid_controls">
                            <label
                                v-if="entry.row.severity === 'SOFT'"
                                class="cgrid_weight"
                            >
                                <span>Weight</span>
                                <input
                                    :disabled="!canUpdate || busy.has(entry.row.id)"
                                    min="0"
                                    type="number"
                                    :value="entry.row.weight ?? 0"
                                    @change="setWeight(entry.row, ($event.target as HTMLInputElement).value)"
                                >
                            </label>

                            <common-button
                                v-if="entry.type.params.length"
                                icon="material-symbols:tune"
                                type="transparent"
                                @click="toggleParams(entry.type.key)"
                            >{{ openParams.has(entry.type.key) ? 'Hide' : 'Settings' }}</common-button>

                            <common-button
                                v-if="canCreate"
                                icon="material-symbols:add"
                                :to="`/manage/constraints/new?type=${entry.type.key}`"
                                type="transparent"
                            >Add scoped variant</common-button>
                        </div>
                    </div>

                    <div
                        v-if="openParams.has(entry.type.key) && entry.type.params.length"
                        class="cgrid_params"
                    >
                        <template
                            v-for="param in entry.type.params"
                            :key="param.key"
                        >
                            <ManageWeekdayPicker
                                v-if="param.type === 'weekdays'"
                                :help="param.help"
                                :label="param.label"
                                :model-value="(paramValue(entry.row, param.key) as number[]) ?? []"
                                :readonly="!canUpdate"
                                @update:model-value="setParam(entry.row, param.key, $event)"
                            />

                            <ManageField
                                v-else
                                :field="paramField(param)"
                                :model-value="paramValue(entry.row, param.key)"
                                :readonly="!canUpdate"
                                @update:model-value="setParam(entry.row, param.key, $event)"
                            />
                        </template>
                    </div>

                    <ul
                        v-if="entry.variants.length"
                        class="cgrid_variants"
                    >
                        <li
                            v-for="variant in entry.variants"
                            :key="variant.id"
                            class="cgrid_variant"
                        >
                            <label class="cgrid_toggle">
                                <input
                                    :checked="variant.isEnabled"
                                    :disabled="!canUpdate || busy.has(variant.id)"
                                    type="checkbox"
                                    @change="setEnabled(variant, ($event.target as HTMLInputElement).checked)"
                                >
                                <span>{{ variant.name }}</span>
                            </label>

                            <span class="cgrid_scoped">scoped variant</span>

                            <NuxtLink :to="`/manage/constraints/${variant.id}`">Edit</NuxtLink>
                        </li>
                    </ul>
                </li>
            </ul>
        </section>

        <p
            v-if="error"
            class="cgrid_alarm"
            role="alert"
        >{{ error }}</p>
    </div>
</template>

<script setup lang="ts">
import type { ConstraintParamDef, ConstraintTypeDef } from '#shared/constraintTypes';
import type { FieldDef, ManageEntity } from '~/utils/manageRegistry';
import type { useEntityList } from '~/composables/entityList';
import ManageField from '~/components/manage/ManageField.vue';
import ManageWeekdayPicker from '~/components/manage/ManageWeekdayPicker.vue';
import { defaultConstraintTypes } from '#shared/constraintTypes';

/**
 * The constraint list, as a configuration surface rather than a table of rows.
 *
 * WHY THIS IS A BESPOKE LIST AND NOT THE GENERIC SCAFFOLD
 *
 * The generic list answers "which rows exist?". For constraints that is the
 * wrong question: the CATALOGUE is fixed and every live type has exactly one
 * default row per tenant (TAXONOMY.md §2), so the interesting state is not
 * which rules exist but which are ON and how they are tuned. A table with an
 * "Add" button framed a fixed set of thirteen switches as a collection you
 * populate, which is why tenants ended up with some types configured and others
 * silently unevaluated.
 *
 * The rows are therefore driven by the CATALOGUE, not by the fetch: every live
 * type gets a row whether or not the tenant has one, and a type with no row is
 * reported LOUDLY rather than omitted. Omitting it is precisely the failure
 * mode that hid `no_double_booking_person` — a rule nobody could see was
 * missing, in a list that looked complete.
 *
 * HARD AND SOFT ARE SEPARATED because they are not comparable. A hard rule's
 * breach is a defect; a soft rule's is a preference with a weight that only has
 * meaning relative to the other enabled soft rules. Interleaving them invites
 * reading the weight column as a severity ranking.
 */
const props = defineProps<{
    entity: ManageEntity;
    list: ReturnType<typeof useEntityList>;
    canCreate: boolean;
}>();

// Declared so the page's v-model bindings resolve; this view has no pagination
// or search of its own — the set is thirteen rows and always complete.
defineModel<string>('search', { required: true });
defineModel<number>('page', { required: true });

interface ConstraintRow {
    id: string;
    type: string;
    name: string;
    severity: 'HARD' | 'SOFT';
    weight: number | null;
    params: Record<string, unknown> | null;
    isEnabled: boolean;
    isDefault: boolean;
}

const request = useRequestFetch();
const { canUpdate } = useEntityPermissions(props.entity);

const busy = ref(new Set<string>());
const openParams = ref(new Set<string>());
const error = ref<string | null>(null);

const rows = computed(() => props.list.rows.value as unknown as ConstraintRow[]);

const defaultByType = computed(() => new Map(
    rows.value.filter((row) => row.isDefault).map((row) => [row.type, row]),
));

const variantsByType = computed(() => {
    const map = new Map<string, ConstraintRow[]>();

    for (const row of rows.value.filter((r) => !r.isDefault)) {
        map.set(row.type, [...(map.get(row.type) ?? []), row]);
    }

    return map;
});

/**
 * Catalogue types with no row for this tenant. Surfaced, never hidden: the
 * evaluator only considers types the tenant has a row for, so this list is
 * exactly the set of rules that are silently not running.
 */
const missingTypes = computed(() => defaultConstraintTypes()
    .filter((type) => !defaultByType.value.has(type.key)));

interface Entry { type: ConstraintTypeDef; row: ConstraintRow; variants: ConstraintRow[] }

function entriesFor(severity: 'HARD' | 'SOFT'): Entry[] {
    return defaultConstraintTypes()
        .filter((type) => (type.severity ?? 'HARD') === severity)
        .map((type) => {
            const row = defaultByType.value.get(type.key);

            return row ? { type, row, variants: variantsByType.value.get(type.key) ?? [] } : null;
        })
        .filter((entry): entry is Entry => entry !== null);
}

const groups = computed(() => [
    {
        severity: 'HARD' as const,
        title: 'Rules a timetable must not break',
        blurb: 'A breach is a defect. Manual edits are warned rather than blocked, and the solver '
            + 'treats these as inviolable.',
        entries: entriesFor('HARD'),
    },
    {
        severity: 'SOFT' as const,
        title: 'Preferences the solver weighs',
        blurb: 'Weights are relative to each other, not a score out of ten — only the ratio between '
            + 'enabled rules means anything. Zero evaluates the rule without steering the schedule.',
        entries: entriesFor('SOFT'),
    },
]);

function paramValue(row: ConstraintRow, key: string): unknown {
    return (row.params ?? {})[key] ?? null;
}

function paramField(param: ConstraintParamDef): FieldDef {
    return {
        key: param.key,
        label: param.label,
        type: param.type === 'percent' ? 'number' : param.type,
        help: param.help,
        options: param.options,
    } as FieldDef;
}

function toggleParams(key: string) {
    const next = new Set(openParams.value);

    if (next.has(key)) {
        next.delete(key);
    } else {
        next.add(key);
    }

    openParams.value = next;
}

/**
 * Saves ONE field, immediately, per control.
 *
 * Deliberately not a form with a Save button. Each row is an independent rule
 * and there is no state spanning them, so a single Save would make thirteen
 * unrelated edits succeed or fail together — the same objection the relations
 * panel already records for PUT-set sub-resources.
 */
async function patch(row: ConstraintRow, body: Record<string, unknown>) {
    if (!canUpdate.value) {
        return;
    }

    error.value = null;
    busy.value = new Set(busy.value).add(row.id);

    try {
        await request(`/api/constraints/${row.id}`, { method: 'PATCH', body });
        await props.list.refresh();
    } catch (caught: unknown) {
        const data = (caught as { data?: { statusMessage?: string; message?: string } }).data;

        // Named rather than swallowed: a rejected weight or param is the server
        // enforcing a rule this control could not know about, and a silent
        // revert would look like the click did nothing.
        error.value = data?.statusMessage ?? data?.message ?? 'Could not save that change.';
        await props.list.refresh();
    } finally {
        const next = new Set(busy.value);

        next.delete(row.id);
        busy.value = next;
    }
}

const setEnabled = (row: ConstraintRow, isEnabled: boolean) => patch(row, { isEnabled });

function setWeight(row: ConstraintRow, raw: string) {
    const weight = Number(raw);

    if (!Number.isFinite(weight)) {
        error.value = 'Weight must be a number.';

        return;
    }

    patch(row, { weight });
}

const setParam = (row: ConstraintRow, key: string, value: unknown) =>
    patch(row, { params: { ...(row.params ?? {}), [key]: value } });
</script>

<style scoped lang="scss">
.cgrid {
    display: flex;
    flex-direction: column;
    gap: $space8;

    &_alarm {
        padding: $space6;
        border: 1px solid var(--error-color, #b3261e);
        border-radius: $radiusMd;

        font-size: $fontSizeSm;
        color: var(--error-color, #b3261e);
    }

    &_group {
        display: flex;
        flex-direction: column;
        gap: $space6;
    }

    &_head {
        h2 {
            display: flex;
            gap: $space4;
            align-items: center;

            margin: 0;

            font-size: $fontSizeLg;
        }

        p {
            max-width: 68ch;
            margin: $space2 0 0;
            font-size: $fontSizeSm;
            color: var(--text-secondary-color);
        }
    }

    &_sev {
        padding: 2px $space4;
        border-radius: $radiusSm;

        font-size: $fontSizeXs;
        font-weight: 700;
        letter-spacing: 0.06em;

        &--hard {
            color: #fff;
            background: var(--error-color, #b3261e);
        }

        &--soft {
            color: #fff;
            background: var(--primary-color);
        }
    }

    &_rows {
        display: flex;
        flex-direction: column;
        gap: $space4;

        margin: 0;
        padding: 0;

        list-style: none;
    }

    &_row {
        padding: $space6;
        border: 1px solid var(--border-color, rgb(128 128 128 / 30%));
        border-radius: $radiusMd;

        &--off {
            opacity: 0.62;
        }
    }

    &_main {
        display: flex;
        flex-wrap: wrap;
        gap: $space4 $space6;
        align-items: center;
    }

    &_toggle {
        cursor: pointer;
        display: flex;
        gap: $space4;
        align-items: center;
    }

    &_name {
        font-weight: 600;
    }

    &_desc {
        flex: 1 1 24ch;
        margin: 0;
        font-size: $fontSizeSm;
        color: var(--text-secondary-color);
    }

    &_controls {
        display: flex;
        gap: $space4;
        align-items: center;
        margin-left: auto;
    }

    &_weight {
        display: flex;
        gap: $space2;
        align-items: center;
        font-size: $fontSizeSm;

        input {
            width: 6rem;
            padding: $space2 $space4;
            border: 1px solid var(--border-color, rgb(128 128 128 / 30%));
            border-radius: $radiusSm;

            font: inherit;
            color: inherit;

            background: transparent;
        }
    }

    &_params {
        display: flex;
        flex-direction: column;
        gap: $space4;

        margin-top: $space6;
        padding-top: $space6;
        border-top: 1px solid var(--border-color, rgb(128 128 128 / 30%));
    }

    &_variants {
        margin: $space6 0 0;
        padding: $space4 0 0 $space7;
        border-top: 1px solid var(--border-color, rgb(128 128 128 / 30%));
        list-style: none;
    }

    &_variant {
        display: flex;
        gap: $space4;
        align-items: center;

        padding: $space2 0;

        font-size: $fontSizeSm;
    }

    &_scoped {
        font-size: $fontSizeXs;
        color: var(--text-secondary-color);
    }
}
</style>
