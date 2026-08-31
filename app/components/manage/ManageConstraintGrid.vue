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
            <code>{{ missingTypeKeys }}</code>.
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
            <code>{{ unknownTypeKeys }}</code>.
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
                    :less-relevant="!isConstraintTypeSuggested(entry.type.key, tenantMode)"
                    :row="entry.row"
                    :type="entry.type"
                    @update:enabled="setEnabled(entry.row, $event)"
                    @update:param="setParam(entry.row, $event.key, $event.value)"
                    @update:scopes="setScopes(entry.row, $event)"
                    @update:weight="setWeight(entry.row, $event)"
                >
                    <template #actions>
                        <CommonButton
                            v-if="canCreate"
                            icon="material-symbols:add"
                            :to="`/manage/constraints/new?type=${entry.type.key}`"
                            type="transparent"
                        >Add scoped variant</CommonButton>
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
                        <CommonButton
                            icon="material-symbols:edit-outline"
                            :to="`/manage/constraints/${variant.row.id}`"
                            type="transparent"
                        >Edit</CommonButton>
                    </template>
                </ManageConstraintRow>
            </ul>

            <p
                v-else
                class="cgrid_empty"
            >
                None yet. Every rule above applies to all session kinds.
            </p>

            <CommonButton
                v-if="canCreate"
                icon="material-symbols:add"
                to="/manage/constraints/new"
                type="secondary"
            >Add a rule</CommonButton>
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
import { isConstraintTypeSuggested } from '#shared/tenantMode';

/**
 * The constraint list, as a configuration surface rather than a table of rows.
 *
 * BESPOKE because the generic list answers "which rows exist?", and for
 * constraints the catalogue is fixed with one default row per type per tenant —
 * so the interesting state is which are ON and how they are tuned. A table with
 * an "Add" button framed thirteen switches as a collection you populate, which
 * is how tenants ended up with types silently unevaluated.
 *
 * Rows are driven by the CATALOGUE, not the fetch: every live type gets a row
 * whether or not the tenant has one, and a missing one is reported LOUDLY. That
 * omission is what hid `no_double_booking_person`.
 *
 * HARD AND SOFT ARE SEPARATED because they are not comparable — interleaving
 * them invites reading the weight column as a severity ranking.
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
const tenantMode = useTenantMode();

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
 * dropped here and reported by `unknownTypeRows` instead — the same
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
 * `useAsyncData` + `useRequestFetch`, NOT an `onMounted` fetch: a client-only hook
 * does not run on the server, so the first render showed raw uuids where kind names
 * belong. `useRequestFetch` because a bare `$fetch` carries no cookie server-side
 * and would 401 into an empty list, which renders identically to a tenant with no
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
 * The fetch above degrades to `[]` so one missing permission cannot blank the page,
 * which makes "no session kinds" and "you may not read session kinds" render
 * identically. The row uses this to say which one it is.
 *
 * A UI gate only; the server decides what is actually readable.
 */
const canReadKinds = useHasPermission('session_kind.read');

/**
 * Catalogue types with no row for this tenant. Surfaced, never hidden: the
 * evaluator only considers types the tenant has a row for, so this is exactly the
 * set of rules silently not running.
 *
 * This one DOES use `defaultConstraintTypes()`, unlike `entriesFor`: a deprecated
 * type with no row is not MISSING, and `backfill:constraints` will never create
 * one, so reporting it would send an operator to run a no-op repair.
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

/** The two alarm banners' key lists, so the template only reads a string. */
const missingTypeKeys = computed(() => missingTypes.value.map((type) => type.key).join(', '));
const unknownTypeKeys = computed(() => (
    [...new Set(unknownTypeRows.value.map((row) => row.type))].join(', ')
));

interface Entry { type: ConstraintTypeDef; row: ConstraintRow }

