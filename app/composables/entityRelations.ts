import type { EntityRow, ManageEntity, RelationDef } from '~/utils/manageRegistry';
import { relationOptionsUrl, relationReadRequirement } from '~/utils/manageRegistry';
import { satisfiesPermissionRequirement } from '#shared/permissions';
import { useSession } from '~/composables/session';

export type RelationRow = Record<string, unknown>;

/**
 * The join-table sets on one entity's detail page.
 *
 * OWNERSHIP BOUNDARY: relation membership and the option lists it is chosen
 * from. Not the entity's own scalar fields — that is `useEntityForm`, and the
 * two write to different endpoints.
 *
 * SAVES IMMEDIATELY, one PUT per change
 * -------------------------------------
 * Not part of the form's Save button, deliberately. The entity and each
 * relation are separate endpoints with no shared transaction, so a single Save
 * spanning them could half-succeed: an offering renamed but its groups
 * unchanged, with one error message covering both and no way to tell which
 * landed. Each PUT replaces one whole set atomically, so the worst case is
 * "that one change did not apply", said plainly next to the control.
 *
 * SYNCHRONOUS, and `ready` resolves only after the drafts are seeded — the same
 * shape as useEntityForm, for the same SSR reason (watchers do not flush during
 * SSR, so seeding cannot hang off one).
 */
