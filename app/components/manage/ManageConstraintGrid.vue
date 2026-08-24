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

        <p
            v-if="unknownTypeRows.length"
            class="cgrid_alarm"
            role="alert"
        >
            {{ unknownTypeRows.length }} stored rule{{ unknownTypeRows.length === 1 ? '' : 's' }}
            name{{ unknownTypeRows.length === 1 ? 's' : '' }} a type this build does not know and
            cannot be shown or edited here:
            <code>{{ [...new Set(unknownTypeRows.map((r) => r.type))].join(', ') }}</code>.
            The solver skips {{ unknownTypeRows.length === 1 ? 'it' : 'them' }} too.
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
                <ManageConstraintRow
                    v-for="entry in group.entries"
                    :key="entry.type.key"
                    :busy="busy.has(entry.row.id)"
                    :can-read-kinds="canReadKinds"
                    :can-update="canUpdate"
                    :heading="entry.type.label"
                    :kinds="kinds"
                    :row="entry.row"
                    :type="entry.type"
                    @update:enabled="setEnabled(entry.row, $event)"
                    @update:param="setParam(entry.row, $event.key, $event.value)"
                    @update:scopes="setScopes(entry.row, $event)"
                    @update:weight="setWeight(entry.row, $event)"
                >
                    <template #actions>
                        <common-button
                            v-if="canCreate"
                            icon="material-symbols:add"
                            :to="`/manage/constraints/new?type=${entry.type.key}`"
                            type="transparent"
                        >Add scoped variant</common-button>
                    </template>
                </ManageConstraintRow>
            </ul>

            <!--
                SUPERSEDED RULES — a subsection, never interleaved above.

                Only rendered when the tenant actually HOLDS such a row. These
                are rules whose type has been replaced: they still apply while
                enabled and can still be turned off, but `type` is create-only,
                so one that is deleted cannot be recreated. Kept out of the main
                list because nothing here should read as a rule to adopt, and
                kept visible because it is a rule that is currently running.
            -->
            <template v-if="group.superseded.length">
                <h3 class="cgrid_subhead">Superseded rules</h3>

                <ul class="cgrid_rows">
                    <ManageConstraintRow
                        v-for="entry in group.superseded"
                        :key="entry.type.key"
                        :busy="busy.has(entry.row.id)"
                        :can-read-kinds="canReadKinds"
                        :can-update="canUpdate"
                        :heading="entry.type.label"
                        :kinds="kinds"
                        :row="entry.row"
                        superseded
                        :superseded-by="supersededBy(entry.type)"
                        :type="entry.type"
                        @update:enabled="setEnabled(entry.row, $event)"
                        @update:param="setParam(entry.row, $event.key, $event.value)"
                        @update:scopes="setScopes(entry.row, $event)"
                        @update:weight="setWeight(entry.row, $event)"
                    />
                </ul>
            </template>
        </section>

        <!--
            ADDITIONAL RULES — every non-default instance, in one place.

            These are NOT listed again under their base rule's row. A variant is
            only meaningful relative to the rule it qualifies, so showing it in
            both places would put the same exception on screen twice and leave
            no single answer to "what extra rules does this tenant have?".
        -->
        <section class="cgrid_group">
            <header class="cgrid_head">
                <h2>Additional rules</h2>
                <p>
                    Extra instances of a rule, each narrowed to particular session kinds — a
                    different weight for seminars than for lectures, say. The tenant-wide
                    version above still applies everywhere these do not.
                </p>
            </header>

            <ul
                v-if="variants.length"
                class="cgrid_rows"
            >
                <ManageConstraintRow
                    v-for="variant in variants"
                    :key="variant.row.id"
                    :busy="busy.has(variant.row.id)"
                    :can-read-kinds="canReadKinds"
                    :can-update="canUpdate"
                    :heading="variant.row.name"
                    :kinds="kinds"
                    :row="variant.row"
                    :scope-required="true"
                    :subtitle="`${variant.type.label} — narrowed from the tenant-wide rule.`"
                    :type="variant.type"
                    @update:enabled="setEnabled(variant.row, $event)"
                    @update:param="setParam(variant.row, $event.key, $event.value)"
                    @update:scopes="setScopes(variant.row, $event)"
                    @update:weight="setWeight(variant.row, $event)"
                >
                    <template #actions>
                        <common-button
                            icon="material-symbols:edit-outline"
                            :to="`/manage/constraints/${variant.row.id}`"
                            type="transparent"
                        >Edit</common-button>
                    </template>
                </ManageConstraintRow>
            </ul>

            <p
                v-else
                class="cgrid_empty"
            >
                None yet. Every rule above applies to all session kinds.
            </p>

            <common-button
                v-if="canCreate"
                icon="material-symbols:add"
                to="/manage/constraints/new"
                type="secondary"
            >Add a rule</common-button>
        </section>

        <p
            v-if="error"
            class="cgrid_alarm"
            role="alert"
        >{{ error }}</p>
    </div>