/**
 * DRIVEN BY `CONSTRAINT_TYPES`, NOT `defaultConstraintTypes()`. The latter excludes
 * deprecated types, correctly, because it answers "which types should a tenant be
 * SEEDED a row for?". Borrowing it here made a deprecated row invisible to every
 * branch at once: measured with one legacy `minimize_first_block` row,
 * `/api/constraints` returned 14 rows and the page rendered 13, while the rule was
 * still enabled and still being sent to the solver.
 *
 * A deprecated type with NO row stays hidden — show what a tenant HAS, never invite
 * them to adopt what is superseded.
 */
function entriesFor(severity: 'HARD' | 'SOFT', deprecated: boolean): Entry[] {
    const entries = CONSTRAINT_TYPES
        .filter((type) => (type.severity ?? 'HARD') === severity)
        .filter((type) => Boolean(type.deprecatedBy) === deprecated)
        .map((type) => {
            const row = defaultByType.value.get(type.key);

            return row ? { type, row } : null;
        })
        .filter((entry): entry is Entry => entry !== null);

    /*
     * Issue #8. A STABLE re-sort, not a filter: every rule stays fully
     * reachable and switchable in both modes, this only decides which ones a
     * tenant scrolls past first. `Array#sort` in V8 is stable, so entries
     * tying on suggestion (the common case in UNIVERSITY mode, where nothing
     * is deprioritised) keep the catalogue's own order.
     */
    return [...entries].sort((a, b) => {
        const aSuggested = isConstraintTypeSuggested(a.type.key, tenantMode.value) ? 0 : 1;
        const bSuggested = isConstraintTypeSuggested(b.type.key, tenantMode.value) ? 0 : 1;

        return aSuggested - bSuggested;
    });
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
/*
 * COLOURS COME FROM THE GENERATED TOKEN SET, not names invented here. This block
 * used `--error-color`, `--primary-color`, `--border-color` and
 * `--text-secondary-color`; none exist. `background: var(--primary-color)` had no
 * fallback, so the declaration was invalid and resolved to `transparent` — under
 * `color: #fff` the SOFT badge was white text on the page background, and the one
 * label distinguishing preferences from defects was unreadable.
 *
 * NOTE `varToRgba`, not `vartorgba`: Sass lookup is case-sensitive, so the lowercase
 * spelling survives into the emitted CSS as an unknown function and invalidates the
 * declaration. It is used in nine other components and is inert in every one.
 */
.cgrid {
    display: flex;
    flex-direction: column;
    gap: $space8;

    &_alarm {
        padding: $space6;
        border: 1px solid varToRgba('error500', 0.4);
        border-radius: $radiusMd;

        font-size: $fontSizeSm;
        line-height: 1.5;
        color: $error700;

        background: varToRgba('error500', 0.1);

        code {
            font-size: $fontSizeXs;
            overflow-wrap: anywhere;
        }
    }

    &_group {
        display: flex;
        flex-direction: column;
        gap: $space6;
    }

    &_head {
        h2 {
            display: flex;
            flex-wrap: wrap;
            gap: $space4;
            align-items: center;

            margin: 0;

            font-size: $fontSizeLg;
            color: $content2;
        }

        p {
            max-width: 68ch;
            margin: $space2 0 0;

            font-size: $fontSizeSm;
            line-height: 1.5;
            color: $content7;
        }
    }

    &_sev {
        padding: var(--space-1) $space4;
        border-radius: $radiusSm;

        font-size: $fontSizeXs;
        font-weight: 700;
        letter-spacing: 0.06em;

        &--hard {
            color: $error700;
            background: varToRgba('error500', 0.16);
        }

        &--soft {
            color: $warning700;
            background: varToRgba('warning500', 0.2);
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
        margin: $space2 0 0;

        font-size: $fontSizeXs;
        font-weight: 650;
        color: $surface7;
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }

    &_empty {
        margin: 0;
        padding: $space6;
        border: 1px dashed $surface4;
        border-radius: $radiusMd;

        font-size: $fontSizeSm;
        color: $content7;
    }
}
</style>