export function useEntityRelations(entity: ManageEntity, id: string | undefined) {
    const request = useRequestFetch();
    const session = useSession();

    const held = new Set(session.value?.permissions ?? []);

    /**
     * Relations this caller may see at all.
     *
     * FILTERED HERE, BEFORE THE FETCH, and that is the whole point. The option
     * lists below are ONE `Promise.all`, so a single 403 inside it takes down
     * the entire wave — and because the page awaits the useAsyncData HANDLE,
     * which resolves rather than rejects, the result is not the blank page
     * CLAUDE.md's 6c rule describes but every picker on the page rendering an
     * EMPTY option list. Measured: a person editor's Person page then says "No
     * roles defined yet" over a tenant that has them.
     *
     * OMITTED, not degraded, per the same rule the schedule gate follows: a
     * missing picker is honest, an empty one asserts that nothing exists.
     *
     * The requirement is DERIVED from the resources each wave touches
     * (`relationReadRequirement`), so a relation cannot drift from its own gate
     * and a new one is covered by construction.
     *
     * Read synchronously at setup rather than through a computed: `defs` drives
     * the fetch, and permissions do not change while a page is open. Anything a
     * watcher seeds is undefined at first render on the server.
     */
    const defs: RelationDef[] = (entity.relations ?? []).filter(
        (def) => satisfiesPermissionRequirement(held, relationReadRequirement(def)),
    );

    /**
     * Whether this caller may WRITE one relation, as opposed to see it.
     *
     * UX only — the PUT re-checks. What it buys is not offering a control whose
     * every change answers 403, which is the same lie a disabled input tells
     * one step further along.
     */
    function canWrite(def: RelationDef): boolean {
        return satisfiesPermissionRequirement(held, def.writeRequiresPermissions ?? []);
    }

    const asyncData = useAsyncData(`manage-relations:${entity.key}:${id ?? 'new'}`, async () => {
        if (!defs.length || !id) {
            return {
                sets: {} as Record<string, RelationRow[]>,
                options: {} as Record<string, EntityRow[]>,
                parent: null as EntityRow | null,
            };
        }

        /**
         * A relation whose options are scoped by a field on the PARENT row needs
         * that field before it can build the option URL, so the parent is
         * fetched here rather than read from `useEntityForm`.
         *
         * Duplicating that one small request is deliberate. The page awaits both
         * composables in parallel, and reaching into the form's data would make
         * this one depend on the other's resolution order — reintroducing
         * exactly the SSR sequencing that `ready` was restructured to avoid.
         * Only fetched when some relation actually declares `scopeBy`.
         */
        const scoped = defs.some((def) => def.scopeBy);

        const [sets, parent] = await Promise.all([
            Promise.all(defs.map((def) => request<RelationRow[]>(`/api/${entity.key}/${id}/${def.key}`))),
            scoped ? request<EntityRow>(`/api/${entity.key}/${id}`) : Promise.resolve(null),
        ]);

        /**
         * Keyed by the full URL, not by resource name. Two relations can draw on
         * the same resource with different scoping — and deduplicating by
         * resource alone would serve one of them the other's narrowed list,
         * silently.
         */
        const optionUrls = new Map<string, string | null>();

        const urlFor = (resource: string, scopeBy?: RelationDef['scopeBy']) => {
            const value = scopeBy && parent ? parent[scopeBy.from] : undefined;

            // An absent scope value falls back to the UNFILTERED list rather
            // than sending `?termId=undefined`, which the resource schema would
            // reject as a 400 and turn a missing field into a blank picker.
            return value === undefined || value === null || value === ''
                ? `/api/${resource}`
                : `/api/${resource}?${scopeBy!.filter}=${encodeURIComponent(String(value))}`;
        };

        for (const [index, def] of defs.entries()) {
            /**
             * A SEARCHABLE relation fetches the rows it has, not the rows it
             * could have. Its picker asks the server per keystroke, so the only
             * thing this wave still owes it is a label for each row already
             * assigned — which is `?ids=`, and which is bounded by the
             * assignment rather than by the size of the tenant.
             *
             * This is the half of the feature that actually removes the cost.
             * Search alone would still have loaded every Person in the
             * institution to fill a list nobody then reads.
             */
            optionUrls.set(`${def.key}:main`, relationOptionsUrl(
                def,
                (sets[index] ?? []).map((row) => String(row[def.valueKey])),
                urlFor(def.resource, def.scopeBy),
            ));

            if (def.extraReference) {
                optionUrls.set(`${def.key}:extra`, urlFor(def.extraReference.resource));
            }
        }

        const uniqueUrls = [...new Set([...optionUrls.values()].filter((url): url is string => url !== null))];
        const fetched = await Promise.all(uniqueUrls.map((url) => request<EntityRow[]>(url)));
        const byUrl = new Map(uniqueUrls.map((url, index) => [url, fetched[index] ?? []]));

        return {
            sets: Object.fromEntries(defs.map((def, index) => [def.key, sets[index] ?? []])),
            // Kept so `searchParamsFor` can resolve `scopeBy` without a second
            // request; already fetched above whenever any relation is scoped.
            parent,
            options: Object.fromEntries(
                [...optionUrls].map(([slot, url]) => [slot, (url === null ? [] : byUrl.get(url)) ?? []]),
            ),
        };
    });

    /** Working copy per relation, so a failed PUT can be rolled back to the server's truth. */
    const drafts = ref<Record<string, RelationRow[]>>({});
    const busy = ref<Record<string, boolean>>({});
    const errors = ref<Record<string, string>>({});
    const saved = ref<Record<string, boolean>>({});
    /**
     * Advisory notes about what a SAVED set implies — distinct from `errors`,
     * which mean the write did not land. Keyed per relation, cleared on the next
     * write to that relation so a stale note cannot outlive the state it
     * described.
     */
    const warnings = ref<Record<string, string[]>>({});

    function seed() {
        const next: Record<string, RelationRow[]> = {};

        for (const def of defs) {
            next[def.key] = [...(asyncData.data.value?.sets[def.key] ?? [])];
        }

        drafts.value = next;
    }

    const ready = (async () => {
        await asyncData;
        seed();
    })();

    watch(asyncData.data, seed);

    const options = computed(() => asyncData.data.value?.options ?? {});

    function optionsFor(def: RelationDef): EntityRow[] {
        return options.value[`${def.key}:main`] ?? [];
    }

    function extraOptionsFor(def: RelationDef): EntityRow[] {
        return def.extraReference ? (options.value[`${def.key}:extra`] ?? []) : [];
    }

    /**
     * A searchable relation's `scopeBy`, in the form its picker can send.
     *
     * Resolved here because `scopeBy.from` names a field on the PARENT row,
     * which only this composable fetches. Returned as parameters rather than a
     * URL so the picker keeps owning `q` and `limit` — the two it varies.
     *
     * Empty today, since `persons` is the only searchable relation and it is
     * unscoped. It exists so that making a scoped relation searchable is one
     * flag rather than a silently unscoped search, which would offer a 2024
     * cohort's people on a 2027 Offering exactly the way `scopeBy` was added to
     * stop.
     */
    function searchParamsFor(def: RelationDef): Record<string, string> {
        const value = def.scopeBy ? asyncData.data.value?.parent?.[def.scopeBy.from] : undefined;

        return def.scopeBy && value !== undefined && value !== null && value !== ''
            ? { [def.scopeBy.filter]: String(value) }
            : {};
    }

    /** Writes the whole set. The server replaces it in one transaction. */
    async function persist(def: RelationDef, rows: RelationRow[]): Promise<void> {
        if (!id) {
            return;
        }

        const previous = [...(drafts.value[def.key] ?? [])];

        drafts.value = { ...drafts.value, [def.key]: rows };
        busy.value = { ...busy.value, [def.key]: true };
        errors.value = { ...errors.value, [def.key]: '' };
        warnings.value = { ...warnings.value, [def.key]: [] };
        saved.value = { ...saved.value, [def.key]: false };

        try {
            /**
             * Two shapes, both accepted. A relation declaring `warnAfterWrite`
             * returns `{ rows, warnings }`; every other one returns the bare
             * array it always did. Normalised here rather than branching per
             * relation, so the panel never has to know which kind it is holding.
             */
            const result = await request<RelationRow[] | { rows: RelationRow[]; warnings: string[] }>(
                `/api/${entity.key}/${id}/${def.key}`,
                { method: 'PUT', body: rows },
            );

            const returned = Array.isArray(result) ? result : result.rows;
            const notes = Array.isArray(result) ? [] : (result.warnings ?? []);

            // Adopt what came BACK, not what was sent: the server is the
            // authority on the resulting set, and a silent divergence between
            // the two is exactly what an optimistic update hides.
            drafts.value = { ...drafts.value, [def.key]: returned };
            warnings.value = { ...warnings.value, [def.key]: notes };
            saved.value = { ...saved.value, [def.key]: true };
        } catch (error) {
            // Roll back rather than leave the UI showing a membership the
            // database refused.
            drafts.value = { ...drafts.value, [def.key]: previous };
            errors.value = {
                ...errors.value,
                [def.key]: (error as { statusMessage?: string }).statusMessage ?? 'Could not save that change.',
            };
        } finally {
            busy.value = { ...busy.value, [def.key]: false };
        }
    }

    function add(def: RelationDef, value: string) {
        const rows = drafts.value[def.key] ?? [];

        if (rows.some((row) => String(row[def.valueKey]) === value)) {
            return;
        }

        void persist(def, [...rows, { [def.valueKey]: value }]);
    }

    function remove(def: RelationDef, value: string) {
        const rows = drafts.value[def.key] ?? [];

        void persist(def, rows.filter((row) => String(row[def.valueKey]) !== value));
    }

    /** Per-row extras: a quantity, or the scheduling role a lecturer fills. */
    function setExtra(def: RelationDef, value: string, key: string, extra: unknown) {
        const rows = drafts.value[def.key] ?? [];

        void persist(def, rows.map((row) => (String(row[def.valueKey]) === value
            ? { ...row, [key]: extra }
            : row)));
    }

    return {
        defs,
        canWrite,
        drafts,
        busy,
        errors,
        warnings,
        saved,
        optionsFor,
        extraOptionsFor,
        searchParamsFor,
        add,
        remove,
        setExtra,
        pending: computed(() => asyncData.pending.value),
        ready,
    };
}