</template>

<script setup lang="ts">
import type { ConstraintTypeDef } from '#shared/constraintTypes';
import type { ManageEntity } from '~/utils/manageRegistry';
import type { useEntityList } from '~/composables/entityList';
import type { ConstraintRowData } from '~/components/manage/ManageConstraintRow.vue';
import ManageConstraintRow from '~/components/manage/ManageConstraintRow.vue';
import { CONSTRAINT_TYPES, defaultConstraintTypes, findConstraintType } from '#shared/constraintTypes';

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

/**
 * Declared by the row component and imported here, rather than described twice.
 * The row is what reads these fields; the grid only fetches and routes them.
 */
type ConstraintRow = ConstraintRowData;

const request = useRequestFetch();
const { canUpdate } = useEntityPermissions(props.entity);

const busy = ref(new Set<string>());
const error = ref<string | null>(null);

const rows = computed(() => props.list.rows.value as unknown as ConstraintRow[]);

const defaultByType = computed(() => new Map(
    rows.value.filter((row) => row.isDefault).map((row) => [row.type, row]),
));

/**
 * Every non-default instance, paired with its catalogue entry.
 *
 * Paired rather than passed bare, because the row component renders from the
 * TYPE (severity, description, parameter list) and a variant that named a type
 * outside the catalogue would otherwise render an empty shell. One that does is
 * dropped here and reported by `unknownVariantTypes` instead — the same
 * report-never-omit rule the missing-type alarm follows.
 */
const variants = computed(() => rows.value
    .filter((row) => !row.isDefault)
    .sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name))
    .map((row) => {
        const type = findConstraintType(row.type);

        return type ? { type, row } : null;
    })
    .filter((entry): entry is { type: ConstraintTypeDef; row: ConstraintRow } => entry !== null));

/*
 * Kind names for the scope summary.
 *
 * `useAsyncData` + `useRequestFetch`, NOT an `onMounted` fetch. A client-only
 * hook does not run on the server, so the first render showed raw uuids where
 * kind names belong — the same shape as every other SSR trap recorded in
 * CLAUDE.md, and caught here only because the check read the rendered TEXT
 * rather than counting elements.
 *
 * `useRequestFetch` because a bare `$fetch` carries no cookie server-side and
 * would 401 into an empty list, which renders identically to a tenant with no
 * kinds.
 */
const kindRequest = useRequestFetch();

const kindsData = useAsyncData(
    'constraint-grid:kinds',
    () => kindRequest<{ rows: { id: string; name: string }[] }>('/api/session-kinds', {
        query: { limit: 200 },
    }),
    // A failed fetch degrades to ids rather than blanking the row — the 6c rule.
    { default: () => ({ rows: [] as { id: string; name: string }[] }) },
);

const kinds = computed(() => kindsData.data.value?.rows ?? []);

/**
 * Whether the kinds list being empty means anything.
 *
 * The fetch above degrades to `[]` on failure so one missing permission cannot
 * blank the page (the 6c rule). That is right, and it makes "this tenant has no
 * session kinds" and "you may not read session kinds" render identically — the
 * exact indistinguishable-failure shape CLAUDE.md keeps recording. The row uses
 * this to say which one it is instead of asserting the wrong one.
 *
 * A UI gate only; the server decides what is actually readable.
 */
const canReadKinds = useHasPermission('session_kind.read');

/**
 * Catalogue types with no row for this tenant. Surfaced, never hidden: the
 * evaluator only considers types the tenant has a row for, so this list is
 * exactly the set of rules that are silently not running.
 *
 * This one DOES use `defaultConstraintTypes()`, unlike `entriesFor` above, and
 * the difference is deliberate rather than an oversight: a deprecated type with
 * no row is not MISSING. `backfill:constraints` will never create one, so
 * reporting it would send an operator to run a repair command that correctly
 * does nothing.
 */
const missingTypes = computed(() => defaultConstraintTypes()
    .filter((type) => !defaultByType.value.has(type.key)));

/**
 * Rows naming a type the catalogue does not describe.
 *
 * Such a row cannot be rendered — there is no severity, description or
 * parameter list to render it FROM — but it is still stored, still enabled and
 * still read by `assembleSolverInput`, which skips it with its own reason. So
 * it is reported here rather than dropped silently: a rule nobody can see is
 * how `no_double_booking_person` stayed missing for a whole stage.
 */
const unknownTypeRows = computed(() => rows.value.filter((row) => !findConstraintType(row.type)));

interface Entry { type: ConstraintTypeDef; row: ConstraintRow }

/**
 * Catalogue entries of one severity that this tenant holds a default row for.
 *
 * DRIVEN BY `CONSTRAINT_TYPES`, NOT `defaultConstraintTypes()`, AND THAT IS THE
 * WHOLE FIX. The latter EXCLUDES deprecated types — correctly, because it
 * answers "which types should a tenant be SEEDED a row for?", and seeding a
 * superseded rule would resurrect it as a first-class option.
 *
 * This function asks a different question: "which rows does this tenant have,
 * and how do I show them?" Borrowing the seeding predicate to answer it made a
 * deprecated row invisible to every branch at once — filtered out here, skipped
 * by `variants` (which takes only `!isDefault`), and not counted by
 * `missingTypes` (same seeding predicate). Measured before the fix, with one
 * legacy `minimize_first_block` row present: `/api/constraints` returned 14
 * rows, the page rendered 13, and the type appeared nowhere in the rendered
 * body — while the rule was still enabled and still being sent to the solver.
 *
 * A deprecated type with NO row stays hidden, which is the other half of the
 * rule: show what a tenant HAS, never invite them to adopt what is superseded.
 */
function entriesFor(severity: 'HARD' | 'SOFT', deprecated: boolean): Entry[] {
    return CONSTRAINT_TYPES
        .filter((type) => (type.severity ?? 'HARD') === severity)
        .filter((type) => Boolean(type.deprecatedBy) === deprecated)
        .map((type) => {
            const row = defaultByType.value.get(type.key);

            return row ? { type, row } : null;
        })
        .filter((entry): entry is Entry => entry !== null);
}

/** What replaced this type, in the tenant's language rather than as a key. */
function supersededBy(type: ConstraintTypeDef): string {
    return findConstraintType(type.deprecatedBy)?.label ?? type.deprecatedBy ?? 'a newer rule';
}

const groups = computed(() => [
    {
        severity: 'HARD' as const,
        title: 'Rules a timetable must not break',
        blurb: 'A breach is a defect. Manual edits are warned rather than blocked, and the solver '
            + 'treats these as inviolable.',
        entries: entriesFor('HARD', false),
        superseded: entriesFor('HARD', true),
    },
    {
        severity: 'SOFT' as const,
        title: 'Preferences the solver weighs',
        blurb: 'Weights are relative to each other, not a score out of ten — only the ratio between '
            + 'enabled rules means anything. Zero evaluates the rule without steering the schedule.',
        entries: entriesFor('SOFT', false),
        superseded: entriesFor('SOFT', true),
    },
]);

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

/**
 * The whole scope set, replaced wholesale — `writeChildren` deletes and
 * recreates, so a partial list would silently drop the kinds it omits.
 *
 * Clearing a DEFAULT row's scopes is legal and widens it back to tenant-wide.
 * Clearing a VARIANT's is refused by `constraintBeforeUpdate` with a 422, which
 * lands in `error` below — the row warns first, but the server is the authority.
 */
const setScopes = (row: ConstraintRow, kindIds: string[]) =>
    patch(row, { scopes: kindIds.map((kindId) => ({ kindId })) });
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











    &_subhead {
        margin: var(--space-2) 0 0;

        font-size: var(--font-size-xs);
        font-weight: 650;
        color: $surface7;
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }

    &_empty {
        margin: 0;
        padding: $space6;
        border: 1px dashed var(--border-color, rgb(128 128 128 / 30%));
        border-radius: $radiusMd;

        font-size: $fontSizeSm;
        color: var(--text-secondary-color);
    }

}
</style>
