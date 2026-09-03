import type { PermissionRequirement } from '#shared/permissions';
import { resourcePermissions } from '#shared/permissions';
import { MAX_ROOMS_PER_SESSION } from '#shared/rooms';
import { SESSION_KIND_TYPES, SESSION_KIND_TYPE_HELP, SESSION_KIND_TYPE_LABELS } from '#shared/sessionKindType';
import type { TenantMode } from '#shared/tenantMode';
import { offeringFieldsToDeemphasize } from '#shared/tenantMode';
import type { Translate } from '~/composables/i18n';
import { searchKeywords } from '~/utils/i18nKeywords';

/**
 * The management area's entity registry: a client mirror of the server's
 * `RESOURCES`.
 *
 * A MIRROR AND NOT A FETCH because the server registry holds zod schemas, which
 * do not serialise, and what the UI needs is different anyway. The server stays
 * the authority on validity; this file on presentation.
 *
 * ALSO THE NAVIGATION SOURCE: `useNavEntries()` projects the manage section out
 * of this array, so adding an entity here puts it in the sidebar, index, header
 * and palette in one edit. Entities appear only once they have a working editor:
 * an entry whose detail page cannot edit the entity is a nav item that lies.
 *
 * A FUNCTION OF `t`, NOT A CONST (issue #19)
 *
 * `manageEntities(t)` BUILDS the array; every copy-bearing field is still a
 * plain resolved `string` when a reader gets it. That is the shape
 * `i18n/CONVENTIONS.md` § "Copy in plain `.ts` modules" prescribes, and here
 * it is not merely the preferred one, it is the only one that works. Two
 * properties of this file decide it:
 *
 *   1. THE ~26 ARROW-FUNCTION FIELDS. `title(row)`, `optionLabel(row)`,
 *      `reference.label(row)`, `derived.describe(data)` and
 *      `startFromTemplate.label(row)` interpolate TENANT DATA, which is never
 *      translated, with an APP-AUTHORED fallback, which always is. A message
 *      key cannot express that, so a per-field `labelKey` would have forced
 *      these to `(row, t) => string` and pushed the translator into every
 *      component that calls one. Inside a builder they close over `t` and
 *      their signatures do not change at all.
 *
 *   2. `FieldDef` AND `RelationDef` ARE NOT ONLY OURS. `ScheduleInspector.vue`
 *      and `ScheduleEventForm.vue` construct `RelationDef` literals of their
 *      own and hand them to `ManageRelationPicker`, and their copy belongs to
 *      the `schedule` namespace, not this one. Turning `RelationDef.label`
 *      into a `MessageKey` would have demanded `schedule.*` keys that do not
 *      exist yet, from an agent that does not own them; leaving it a `string`
 *      leaves those call sites, and every component that renders one,
 *      untouched.
 *
 * So the rule this file follows, uniformly: **`t` is threaded into the builder,
 * and every field of the built structure is a resolved `string` or a function
 * of ROW DATA ALONE.** No field is a key, none takes a translator, and there is
 * no mixed case to reason about at a call site.
 *
 * The one thing a builder cannot serve is a caller with no translator, which
 * is what `manageSections()` at the bottom of this file exists for; see its
 * own comment.
 */

export type EntityRow = Record<string, unknown>;

export type FieldType =
    | 'text'
    | 'email'
    | 'textarea'
    | 'number'
    | 'boolean'
    | 'date'
    | 'select'
    | 'reference'
    | 'color'
    /** Structured value a bespoke component owns (Constraint.params). */
    | 'json';

export interface FieldDef {
    key: string;
    label: string;
    type: FieldType;
    /** Shown under the control. Use it for domain meaning, not restating the label. */
    help?: string;
    /**
     * A read-only value COMPUTED server-side, shown beneath the control while
     * editing. Exists because `Offering.requiredCapacity` promised to derive from
     * the attached Groups when left blank and nothing did: the gap survived
     * because the real number was never on screen.
     *
     * Generic on purpose: making Offering bespoke for one read-only line would
     * contradict the standing decision that it renders on the generic scaffold.
     */
    derived?: {
        /** Path with `:id` substituted for the row being edited. */
        path: string;
        /** Turns the response into one line of prose. */
        describe: (data: Record<string, unknown>) => string;
    };
    required?: boolean;
    /**
     * Settable at create time only, because the server's `update` schema omits
     * it. Rendering it as an editable field on an existing row would produce a
     * form whose value is silently discarded on save.
     */
    createOnly?: boolean;
    /**
     * Part of the record, but rendered by a bespoke detail component rather than
     * the generic field list.
     *
     * This is what keeps "bespoke" down to one slot: the field still takes part
     * in draft seeding, dirty tracking, payload building and server-error
     * mapping, all of which stay in `useEntityForm`, and only its CONTROL is
     * hand-written. A field left out of the registry entirely would be missing
     * from the draft and silently dropped on save.
     */
    custom?: boolean;
    /** Fixed options, for `select`. */
    options?: { value: string | number; label: string }[];
    /** Which entity to look up, for `reference`. */
    reference?: {
        /** API resource segment, e.g. 'time-grids'. Need not be a managed entity. */
        resource: string;
        label: (row: EntityRow) => string;
        /** Renders an explicit "none" option. */
        nullable?: boolean;
        /** Blank-state text when the referenced entity has no rows yet. */
        emptyHint?: string;
    };
    min?: number;
    max?: number;
    placeholder?: string;
}

export interface ColumnDef {
    key: string;
    label: string;
    format?: 'text' | 'code' | 'boolean' | 'date' | 'number' | 'weekdays' | 'swatch';
    /** Dropped on narrow viewports rather than squeezed. */
    secondary?: boolean;
}

/**
 * A join table hanging off this entity, edited as a SET.
 *
 * Declaring these as data is what stops Offering (which references a Term, a
 * Kind, a Role, plus Groups, Lecturers and Equipment) from needing a bespoke
 * page. It is the hub of the model, but nothing about editing it is structurally
 * new; only the number of relations is.
 */
/**
 * A Person's display name, from either shape it arrives in.
 *
 * TWO SOURCES, ONE LABEL, and a searchable picker mixes them in a single list:
 * `/api/persons` returns the name in parts, while the schedule page's directory
 * pre-composes `name` for the grid's own lookups. A label function written for
 * one renders `"undefined undefined"` for the other, silently, since both are
 * `EntityRow` and neither typechecks the field it reads.
 *
 * TAKES NO TRANSLATOR, unlike the copy-bearing label functions in the builder
 * below, and that is not an oversight: every branch here renders TENANT DATA,
 * and the last one renders an id. There is no app-authored word in it.
 */
export function personOptionLabel(row: EntityRow): string {
    if (typeof row.name === 'string' && row.name.trim()) {
        return row.name;
    }

    const composed = [row.givenName, row.familyName].filter(Boolean).join(' ').trim();

    // An unresolvable row shows its id rather than an empty cell, matching
    // `ManageRelationPicker.labelFor`: a missing name is something to see.
    return composed || String(row.id);
}

/**
 * Where a relation's option wave should fetch its rows, or `null` for
 * "make no request at all".
 *
 * PURE, AND HERE RATHER THAN INLINE IN `useEntityRelations`, because the
 * property it encodes is invisible in the DOM: a searchable picker renders
 * identically whether the parent fetched three rows or three thousand. Nothing
 * a rendered page can assert would notice the difference, so the decision is
 * pulled out to where a test can address it directly.
 *
 * `assignedIds` is ignored for a non-searchable relation, which fetches the
 * whole candidate list as it always has.
 */
export function relationOptionsUrl(
    def: RelationDef,
    assignedIds: string[],
    fullListUrl: string,
): string | null {
    if (!def.searchable) {
        return fullListUrl;
    }

    const ids = [...new Set(assignedIds.filter(Boolean))];

    // Nothing assigned means nothing to label, and `?ids=` with an empty list
    // is a deliberate 400, so the answer is known without asking.
    return ids.length
        ? `/api/${def.resource}?ids=${ids.map(encodeURIComponent).join(',')}`
        : null;
}

export interface RelationDef {
    /** Path segment: /api/{entity}/{id}/{key}. Must exist in server RELATIONS. */
    key: string;
    label: string;
    help?: string;
    /** Resource supplying the choices. */
    resource: string;
    /** Column on the join row holding the chosen row's id. */
    valueKey: string;
    optionLabel: (row: EntityRow) => string;
    /** Renders options with their hierarchy visible (Groups). */
    indentTree?: boolean;
    /**
     * Choose from a SERVER-SIDE SEARCH instead of a pre-fetched option list.
     *
     * Set it when the referenced resource can plausibly hold thousands of rows.
     * It changes what `options` means for this relation (see the prop's own
     * comment on `ManageRelationPicker`), so it is not a cosmetic flag: the
     * parent must supply labels for the assigned rows and nothing else.
     *
     * REQUIRES `searchFields` on the resource server-side, or `?q=` answers 400
     * rather than returning everything. `persons`, `groups`, `rooms`,
     * `offerings`, `roles` and `equipment` all declare them today.
     *
     * NOT COMPATIBLE WITH `indentTree`, and `tests/relation-picker-search.test.ts`
     * fails if any relation declares both rather than leaving the picker to
     * silently prefer one: a tree needs every ancestor of a match in order to
     * draw the match at all, which a `q=` page does not return. Groups stay on
     * the full list until that query exists.
     */
    searchable?: boolean;
    /** Per-row count, for countable equipment. */
    quantity?: { key: string; label: string };
    /**
     * Per-row reference to a second entity: currently only a lecturer's
     * SCHEDULING role (TAXONOMY.md §2), which is vocabulary, never permissions.
     */
    extraReference?: {
        key: string;
        resource: string;
        label: (row: EntityRow) => string;
        placeholder: string;
    };
    emptyHint?: string;
    /**
     * Advisory shown when NOTHING IS ASSIGNED: a different question from
     * `emptyHint`, which explains why the option list is empty.
     *
     * Exists because an empty set is ambiguous in exactly the way this codebase
     * keeps getting caught by: "deliberately unprivileged" and "nobody got round
     * to it" render identically, so the second is invisible. Only `access-roles`
     * declares one today, because it is the only relation whose empty state means
     * a person can sign in and be shown nothing.
     *
     * Phrase it as a FACT, not an instruction: it renders in read-only mode too,
     * for a viewer who cannot act on it. And never name a specific role:
     * AccessRole keys are tenant vocabulary (CLAUDE.md: never hardcode an open
     * value into logic), so there is no role this string is allowed to assume
     * exists.
     */
    emptyWarning?: string;
    /**
     * What makes this relation EDITABLE. Absent means the parent's `.update`.
     *
     * Separate from VISIBILITY (derived; see `relationReadRequirement`): seeing
     * which roles somebody holds rides on `person.read`, while granting one is
     * `person_access_role.assign`. Collapsing them would either hide information
     * a person editor may see or offer a control whose every change answers 403.
     *
     * Declared because it is not derivable: nothing about `resource:
     * 'access-roles'` says that writing this join needs a capability from a
     * different part of the catalogue.
     */
    writeRequiresPermissions?: PermissionRequirement;
    /**
     * Narrow the option list by a field on the row being edited.
     *
     * `{ filter: 'termId', from: 'termId' }` fetches
     * `/api/groups?termId=<the Offering's termId>` instead of `/api/groups`, so
     * an Offering's Group picker offers the cohorts that belong to its Term
     * plus the ones scoped to no Term at all.
     *
     * Fetched with the filter rather than filtered client-side, because
     * "scoped to this Term OR scoped to none" is a relation query the client
     * cannot answer from a flat row list: it would need each Group's scope
     * rows, which is the request it is trying to avoid.
     */
    scopeBy?: { filter: string; from: string };
}

export interface ManageEntity {
    /** Route segment AND API resource name, deliberately the same string. */
    key: string;
    /** Permission prefix from the server catalogue, e.g. 'person'. */
    permissionPrefix: string;
    /**
     * Actions whose permission is NOT `<permissionPrefix>.<action>`.
     *
     * `access-roles` is the only entity that needs it: `access_role.manage` covers
     * all four verbs, and inventing four CRUD permissions would mean a catalogue
     * edit, a re-seed and a backfill on every tenant to arrive at
     * `access_role.manage` still checked by nothing.
     *
     * Mirrors the server's RESOURCE_PERMISSIONS with one difference: the server
     * also accepts `person_access_role.assign` for the READ, so a registrar's role
     * picker works, while the manage SECTION stays `access_role.manage`-only.
     */
    permissionOverrides?: Partial<Record<'read' | 'create' | 'update' | 'delete', string>>;
    label: string;
    plural: string;
    icon: string;
    /** One line, shown on the section card and as the palette subtitle. */
    description: string;
    /**
     * Extra terms the Ctrl+K fuzzy match should hit.
     *
     * Translated AND keeping their English terms, merged by `searchKeywords()`
     * (`~/utils/i18nKeywords`), never by hand: two implementations of "the
     * translated list plus the English aliases, deduped" drift on the delimiter
     * or the dedupe and the only symptom is a search that stops finding one
     * section. Never shown is not never read.
     */
    keywords: string[];
    /** Row → human title. Used in lists, delete confirmations and page titles. */
    title: (row: EntityRow) => string;
    columns: ColumnDef[];
    fields: FieldDef[];
    /**
     * True when a Federation can own rows of this entity (TAXONOMY.md §2).
     * Such rows are readable but not writable (the RLS write policy is
     * tenant-only), so the list marks them and the detail renders read-only.
     */
    federationOwnable?: boolean;
    /**
     * Column marking rows provisioning created and the tenant must not delete
     * (Role.isSystem, AccessRole.isSystem).
     */
    systemFlag?: string;
    /**
     * Fields to collapse behind "More fields" for the given tenant mode
     * (issue #8): a UI/UX bias only, never a change to what is stored or
     * required. Absent means no field is ever de-emphasised, which is the
     * correct answer for every entity except Offering today.
     *
     * A function of `TenantMode` rather than a flat set, so a mode's meaning
     * lives in `shared/tenantMode.ts`, the one place a role author or this
     * file's own reviewer needs to check the classification, instead of
     * being duplicated per entity here.
     */
    advancedFieldsForMode?: (mode: TenantMode) => ReadonlySet<string>;
    /**
     * Issue #8: an optional "start from a template" picker shown above the
     * CREATE form. Copies field VALUES from the chosen row onto the draft
     * once, at selection time: never a live link, and never anything this
     * entity's own save path treats differently afterward. Only Offering
     * declares this today; kept generic (a resource, a label and an `apply`
     * function) so a future entity can reuse the same picker rather than
     * this becoming Offering-specific machinery.
     */
    startFromTemplate?: {
        /** API resource the picker fetches candidates from. */
        resource: string;
        label: (row: EntityRow) => string;
        /** Mutates `draft` in place with the chosen row's shape. */
        apply: (row: EntityRow, draft: Record<string, unknown>) => void;
        /** Gates the picker's own fetch: absent permission hides it rather than 403ing. */
        readPermission: string;
    };
    /**
     * The reverse of `startFromTemplate`: capture an EXISTING row's shape into a
     * new template, shown on the EDIT page only (a template needs values to
     * copy, and the create page has none yet). Kept generic for the same
     * reason `startFromTemplate` is: a resource, a permission and a builder
     * function, not Offering-specific machinery, even though Offering is the
     * only declarer today.
     */
    saveAsTemplate?: {
        /** API resource the new template is created against. */
        resource: string;
        /** Row → template creation payload. Only the fields worth fixing. */
        buildTemplate: (row: EntityRow) => Record<string, unknown>;
        /** Gates the action: absent permission hides it rather than 403ing. */
        createPermission: string;
    };
    /** Bespoke detail body, resolved by name. Generic form when absent. */
    detailComponent?: string;
    /**
     * Bespoke LIST body, for an entity whose rows do not read as a flat table.
     * Only Group needs this: a hierarchy shown as a flat list loses the one
     * property that makes it a hierarchy.
     */
    listComponent?: string;
    /**
     * Rows per page. Raised for entities whose list view needs the whole set to
     * be correct (a tree cannot be assembled from page 1 of 4). The list still
     * reports honestly when it did not receive everything.
     */
    listPageSize?: number;
    /**
     * Suppresses the list header's "New <entity>" button.
     *
     * For an entity whose rows are PROVISIONED rather than collected (the
     * constraint catalogue), a prominent "New" action frames a fixed set of
     * switches as a collection you populate, which is how tenants ended up with
     * types that had no row and were therefore never evaluated. Creation is
     * still reachable (a scoped variant, from within its type's row); it is
     * just not the primary verb.
     */
    hideCreateAction?: boolean;
    /** Join tables edited as sets on the detail page. */
    relations?: RelationDef[];
}

/**
 * The Offering fields a template shape can fix, shared by both directions of
 * the copy: `startFromTemplate.apply` reads a template ONTO a new Offering's
 * draft, `saveAsTemplate.buildTemplate` reads an Offering INTO a new
 * template. One list, so the two can never silently name a different shape.
 */
const OFFERING_TEMPLATE_SHAPE_FIELDS = [
    'title', 'kindId', 'code', 'color', 'frequency', 'durationBlocks',
    'schedulingPattern', 'requiredRoleId', 'requiredCapacity',
    'requiredRoomCount', 'requiredLecturerCount', 'onlineMode', 'notes',
] as const;

export function offeringEntity(t: Translate): ManageEntity {
    return {
        key: 'offerings',
        permissionPrefix: 'offering',
        label: t('manage.offering.label'),
        plural: t('manage.offering.plural'),
        icon: 'material-symbols:book-outline',
        description: t('manage.offering.description'),
        keywords: searchKeywords(t, 'manage.offering.keywords', [
            'offering', 'course', 'module', 'subject', 'demand', 'curriculum', 'lecture',
        ]),
        federationOwnable: true,
        advancedFieldsForMode: offeringFieldsToDeemphasize,
        startFromTemplate: {
            resource: 'offering-templates',
            label: (row) => String(row.name ?? t('manage.offering.startFromTemplate.fallback')),
            readPermission: 'offering_template.read',
            apply: (row, draft) => {
                /*
                 * SKIP NULL, DO NOT COERCE. A template field left blank means
                 * "let whoever creates the offering decide": copying a coerced
                 * '' or 0 over the freshly-seeded draft would silently overwrite
                 * that choice with a value nobody chose.
                 */
                for (const key of OFFERING_TEMPLATE_SHAPE_FIELDS) {
                    const value = row[key];

                    if (value !== null && value !== undefined) {
                        draft[key] = value;
                    }
                }

                // Informational only; see `Offering.createdFromTemplateId`'s
                // own comment. Nothing ever reads this back to resolve a field.
                draft.createdFromTemplateId = row.id;
            },
        },
        saveAsTemplate: {
            resource: 'offering-templates',
            createPermission: 'offering_template.create',
            // The reverse copy: same fields, same reasoning about null meaning
            // "not fixed", just read from an Offering instead of written to one.
            buildTemplate: (row) => Object.fromEntries(
                OFFERING_TEMPLATE_SHAPE_FIELDS
                    .map((key) => [key, row[key] ?? null] as const),
            ),
        },
        /*
         * THE FALLBACK IS THE ENTITY'S OWN NAME, resolved from the same key
         * `label` reads rather than a second message saying the same word. An
         * untitled row reading "Offering" is not a coincidence to be
         * maintained in two places: it is the answer "we know what KIND of
         * thing this is and nothing else", and every one of the sixteen
         * entities below gives it the same way.
         */
        title: (row) => [row.code, row.title].filter(Boolean).join(' · ') || t('manage.offering.label'),
        columns: [
            { key: 'code', label: t('common.field.code'), format: 'code' },
            { key: 'title', label: t('manage.offering.column.title') },
            { key: 'color', label: t('common.field.colour'), format: 'swatch' },
            { key: 'frequency', label: t('manage.offering.column.frequency'), format: 'number' },
            { key: 'durationBlocks', label: t('manage.offering.column.durationBlocks'), format: 'number' },
            { key: 'isActive', label: t('common.field.active'), format: 'boolean' },
        ],
        fields: [
            { key: 'title', label: t('manage.offering.field.title.label'), type: 'text', required: true },
            { key: 'code', label: t('common.field.code'), type: 'text' },
            {
                key: 'color',
                label: t('common.field.colour'),
                type: 'color',
                help: t('manage.offering.field.color.help'),
            },
            {
                key: 'termId',
                label: t('manage.offering.field.termId.label'),
                type: 'reference',
                required: true,
                // The server's update schema omits termId: moving an Offering between
                // terms would orphan its placed Sessions, which belong to a term.
                createOnly: true,
                reference: {
                    resource: 'terms',
                    label: (row) => String(row.name),
                    emptyHint: t('manage.offering.field.termId.emptyHint'),
                },
            },
            {
                key: 'kindId',
                label: t('manage.offering.field.kindId.label'),
                type: 'reference',
                required: true,
                reference: {
                    resource: 'session-kinds',
                    label: (row) => String(row.name ?? row.key),
                    emptyHint: t('manage.offering.field.kindId.emptyHint'),
                },
            },
            {
                key: 'frequency',
                label: t('manage.offering.field.frequency.label'),
                type: 'number',
                min: 1,
                help: t('manage.offering.field.frequency.help'),
            },
            {
                key: 'durationBlocks',
                label: t('manage.offering.field.durationBlocks.label'),
                type: 'number',
                min: 1,
                help: t('manage.offering.field.durationBlocks.help'),
            },
            {
                key: 'schedulingPattern',
                label: t('manage.offering.field.schedulingPattern.label'),
                type: 'select',
                /*
                 * NOT `required`, and the blank option is not "none". It is
                 * UNCLASSIFIED, which is where every existing offering starts and
                 * the honest answer for one nobody has decided about. Making this
                 * required would force a choice at the point of least information,
                 * and prefilling "every week" would write the common assumption in
                 * as though somebody had chosen it.
                 *
                 * The option KEYS are semantic, not the stored values: `''` is
                 * not a legal message-key segment, so the three options are
                 * keyed `notDecided`/`distributed`/`block` and the `value` a
                 * viewer never sees stays exactly what the server accepts.
                 */
                options: [
                    { value: '', label: t('manage.offering.field.schedulingPattern.option.notDecided') },
                    { value: 'DISTRIBUTED', label: t('manage.offering.field.schedulingPattern.option.distributed') },
                    { value: 'BLOCK', label: t('manage.offering.field.schedulingPattern.option.block') },
                ],
                help: t('manage.offering.field.schedulingPattern.help'),
            },
            {
                key: 'requiredRoleId',
                label: t('manage.offering.field.requiredRoleId.label'),
                type: 'reference',
                help: t('manage.offering.field.requiredRoleId.help'),
                reference: {
                    resource: 'roles',
                    label: (row) => String(row.name ?? row.key),
                    nullable: true,
                    emptyHint: t('manage.offering.field.requiredRoleId.emptyHint'),
                },
            },
            {
                key: 'requiredLecturerCount',
                label: t('manage.offering.field.requiredLecturerCount.label'),
                type: 'number',
                min: 1,
                help: t('manage.offering.field.requiredLecturerCount.help'),
            },
            {
                key: 'requiredRoomCount',
                label: t('manage.offering.field.requiredRoomCount.label'),
                type: 'number',
                min: 1,
                /*
                 * THE CEILING IS STATED, NOT DISCOVERED. Past
                 * `MAX_ROOMS_PER_SESSION` the solver refuses the whole input rather
                 * than degrading, so the failure is not "this offering scheduled
                 * badly": it is every run failing for the tenant, reported against
                 * an offering edited weeks earlier.
                 *
                 * The help text also names the SUMMING reading, because the
                 * alternative ("each room must hold the whole group") is a coherent
                 * thing to want, gives the opposite answer on the same input, and
                 * is not what this does. Left unsaid, a timetabler would only find
                 * out from a timetable that looks wrong.
                 *
                 * The ceiling reaches the sentence as a NAMED PLACEHOLDER rather
                 * than by concatenation: a translator must be able to move it,
                 * and German puts it somewhere else.
                 */
                max: MAX_ROOMS_PER_SESSION,
                help: t('manage.offering.field.requiredRoomCount.help', { max: MAX_ROOMS_PER_SESSION }),
            },
            {
                key: 'requiredCapacity',
                label: t('manage.offering.field.requiredCapacity.label'),
                type: 'number',
                min: 0,
                help: t('manage.offering.field.requiredCapacity.help'),
                derived: {
                    path: '/api/offering-capacity/:id',
                    describe: (data) => {
                        const capacity = data.capacity as number | null;
                        const basis = data.basis as string;
                        const groups = data.attachedGroups as number;

                        if (capacity === null) {
                            return groups === 0
                                ? t('manage.offering.field.requiredCapacity.derived.noGroups')
                                : t('manage.offering.field.requiredCapacity.derived.noSize');
                        }

                        /*
                         * `person`/`people` and `group`/`groups` are vue-i18n
                         * PLURAL FORMS of one message, not a word patched into
                         * a sentence: German has no `-s` plural, so a suffix
                         * flip is never a translation, and a word split across
                         * an expression has no key at all.
                         */
                        const source = basis === 'membership'
                            ? t('manage.offering.field.requiredCapacity.derived.basisMembership', capacity)
                            : t('manage.offering.field.requiredCapacity.derived.basisExpected');

                        const line = t(
                            'manage.offering.field.requiredCapacity.derived.line',
                            { capacity, count: groups, source },
                            groups,
                        );

                        /*
                         * The warning belongs HERE, next to the decision it affects.
                         * A capacity of 4 where 96 are expected is still the honest
                         * count, but someone leaving this field blank on that basis
                         * should see why the number looks small before a room turns
                         * out to be far too small.
                         *
                         * Two complete sentences joined by a space, rather than
                         * one message interpolating the other: a translator
                         * reading `{line}` cannot see what it holds.
                         */
                        if (data.partialEnrolment) {
                            const warning = t('manage.offering.field.requiredCapacity.derived.warning', {
                                capacity,
                                estimate: data.estimate as number,
                            });

                            return `${line} ${warning}`;
                        }

                        return line;
                    },
                },
            },
            {
                key: 'onlineMode',
                label: t('manage.offering.field.onlineMode.label'),
                type: 'select',
                /*
                 * THREE ANSWERS, AND THE THIRD IS NOT A STRONGER SECOND. The
                 * boolean this replaced could only say "permitted"; "Online
                 * only" is a different claim, and the copy has to keep them
                 * apart, because a timetabler reading the required option as
                 * "online allowed" gets a term of physical placements and no
                 * indication anything was ignored.
                 *
                 * NO BLANK OPTION, unlike `schedulingPattern` above: the column
                 * is NOT NULL and there is no "undecided" here. Every offering
                 * that predates this field is FORBIDDEN, which is a real answer
                 * rather than an absence.
                 */
                options: [
                    { value: 'FORBIDDEN', label: t('manage.offering.field.onlineMode.option.forbidden') },
                    { value: 'ALLOWED', label: t('manage.offering.field.onlineMode.option.allowed') },
                    { value: 'REQUIRED', label: t('manage.offering.field.onlineMode.option.required') },
                ],
                help: t('manage.offering.field.onlineMode.help'),
            },
            { key: 'isActive', label: t('common.field.active'), type: 'boolean' },
            { key: 'notes', label: t('manage.offering.field.notes.label'), type: 'textarea' },
            /*
             * NEVER RENDERED: `custom: true` with no bespoke component to supply
             * a control, which is deliberate here rather than the usual
             * "picker lives in the detail component" reading of that flag.
             * `startFromTemplate.apply()` is the only writer, so the field still
             * has to be declared to take part in the draft and the save payload
             * at all (an undeclared key is silently dropped; see `splitChildren`
             * on the server and `useEntityForm.save()`'s per-field loop here).
             *
             * Keyed all the same: "never rendered" is a property of today's
             * components, not a promise, and a label nobody translated is how
             * the next one ships in English.
             */
            {
                key: 'createdFromTemplateId',
                label: t('manage.offering.field.createdFromTemplateId.label'),
                type: 'text',
                custom: true,
                createOnly: true,
            },
        ],
        relations: [
            {
                key: 'groups',
                label: t('manage.offering.relation.groups.label'),
                help: t('manage.offering.relation.groups.help'),
                resource: 'groups',
                valueKey: 'groupId',
                indentTree: true,
                optionLabel: (row) => String(row.name),
                // The Offering's own term. Without this the picker offered every
                // cohort the tenant has ever had, so nothing stopped attaching a
                // 2024 cohort to a 2027 Offering.
                scopeBy: { filter: 'termId', from: 'termId' },
                emptyHint: t('manage.offering.relation.groups.emptyHint'),
            },
            {
                key: 'lecturers',
                label: t('manage.offering.relation.lecturers.label'),
                help: t('manage.offering.relation.lecturers.help'),
                resource: 'persons',
                valueKey: 'personId',
                searchable: true,
                optionLabel: personOptionLabel,
                extraReference: {
                    key: 'roleId',
                    resource: 'roles',
                    label: (row) => String(row.name ?? row.key),
                    placeholder: t('manage.offering.relation.lecturers.rolePlaceholder'),
                },
                emptyHint: t('manage.offering.relation.lecturers.emptyHint'),
            },
            {
                key: 'equipment',
                label: t('manage.offering.relation.equipment.label'),
                help: t('manage.offering.relation.equipment.help'),
                resource: 'equipment',
                valueKey: 'equipmentId',
                optionLabel: (row) => String(row.name ?? row.key),
                quantity: { key: 'quantity', label: t('manage.offering.relation.equipment.quantity') },
                emptyHint: t('manage.offering.relation.equipment.emptyHint'),
            },
            {
                /*
                 * THE ROOM PIN (issue #123): "only these rooms", never
                 * "preferred rooms". There is no soft reading of this control:
                 * the set is ANDed with every other eligibility filter, so an
                 * over-narrow pin is an offering that cannot be placed at all.
                 * The label and help text carry that, because nothing else in
                 * the form can.
                 *
                 * `searchable`: a university's room inventory is one of the two
                 * lists here that plausibly runs to thousands (persons is the
                 * other), and `rooms` declares `searchFields`, which the flag
                 * requires.
                 */
                key: 'rooms',
                label: t('manage.offering.relation.rooms.label'),
                help: t('manage.offering.relation.rooms.help'),
                resource: 'rooms',
                valueKey: 'roomId',
                searchable: true,
                // `code — name`, the way a timetabler names a room out loud:
                // "A101" identifies it and "Lecture Hall" says which one that
                // is. Same order the solver's own room label uses.
                optionLabel: (row) => [row.code, row.name].filter(Boolean).join(' — '),
                emptyHint: t('manage.offering.relation.rooms.emptyHint'),
            },
        ],
    };
}

/**
 * Issue #8. A REUSABLE SHAPE, structurally mirroring `defaultConstraintRow`
 * (`shared/constraintTypes.ts`), a stored shape a new row is seeded from,
 * except tenant-authored, so it is a resource here rather than a catalogue
 * function.
 *
 * Every field is optional and there is no `required: true` anywhere below,
 * unlike `offeringEntity()`: a template states only the part of the shape it
 * wants to fix, and a blank field leaves that decision to whoever creates an
 * Offering from it. `createOnly` is absent for the same reason it is absent
 * from most of Offering's own fields: nothing here is an identifier fixed
 * at creation, just a value that may or may not be copied later.
 */
export function offeringTemplateEntity(t: Translate): ManageEntity {
    return {
        key: 'offering-templates',
        permissionPrefix: 'offering_template',
        label: t('manage.offeringTemplate.label'),
        plural: t('manage.offeringTemplate.plural'),
        icon: 'material-symbols:content-copy-outline',
        description: t('manage.offeringTemplate.description'),
        keywords: searchKeywords(t, 'manage.offeringTemplate.keywords', [
            'template', 'offering', 'shape', 'reuse', 'preset', 'copy',
        ]),
        title: (row) => String(row.name ?? t('manage.offeringTemplate.label')),
        columns: [
            { key: 'name', label: t('common.field.name') },
            { key: 'title', label: t('manage.offeringTemplate.column.title'), secondary: true },
            { key: 'frequency', label: t('manage.offeringTemplate.column.frequency'), format: 'number' },
            { key: 'durationBlocks', label: t('manage.offeringTemplate.column.durationBlocks'), format: 'number' },
        ],
        fields: [
            {
                key: 'name',
                label: t('manage.offeringTemplate.field.name.label'),
                type: 'text',
                required: true,
                help: t('manage.offeringTemplate.field.name.help'),
            },
            {
                key: 'title',
                label: t('manage.offeringTemplate.field.title.label'),
                type: 'text',
                help: t('manage.offeringTemplate.field.title.help'),
            },
            {
                key: 'kindId',
                label: t('manage.offeringTemplate.field.kindId.label'),
                type: 'reference',
                reference: {
                    resource: 'session-kinds',
                    label: (row) => String(row.name ?? row.key),
                    nullable: true,
                    emptyHint: t('manage.offeringTemplate.field.kindId.emptyHint'),
                },
            },
            { key: 'code', label: t('common.field.code'), type: 'text' },
            { key: 'color', label: t('common.field.colour'), type: 'color' },
            {
                key: 'frequency',
                label: t('manage.offeringTemplate.field.frequency.label'),
                type: 'number',
                min: 1,
            },
            {
                key: 'durationBlocks',
                label: t('manage.offeringTemplate.field.durationBlocks.label'),
                type: 'number',
                min: 1,
            },
            {
                key: 'schedulingPattern',
                label: t('manage.offeringTemplate.field.schedulingPattern.label'),
                type: 'select',
                options: [
                    { value: '', label: t('manage.offeringTemplate.field.schedulingPattern.option.notDecided') },
                    {
                        value: 'DISTRIBUTED',
                        label: t('manage.offeringTemplate.field.schedulingPattern.option.distributed'),
                    },
                    { value: 'BLOCK', label: t('manage.offeringTemplate.field.schedulingPattern.option.block') },
                ],
            },
            {
                key: 'requiredRoleId',
                label: t('manage.offeringTemplate.field.requiredRoleId.label'),
                type: 'reference',
                help: t('manage.offeringTemplate.field.requiredRoleId.help'),
                reference: {
                    resource: 'roles',
                    label: (row) => String(row.name ?? row.key),
                    nullable: true,
                    emptyHint: t('manage.offeringTemplate.field.requiredRoleId.emptyHint'),
                },
            },
            {
                key: 'requiredCapacity',
                label: t('manage.offeringTemplate.field.requiredCapacity.label'),
                type: 'number',
                min: 0,
            },
            {
                key: 'requiredRoomCount',
                label: t('manage.offeringTemplate.field.requiredRoomCount.label'),
                type: 'number',
                min: 1,
                max: MAX_ROOMS_PER_SESSION,
            },
            {
                key: 'requiredLecturerCount',
                label: t('manage.offeringTemplate.field.requiredLecturerCount.label'),
                type: 'number',
                min: 1,
            },
            {
                key: 'onlineMode',
                label: t('manage.offeringTemplate.field.onlineMode.label'),
                type: 'select',
                // A BLANK OPTION HERE, unlike the Offering's: on a template
                // "not set" means the shape does not fix this field, which is
                // every template column's own third state.
                options: [
                    { value: '', label: t('manage.offeringTemplate.field.onlineMode.option.notSet') },
                    { value: 'FORBIDDEN', label: t('manage.offeringTemplate.field.onlineMode.option.forbidden') },
                    { value: 'ALLOWED', label: t('manage.offeringTemplate.field.onlineMode.option.allowed') },
                    { value: 'REQUIRED', label: t('manage.offeringTemplate.field.onlineMode.option.required') },
                ],
            },
            { key: 'notes', label: t('manage.offeringTemplate.field.notes.label'), type: 'textarea' },
        ],
        relations: [
            {
                key: 'lecturers',
                label: t('manage.offeringTemplate.relation.lecturers.label'),
                help: t('manage.offeringTemplate.relation.lecturers.help'),
                resource: 'persons',
                valueKey: 'personId',
                searchable: true,
                optionLabel: personOptionLabel,
                extraReference: {
                    key: 'roleId',
                    resource: 'roles',
                    label: (row) => String(row.name ?? row.key),
                    placeholder: t('manage.offeringTemplate.relation.lecturers.rolePlaceholder'),
                },
                emptyHint: t('manage.offeringTemplate.relation.lecturers.emptyHint'),
            },
        ],
    };
}

/**
 * A reusable, ORDERED bundle of Offering templates ("this is what Jahrgang
 * 10 takes this term"), so applying one to a Group creates that Group's
 * whole course load in one action instead of one Offering at a time.
 *
 * BESPOKE DETAIL, unlike Offering itself: the item list is an ORDERED
 * sequence (`OfferingPlanItem.position`), which the generic `relations`
 * mechanism cannot express: it replaces a SET. See `ManageOfferingPlanItems`.
 */
export function offeringPlanEntity(t: Translate): ManageEntity {
    return {
        key: 'offering-plans',
        permissionPrefix: 'offering_plan',
        label: t('manage.offeringPlan.label'),
        plural: t('manage.offeringPlan.plural'),
        icon: 'material-symbols:playlist-add-check',
        description: t('manage.offeringPlan.description'),
        keywords: searchKeywords(t, 'manage.offeringPlan.keywords', [
            'plan', 'curriculum', 'jahrgang', 'cohort', 'bundle', 'template', 'load',
        ]),
        title: (row) => String(row.name ?? t('manage.offeringPlan.label')),
        detailComponent: 'OfferingPlanForm',
        columns: [
            { key: 'name', label: t('common.field.name') },
            { key: 'description', label: t('common.field.description'), secondary: true },
        ],
        fields: [
            { key: 'name', label: t('common.field.name'), type: 'text', required: true },
            { key: 'description', label: t('common.field.description'), type: 'textarea' },
            {
                key: 'nextPlanId',
                label: t('manage.offeringPlan.field.nextPlanId.label'),
                help: t('manage.offeringPlan.field.nextPlanId.help'),
                type: 'reference',
                // A plan cannot name itself as its own successor: the option
                // list excludes the row being edited, which no static registry
                // entry can express (it depends on which row that is). See
                // `ManageOfferingPlanForm`.
                custom: true,
                reference: {
                    resource: 'offering-plans',
                    label: (row) => String(row.name ?? row.id),
                    nullable: true,
                    emptyHint: t('manage.offeringPlan.field.nextPlanId.emptyHint'),
                },
            },
        ],
    };
}

export function constraintEntity(t: Translate): ManageEntity {
    return {
        key: 'constraints',
        permissionPrefix: 'constraint',
        label: t('manage.constraint.label'),
        plural: t('manage.constraint.plural'),
        icon: 'material-symbols:checklist',
        description: t('manage.constraint.description'),
        keywords: searchKeywords(t, 'manage.constraint.keywords', [
            'constraint', 'rule', 'hard', 'soft', 'penalty', 'conflict', 'policy',
        ]),
        title: (row) => String(row.name ?? t('manage.constraint.label')),
        detailComponent: 'ConstraintBuilder',
        /**
         * The catalogue is thirteen live types and every tenant holds one default
         * row for each, plus any scoped variants: bounded and small. The grid
         * needs the WHOLE set to group it correctly, and reports loudly rather than
         * silently truncating if it ever stops being complete.
         */
        listComponent: 'ConstraintGrid',
        listPageSize: 200,
        hideCreateAction: true,
        columns: [
            { key: 'name', label: t('common.field.name') },
            { key: 'type', label: t('manage.constraint.column.type'), format: 'code', secondary: true },
            { key: 'severity', label: t('manage.constraint.column.severity') },
            { key: 'weight', label: t('common.field.weight'), format: 'number' },
            { key: 'isEnabled', label: t('manage.constraint.column.isEnabled'), format: 'boolean' },
        ],
        /*
         * `type`, `severity`, `weight` and `params` are all `custom`: they constrain
         * each other. The chosen type fixes the severity and dictates which
         * parameters exist, and weight is meaningful only when severity is SOFT, a
         * pairing the database CHECK enforces. Rendered as four independent controls
         * they would compose states the server rejects.
         */
        fields: [
            { key: 'name', label: t('common.field.name'), type: 'text', required: true },
            {
                key: 'type',
                label: t('manage.constraint.field.type.label'),
                type: 'select',
                required: true,
                createOnly: true,
                custom: true,
            },
            {
                key: 'severity',
                label: t('manage.constraint.field.severity.label'),
                type: 'select',
                required: true,
                custom: true,
            },
            { key: 'weight', label: t('manage.constraint.field.weight.label'), type: 'number', custom: true },
            { key: 'params', label: t('manage.constraint.field.params.label'), type: 'json', custom: true },
            /*
             * Kind scopes. `custom` because the builder renders the picker, and
             * because the value is an ARRAY: the shape that produced
             * "[object Object]" when a structured field reached ManageField. It is
             * declared here so it takes part in the draft, dirty tracking and the
             * payload, exactly as `time_grid.breaks` does.
             */
            { key: 'scopes', label: t('manage.constraint.field.scopes.label'), type: 'text', custom: true },
            /*
             * A relation type's ordered Offering operands (ADR-0028 in
             * calendry-solver), `ConstraintRelationMember`, never
             * `ConstraintScope`. Same reasoning as `scopes` just above: `custom`
             * because `ManageOfferingRelationMembers` renders the picker and the
             * value is an array, and it has to be declared here to take part in
             * the draft, dirty tracking and the save payload at all; undeclared,
             * `useEntityForm.save()`'s generic per-field loop never sends it.
             */
            { key: 'members', label: t('manage.constraint.field.members.label'), type: 'text', custom: true },
            { key: 'isEnabled', label: t('manage.constraint.field.isEnabled.label'), type: 'boolean' },
        ],
    };
}

/**
 * Every managed entity, with its copy resolved in the reader's language.
 *
 * The array is built per call rather than memoised: `t` decides its contents,
 * so caching it would hand the previous language's labels to the next reader.
 * Callers hold it for the life of a page (`findManageEntity` in the three
 * `/manage/[entity]` pages) or inside a `computed` (`navPlaces`), which is
 * where the language becomes a dependency rather than a snapshot.
 */
export function manageEntities(t: Translate): ManageEntity[] {
    return [
        {
            key: 'persons',
            permissionPrefix: 'person',
            label: t('manage.person.label'),
            plural: t('manage.person.plural'),
            icon: 'material-symbols:person-outline',
            description: t('manage.person.description'),
            keywords: searchKeywords(t, 'manage.person.keywords', [
                'people', 'staff', 'student', 'lecturer', 'teacher', 'roster', 'directory',
            ]),
            title: (row) => `${row.givenName ?? ''} ${row.familyName ?? ''}`.trim() || t('manage.person.label'),
            // Every field below is plain; this exists solely to add issue #84's
            // GDPR export action outside the generic form. See detailComponents.ts.
            detailComponent: 'PersonForm',
            columns: [
                { key: 'familyName', label: t('manage.person.column.familyName') },
                { key: 'givenName', label: t('manage.person.column.givenName') },
                { key: 'email', label: t('manage.person.column.email'), secondary: true },
                { key: 'isActive', label: t('common.field.active'), format: 'boolean' },
            ],
            fields: [
                {
                    key: 'givenName',
                    label: t('manage.person.field.givenName.label'),
                    type: 'text',
                    required: true,
                },
                {
                    key: 'familyName',
                    label: t('manage.person.field.familyName.label'),
                    type: 'text',
                    required: true,
                },
                { key: 'email', label: t('manage.person.field.email.label'), type: 'email' },
                {
                    key: 'externalRef',
                    label: t('manage.person.field.externalRef.label'),
                    type: 'text',
                    help: t('manage.person.field.externalRef.help'),
                },
                {
                    key: 'timezone',
                    label: t('common.field.timezone'),
                    type: 'text',
                    /*
                     * NOT a message. An IANA zone id is an identifier the user
                     * types verbatim, the same class of value as a Role key:
                     * translating "Europe/Berlin" would produce a hint that
                     * does not parse.
                     */
                    placeholder: 'Europe/Berlin',
                    help: t('manage.person.field.timezone.help'),
                },
                { key: 'isActive', label: t('common.field.active'), type: 'boolean' },
            ],
            relations: [
                {
                    key: 'roles',
                    label: t('manage.person.relation.roles.label'),
                    help: t('manage.person.relation.roles.help'),
                    resource: 'roles',
                    valueKey: 'roleId',
                    optionLabel: (row) => String(row.name ?? row.key),
                    emptyHint: t('manage.person.relation.roles.emptyHint'),
                },
                {
                    key: 'access-roles',
                    label: t('manage.person.relation.accessRoles.label'),
                    help: t('manage.person.relation.accessRoles.help'),
                    resource: 'access-roles',
                    valueKey: 'accessRoleId',
                    optionLabel: (row) => String(row.name ?? row.key),
                    emptyHint: t('manage.person.relation.accessRoles.emptyHint'),
                    emptyWarning: t('manage.person.relation.accessRoles.emptyWarning'),
                    /*
                     * No read gate declared: it is DERIVED from `resource`; see
                     * `relationReadRequirement`. `/api/access-roles` accepts either
                     * administration permission, and the derivation says so without
                     * this entry having to know.
                     */
                    writeRequiresPermissions: ['person_access_role.assign'],
                },
                {
                    key: 'groups',
                    label: t('manage.person.relation.groups.label'),
                    help: t('manage.person.relation.groups.help'),
                    resource: 'groups',
                    valueKey: 'groupId',
                    indentTree: true,
                    optionLabel: (row) => String(row.name),
                    emptyHint: t('manage.person.relation.groups.emptyHint'),
                },
            ],
        },

        {
            key: 'roles',
            permissionPrefix: 'role',
            label: t('manage.role.label'),
            plural: t('manage.role.plural'),
            icon: 'material-symbols:badge-outline',
            // The Role/AccessRole distinction is load-bearing (TAXONOMY.md §2 vs §4)
            // and the two share a word, so the UI says which one this is.
            description: t('manage.role.description'),
            keywords: searchKeywords(t, 'manage.role.keywords', [
                'role', 'lecturer', 'auditor', 'vocabulary', 'title',
            ]),
            title: (row) => String(row.name ?? t('manage.role.label')),
            systemFlag: 'isSystem',
            columns: [
                { key: 'key', label: t('manage.role.column.key'), format: 'code' },
                { key: 'name', label: t('common.field.name') },
                { key: 'description', label: t('common.field.description'), secondary: true },
            ],
            fields: [
                {
                    key: 'key',
                    label: t('manage.role.field.key.label'),
                    type: 'text',
                    required: true,
                    createOnly: true,
                    help: t('manage.role.field.key.help'),
                },
                { key: 'name', label: t('common.field.name'), type: 'text', required: true },
                { key: 'description', label: t('common.field.description'), type: 'textarea' },
            ],
        },

        {
            key: 'rooms',
            permissionPrefix: 'room',
            label: t('manage.room.label'),
            plural: t('manage.room.plural'),
            icon: 'material-symbols:meeting-room-outline',
            description: t('manage.room.description'),
            keywords: searchKeywords(t, 'manage.room.keywords', [
                'room', 'space', 'hall', 'lab', 'venue', 'building', 'capacity',
            ]),
            federationOwnable: true,
            title: (row) => [row.code, row.name].filter(Boolean).join(' · ') || t('manage.room.label'),
            columns: [
                { key: 'code', label: t('common.field.code'), format: 'code' },
                { key: 'name', label: t('common.field.name') },
                { key: 'capacity', label: t('manage.room.column.capacity'), format: 'number' },
                {
                    key: 'examCapacity',
                    label: t('manage.room.column.examCapacity'),
                    format: 'number',
                    secondary: true,
                },
                { key: 'location', label: t('manage.room.column.location'), secondary: true },
                { key: 'isActive', label: t('common.field.active'), format: 'boolean' },
            ],
            fields: [
                { key: 'code', label: t('common.field.code'), type: 'text', required: true },
                { key: 'name', label: t('common.field.name'), type: 'text', required: true },
                {
                    key: 'capacity',
                    label: t('manage.room.field.capacity.label'),
                    type: 'number',
                    min: 0,
                    /* Stated, because 0 is the column's DEFAULT: a room saved
                     * without a capacity gets it, and the reading has to be the one
                     * that keeps such a room usable. */
                    help: t('manage.room.field.capacity.help'),
                },
                {
                    key: 'examCapacity',
                    label: t('manage.room.field.examCapacity.label'),
                    type: 'number',
                    min: 0,
                    /* Nullable, unlike `capacity`: unset is a real, distinct state
                     * ("this room has no separate exam limit"), not "zero seats". */
                    help: t('manage.room.field.examCapacity.help'),
                },
                { key: 'location', label: t('manage.room.field.location.label'), type: 'text' },
                {
                    key: 'ranking',
                    label: t('manage.room.field.ranking.label'),
                    type: 'number',
                    /*
                     * Direction-neutral, because the constraint that reads this is
                     * now direction-neutral too. It used to say "soft constraints
                     * minimise use of high-ranking rooms", which stopped being the
                     * whole truth when "Steer room choice by rank" gained a
                     * direction: the same ranking can now be used to steer TOWARD
                     * the premium rooms.
                     */
                    help: t('manage.room.field.ranking.help'),
                },
                { key: 'isVirtual', label: t('manage.room.field.isVirtual.label'), type: 'boolean' },
                { key: 'isActive', label: t('common.field.active'), type: 'boolean' },
            ],
            relations: [
                {
                    key: 'equipment',
                    label: t('manage.room.relation.equipment.label'),
                    help: t('manage.room.relation.equipment.help'),
                    resource: 'equipment',
                    valueKey: 'equipmentId',
                    optionLabel: (row) => String(row.name ?? row.key),
                    quantity: { key: 'quantity', label: t('manage.room.relation.equipment.quantity') },
                    emptyHint: t('manage.room.relation.equipment.emptyHint'),
                },
            ],
        },

        {
            key: 'equipment',
            permissionPrefix: 'equipment',
            label: t('manage.equipment.label'),
            plural: t('manage.equipment.plural'),
            icon: 'material-symbols:videocam-outline',
            description: t('manage.equipment.description'),
            keywords: searchKeywords(t, 'manage.equipment.keywords', [
                'equipment', 'feature', 'projector', 'lab', 'tag', 'facility',
            ]),
            federationOwnable: true,
            title: (row) => String(row.name ?? t('manage.equipment.label')),
            columns: [
                { key: 'key', label: t('manage.equipment.column.key'), format: 'code' },
                { key: 'name', label: t('common.field.name') },
                { key: 'description', label: t('common.field.description'), secondary: true },
            ],
            fields: [
                {
                    key: 'key',
                    label: t('manage.equipment.field.key.label'),
                    type: 'text',
                    required: true,
                    createOnly: true,
                    help: t('manage.equipment.field.key.help'),
                },
                { key: 'name', label: t('common.field.name'), type: 'text', required: true },
                { key: 'description', label: t('common.field.description'), type: 'textarea' },
            ],
        },

        {
            key: 'groups',
            permissionPrefix: 'group',
            label: t('manage.group.label'),
            plural: t('manage.group.plural'),
            icon: 'material-symbols:account-tree-outline',
            description: t('manage.group.description'),
            keywords: searchKeywords(t, 'manage.group.keywords', [
                'group', 'cohort', 'class', 'section', 'seminar', 'nesting', 'hierarchy', 'tree',
            ]),
            title: (row) => String(row.name ?? t('manage.group.label')),
            listComponent: 'GroupTree',
            detailComponent: 'GroupForm',
            // A tree assembled from one page of rows would show orphans whose
            // parents are on page 2. See ManageGroupTree for what happens past this.
            listPageSize: 200,
            columns: [
                { key: 'name', label: t('common.field.name') },
                { key: 'expectedSize', label: t('manage.group.column.expectedSize'), format: 'number' },
                { key: 'description', label: t('common.field.description'), secondary: true },
            ],
            fields: [
                { key: 'name', label: t('common.field.name'), type: 'text', required: true },
                { key: 'description', label: t('common.field.description'), type: 'textarea' },
                {
                    key: 'expectedSize',
                    label: t('manage.group.field.expectedSize.label'),
                    type: 'number',
                    min: 0,
                    help: t('manage.group.field.expectedSize.help'),
                },
                {
                    key: 'parentGroupId',
                    label: t('manage.group.field.parentGroupId.label'),
                    type: 'reference',
                    // Rendered by ManageGroupForm: the option list depends on WHICH
                    // group is being edited, since self and every descendant must be
                    // excluded. A static registry entry cannot express that.
                    custom: true,
                    reference: {
                        resource: 'groups',
                        label: (row) => String(row.name ?? row.id),
                        nullable: true,
                        emptyHint: t('manage.group.field.parentGroupId.emptyHint'),
                    },
                },
                {
                    key: 'curriculumPlanId',
                    label: t('manage.group.field.curriculumPlanId.label'),
                    type: 'reference',
                    help: t('manage.group.field.curriculumPlanId.help'),
                    reference: {
                        resource: 'offering-plans',
                        label: (row) => String(row.name ?? row.id),
                        nullable: true,
                        emptyHint: t('manage.group.field.curriculumPlanId.emptyHint'),
                    },
                },
            ],
            relations: [
                {
                    key: 'terms',
                    label: t('manage.group.relation.terms.label'),
                    // The empty case is stated explicitly because it reads backwards:
                    // an empty set WIDENS the group rather than hiding it. Leaving
                    // the user to infer that from a blank list is how someone
                    // "clears" a scope expecting the opposite.
                    help: t('manage.group.relation.terms.help'),
                    resource: 'terms',
                    valueKey: 'termId',
                    optionLabel: (row) => String(row.name),
                    emptyHint: t('manage.group.relation.terms.emptyHint'),
                },
            ],
        },

        {
            key: 'time-grids',
            permissionPrefix: 'time_grid',
            label: t('manage.timeGrid.label'),
            plural: t('manage.timeGrid.plural'),
            icon: 'material-symbols:grid-on-outline',
            description: t('manage.timeGrid.description'),
            keywords: searchKeywords(t, 'manage.timeGrid.keywords', [
                'time grid', 'timegrid', 'blocks', 'periods', 'slots', 'days', 'schedule shape',
            ]),
            title: (row) => String(row.name ?? t('manage.timeGrid.label')),
            detailComponent: 'TimeGridEditor',
            columns: [
                { key: 'name', label: t('common.field.name') },
                { key: 'blocksPerDay', label: t('manage.timeGrid.column.blocksPerDay'), format: 'number' },
                {
                    key: 'blockLengthMinutes',
                    label: t('manage.timeGrid.column.blockLengthMinutes'),
                    format: 'number',
                },
                { key: 'activeDays', label: t('manage.timeGrid.column.activeDays'), format: 'weekdays' },
                { key: 'isDefault', label: t('manage.timeGrid.column.isDefault'), format: 'boolean' },
            ],
            /*
             * Every field is `custom`: the editor renders them against a live
             * preview of the resulting day, because these numbers are meaningless in
             * isolation: "45 minutes, 8 blocks, break 15" only becomes checkable
             * when you can see it lands at 17:00. They stay declared here so draft
             * seeding, dirty tracking, payload building and server-side field errors
             * all keep working exactly as they do for a generic entity.
             */
            fields: [
                { key: 'name', label: t('common.field.name'), type: 'text', required: true, custom: true },
                {
                    key: 'blockLengthMinutes',
                    label: t('manage.timeGrid.field.blockLengthMinutes.label'),
                    type: 'number',
                    required: true,
                    min: 1,
                    custom: true,
                },
                {
                    key: 'blocksPerDay',
                    label: t('manage.timeGrid.field.blocksPerDay.label'),
                    type: 'number',
                    required: true,
                    min: 1,
                    custom: true,
                },
                {
                    key: 'startHour',
                    label: t('manage.timeGrid.field.startHour.label'),
                    type: 'number',
                    min: 0,
                    max: 23,
                    custom: true,
                },
                {
                    key: 'startMinute',
                    label: t('manage.timeGrid.field.startMinute.label'),
                    type: 'number',
                    min: 0,
                    max: 59,
                    custom: true,
                },
                {
                    key: 'breakMinutes',
                    label: t('manage.timeGrid.field.breakMinutes.label'),
                    type: 'number',
                    min: 0,
                    custom: true,
                },
                // custom: true keeps it in the draft, dirty tracking and the payload
                // while ManageTimeGridEditor supplies the control. Leaving it out of
                // the registry instead would drop it from the draft and silently
                // from saves: the trap Step 13 documented.
                { key: 'breaks', label: t('manage.timeGrid.field.breaks.label'), type: 'text', custom: true },
                {
                    key: 'activeDays',
                    label: t('manage.timeGrid.field.activeDays.label'),
                    type: 'select',
                    required: true,
                    custom: true,
                },
                {
                    key: 'isDefault',
                    label: t('manage.timeGrid.field.isDefault.label'),
                    type: 'boolean',
                    custom: true,
                },
            ],
        },

        {
            key: 'session-kinds',
            permissionPrefix: 'session_kind',
            label: t('manage.sessionKind.label'),
            plural: t('manage.sessionKind.plural'),
            icon: 'material-symbols:label-outline',
            description: t('manage.sessionKind.description'),
            keywords: searchKeywords(t, 'manage.sessionKind.keywords', [
                'kind', 'type', 'lecture', 'lab', 'seminar', 'exam', 'vocabulary', 'category',
            ]),
            title: (row) => String(row.name ?? t('manage.sessionKind.label')),
            columns: [
                { key: 'key', label: t('manage.sessionKind.column.key'), format: 'code' },
                { key: 'name', label: t('common.field.name') },
                { key: 'color', label: t('common.field.colour'), format: 'swatch' },
                { key: 'type', label: t('manage.sessionKind.column.type') },
                { key: 'requiresGroup', label: t('manage.sessionKind.column.requiresGroup'), format: 'boolean' },
                { key: 'requiresLecturer', label: t('manage.sessionKind.column.requiresLecturer'), format: 'boolean' },
            ],
            fields: [
                {
                    key: 'key',
                    label: t('manage.sessionKind.field.key.label'),
                    type: 'text',
                    required: true,
                    createOnly: true,
                    help: t('manage.sessionKind.field.key.help'),
                },
                { key: 'name', label: t('common.field.name'), type: 'text', required: true },
                {
                    key: 'type',
                    label: t('manage.sessionKind.field.type.label'),
                    type: 'select',
                    /*
                     * NOT `createOnly`, unlike `key`. A tenant that has been running
                     * for a term and only now wants exam rules must be able to
                     * reclassify the kind it already has, rather than create a
                     * second one and re-point every offering.
                     *
                     * No blank option: every kind is one of these, and the default
                     * is the honest answer for a kind nobody has thought about,
                     * unlike `schedulingPattern`, where "not decided" is a real
                     * third state.
                     *
                     * THE OPTION LABELS AND THE EXAM SENTENCE ARE NOT THIS
                     * NAMESPACE'S. `SESSION_KIND_TYPE_LABELS` and
                     * `SESSION_KIND_TYPE_HELP` live in `shared/sessionKindType.ts`,
                     * a SHARED catalogue the server reads too, which issue #19
                     * translates in Phase 3 rather than during extraction. So the
                     * labels pass through untouched and the help text takes the
                     * sentence as a NAMED PLACEHOLDER: when that catalogue starts
                     * answering in German, this line does too, with no edit here.
                     */
                    options: SESSION_KIND_TYPES.map((value) => ({
                        value,
                        label: SESSION_KIND_TYPE_LABELS[value],
                    })),
                    help: t('manage.sessionKind.field.type.help', { examHelp: SESSION_KIND_TYPE_HELP.EXAM }),
                },
                {
                    key: 'color',
                    label: t('common.field.colour'),
                    type: 'color',
                    help: t('manage.sessionKind.field.color.help'),
                },
                {
                    key: 'requiresGroup',
                    label: t('manage.sessionKind.field.requiresGroup.label'),
                    type: 'boolean',
                    help: t('manage.sessionKind.field.requiresGroup.help'),
                },
                {
                    key: 'requiresLecturer',
                    label: t('manage.sessionKind.field.requiresLecturer.label'),
                    type: 'boolean',
                    help: t('manage.sessionKind.field.requiresLecturer.help'),
                },
            ],
        },

        offeringEntity(t),
        offeringTemplateEntity(t),
        offeringPlanEntity(t),
        constraintEntity(t),

        {
            /*
             * Lobby displays. Own handlers under `server/api/screens/`, not the
             * generic scaffold: a Screen carries a secret, and the scaffold returns
             * the row it wrote. The gate is still declared in `RESOURCE_PERMISSIONS`
             * so this registry can predict it, exactly as `accounts` does.
             */
            key: 'screens',
            permissionPrefix: 'screen',
            permissionOverrides: {
                read: 'screen.read',
                create: 'screen.manage',
                update: 'screen.manage',
                delete: 'screen.manage',
            },
            label: t('manage.screen.label'),
            plural: t('manage.screen.plural'),
            icon: 'material-symbols:cast-outline',
            description: t('manage.screen.description'),
            keywords: searchKeywords(t, 'manage.screen.keywords', [
                'screen', 'screens', 'display', 'displays', 'lobby', 'kiosk',
                'signage', 'board', 'monitor', 'tv', 'corridor', 'occupancy',
                'substitution', 'substitutions', 'cover', 'vertretung', 'vertretungsplan',
            ]),
            title: (row) => String(row.name ?? t('manage.screen.label')),
            detailComponent: 'ScreenForm',
            columns: [
                { key: 'name', label: t('common.field.name') },
                { key: 'roomSummary', label: t('manage.screen.column.roomSummary') },
                { key: 'isActive', label: t('common.field.active'), format: 'boolean' },
                { key: 'lastSeenAt', label: t('manage.screen.column.lastSeenAt'), format: 'date', secondary: true },
            ],
            fields: [
                {
                    key: 'name',
                    label: t('common.field.name'),
                    type: 'text',
                    required: true,
                    help: t('manage.screen.field.name.help'),
                },
                /*
                 * WHICH BOARD IT DRAWS (issue #31). A plain select, rendered by
                 * the generic field list rather than the bespoke component,
                 * because it is an ordinary two-option column; what is bespoke
                 * is only which SCOPE picker it makes relevant, and
                 * `ScreenForm` reads the draft to decide that.
                 *
                 * NOT `createOnly`: the PATCH route accepts it, and a screen
                 * repurposed from occupancy to a Vertretungsplan should not
                 * mean re-issuing a key somebody has to walk to the wall to
                 * retype.
                 */
                {
                    key: 'mode',
                    label: t('manage.screen.field.mode.label'),
                    type: 'select',
                    help: t('manage.screen.field.mode.help'),
                    options: [
                        { value: 'ROOM_BOARD', label: t('manage.screen.field.mode.option.roomBoard') },
                        { value: 'SUBSTITUTION_PLAN', label: t('manage.screen.field.mode.option.substitutionPlan') },
                    ],
                },
                {
                    key: 'isActive',
                    label: t('common.field.active'),
                    type: 'boolean',
                    help: t('manage.screen.field.isActive.help'),
                },
                /*
                 * `custom`, because both controls are bespoke: the room scope needs
                 * "empty means every room" stated in words rather than inferred from
                 * a blank multi-select, and the key can only ever be shown once.
                 */
                {
                    key: 'roomIds',
                    label: t('manage.screen.field.roomIds.label'),
                    /*
                     * `reference`, not `text`, and that is what makes the picker
                     * work at all: `referencedResources()` builds the form's fetch
                     * wave from fields carrying one, so a field without it renders
                     * an empty list reading "No rooms defined yet" in a tenant full
                     * of rooms. Shipped exactly that way once.
                     *
                     * `custom` because the control is a multi-select whose EMPTY
                     * state means "every room": a meaning no generic reference
                     * control can convey, and the opposite of what a blank select
                     * looks like.
                     */
                    type: 'reference',
                    custom: true,
                    reference: {
                        resource: 'rooms',
                        label: (row) => String(row.name ?? row.code ?? row.id),
                        nullable: true,
                        emptyHint: t('manage.screen.field.roomIds.emptyHint'),
                    },
                },
                /*
                 * The device key, generated in the BROWSER and shown once: the same
                 * shape as an account's initial password, and for the same reason:
                 * the create page navigates away on success, so a server-generated
                 * secret would be gone before it could be read. `custom` because the
                 * control is the display URL with a copy button, not a text input.
                 */
                /*
                 * The SECOND scope axis, read by `SUBSTITUTION_PLAN`. Declared
                 * whatever the mode, and that is deliberate: `useEntityForm`
                 * only serialises fields it knows about, so leaving it out
                 * while the room board is selected would silently drop a group
                 * scope every time somebody saved an occupancy screen.
                 *
                 * `reference` for the same reason `roomIds` is: the form's
                 * fetch wave is built from fields carrying one, and a field
                 * without it renders "No groups defined yet." in a tenant full
                 * of groups. `custom`, because the EMPTY state means "every
                 * group" and no generic control can say that.
                 */
                {
                    key: 'groupIds',
                    label: t('manage.screen.field.groupIds.label'),
                    type: 'reference',
                    custom: true,
                    reference: {
                        resource: 'groups',
                        label: (row) => String(row.name ?? row.id),
                        nullable: true,
                        emptyHint: t('manage.screen.field.groupIds.emptyHint'),
                    },
                },
                { key: 'key', label: t('manage.screen.field.key.label'), type: 'text', custom: true },
                /*
                 * THE ROOM PLAN'S OWN HOURS (issue #131), minutes since
                 * tenant-local midnight, NULL meaning "the timetable's own
                 * day". Declared here so they take part in draft seeding,
                 * dirty tracking and the save payload, `custom` because both
                 * the control (`<input type="time">`, converting to minutes)
                 * and its relevance (room boards only) are things the generic
                 * field list cannot express. See `ScreenForm`.
                 */
                {
                    key: 'planStartMinute',
                    label: t('manage.screen.field.planStartMinute.label'),
                    type: 'number',
                    custom: true,
                },
                {
                    key: 'planEndMinute',
                    label: t('manage.screen.field.planEndMinute.label'),
                    type: 'number',
                    custom: true,
                },
            ],
        },

        {
            key: 'terms',
            permissionPrefix: 'term',
            label: t('manage.term.label'),
            plural: t('manage.term.plural'),
            icon: 'material-symbols:calendar-month-outline',
            description: t('manage.term.description'),
            keywords: searchKeywords(t, 'manage.term.keywords', [
                'term', 'semester', 'trimester', 'academic', 'year', 'period',
            ]),
            title: (row) => String(row.name ?? t('manage.term.label')),
            columns: [
                { key: 'name', label: t('common.field.name') },
                { key: 'startDate', label: t('manage.term.column.startDate'), format: 'date' },
                { key: 'endDate', label: t('manage.term.column.endDate'), format: 'date' },
            ],
            fields: [
                { key: 'name', label: t('common.field.name'), type: 'text', required: true },
                {
                    key: 'startDate',
                    label: t('manage.term.field.startDate.label'),
                    type: 'date',
                    required: true,
                },
                { key: 'endDate', label: t('manage.term.field.endDate.label'), type: 'date', required: true },
                {
                    key: 'timeGridId',
                    label: t('manage.term.field.timeGridId.label'),
                    type: 'reference',
                    help: t('manage.term.field.timeGridId.help'),
                    reference: {
                        resource: 'time-grids',
                        label: (row) => String(row.name ?? row.id),
                        nullable: true,
                        emptyHint: t('manage.term.field.timeGridId.emptyHint'),
                    },
                },
            ],
        },

        {
            key: 'calendar-periods',
            // A child of Term, so `term.update` governs it: changing when a term's
            // exam period falls IS editing the term. Same reasoning as
            // `time_grid_break` living under `time_grid.update`.
            permissionPrefix: 'term',
            label: t('manage.calendarPeriod.label'),
            plural: t('manage.calendarPeriod.plural'),
            icon: 'material-symbols:event-busy-outline',
            description: t('manage.calendarPeriod.description'),
            keywords: searchKeywords(t, 'manage.calendarPeriod.keywords', [
                'calendar', 'period', 'holiday', 'break', 'exam', 'vacation', 'reading week', 'recess',
            ]),
            title: (row) => String(row.name ?? t('manage.calendarPeriod.label')),
            detailComponent: 'CalendarPeriodForm',
            columns: [
                { key: 'name', label: t('common.field.name') },
                { key: 'kind', label: t('manage.calendarPeriod.column.kind') },
                { key: 'startDate', label: t('manage.calendarPeriod.column.startDate'), format: 'date' },
                { key: 'endDate', label: t('manage.calendarPeriod.column.endDate'), format: 'date' },
            ],
            fields: [
                {
                    key: 'termId',
                    label: t('manage.calendarPeriod.field.termId.label'),
                    type: 'reference',
                    required: true,
                    createOnly: true,
                    help: t('manage.calendarPeriod.field.termId.help'),
                    reference: {
                        resource: 'terms',
                        label: (row) => String(row.name ?? row.id),
                        emptyHint: t('manage.calendarPeriod.field.termId.emptyHint'),
                    },
                },
                {
                    key: 'kind',
                    label: t('manage.calendarPeriod.field.kind.label'),
                    type: 'select',
                    required: true,
                    // Structural, not tenant vocabulary: TAXONOMY.md §2 names these
                    // three explicitly, and each has different week-classification
                    // semantics that only exist because the set is fixed.
                    options: [
                        { value: 'EXAM', label: t('manage.calendarPeriod.field.kind.option.exam') },
                        { value: 'BREAK', label: t('manage.calendarPeriod.field.kind.option.break') },
                        { value: 'HOLIDAY', label: t('manage.calendarPeriod.field.kind.option.holiday') },
                    ],
                    help: t('manage.calendarPeriod.field.kind.help'),
                },
                { key: 'name', label: t('common.field.name'), type: 'text', required: true },
                {
                    key: 'startDate',
                    label: t('manage.calendarPeriod.field.startDate.label'),
                    type: 'date',
                    required: true,
                },
                {
                    key: 'endDate',
                    label: t('manage.calendarPeriod.field.endDate.label'),
                    type: 'date',
                    required: true,
                },
                {
                    key: 'weekPreview',
                    label: t('manage.calendarPeriod.field.weekPreview.label'),
                    type: 'text',
                    // Rendered by ManageCalendarPeriodPreview. `custom` keeps the key
                    // out of the payload while leaving the field in the form's
                    // layout; there is no `weekPreview` column.
                    custom: true,
                },
            ],
        },

        /**
         * Account: the LOGIN, which is not a Person.
         *
         * THE DISTINCTION THIS SECTION EXISTS TO MAKE VISIBLE: a Person is who the
         * timetable places and notifies (TAXONOMY.md §2); an Account is a credential
         * that can act as one Person per institution (§4). Creating a Person
         * therefore does not create a login, which is exactly the gap that sent
         * admins to `bun run create:account`, where an already-existing Person
         * answered "already exists" and the trail ended.
         *
         * SECTION GATE IS `account.read`, and reading the API additionally accepts
         * `account.manage`, the same deliberate divergence `access-roles` carries in
         * the opposite direction. A role that may issue logins therefore needs
         * `account.read` as well to see the section; the API stays usable either way
         * so a create response and the person picker never 403 under a manage-only
         * role.
         *
         * Second-to-last, immediately before Access roles: the two administration
         * sections belong together, and this is the one you visit first: a login is
         * what makes an access role reach anybody.
         */
        {
            key: 'accounts',
            // Naming the table, as `access-roles` does; the four verbs come from the
            // overrides below because the catalogue holds two capabilities, not eight.
            permissionPrefix: 'account',
            permissionOverrides: {
                read: 'account.read',
                create: 'account.manage',
                update: 'account.manage',
                delete: 'account.manage',
            },
            label: t('manage.account.label'),
            plural: t('manage.account.plural'),
            icon: 'material-symbols:key-outline',
            description: t('manage.account.description'),
            keywords: searchKeywords(t, 'manage.account.keywords', [
                'account', 'accounts', 'login', 'logins', 'credential', 'password',
                'sign in', 'signin', 'user', 'users', 'reset',
            ]),
            title: (row) => String(row.email ?? t('manage.account.label')),
            detailComponent: 'AccountForm',
            columns: [
                { key: 'email', label: t('manage.account.column.email') },
                { key: 'personName', label: t('manage.account.column.personName') },
                { key: 'isActive', label: t('common.field.active'), format: 'boolean' },
                {
                    key: 'mustChangePassword',
                    label: t('manage.account.column.mustChangePassword'),
                    format: 'boolean',
                    secondary: true,
                },
                {
                    key: 'lastLoginAt',
                    label: t('manage.account.column.lastLoginAt'),
                    format: 'date',
                    secondary: true,
                },
            ],
            fields: [
                {
                    key: 'email',
                    label: t('manage.account.field.email.label'),
                    type: 'email',
                    required: true,
                    help: t('manage.account.field.email.help'),
                },
                /*
                 * `custom`, so the control is the bespoke picker over
                 * `/api/accounts/candidates` rather than a `reference` field over
                 * every Person. Most people already have a login, and offering them
                 * produces a 409 from `@@unique([personId])` after the form is
                 * filled in. Declared here so the key still takes part in the draft,
                 * dirty tracking and the payload: omitting it drops it from saves
                 * silently.
                 */
                {
                    key: 'personId',
                    label: t('manage.account.field.personId.label'),
                    type: 'text',
                    required: true,
                    custom: true,
                },
                /*
                 * `createOnly` AND `custom`. Changing a password later is an explicit
                 * verb (`POST /api/accounts/:id/reset-password`) because it revokes
                 * every session, so an editable field on the detail page would offer
                 * that consequence as an ordinary save.
                 */
                {
                    key: 'password',
                    label: t('manage.account.field.password.label'),
                    type: 'text',
                    createOnly: true,
                    custom: true,
                },
                /*
                 * Explicit consent to reuse the credential that already holds the
                 * typed address, rather than minting a second one. A FIELD and not a
                 * second endpoint, because it has to ride along in the create payload
                 * the shared form builds, and because it belongs to the draft: the
                 * admin's answer to "attach instead?" is part of what they are about
                 * to submit, not a separate action.
                 */
                {
                    key: 'attachExisting',
                    label: t('manage.account.field.attachExisting.label'),
                    type: 'boolean',
                    createOnly: true,
                    custom: true,
                },
                {
                    key: 'mustChangePassword',
                    label: t('manage.account.field.mustChangePassword.label'),
                    type: 'boolean',
                    help: t('manage.account.field.mustChangePassword.help'),
                },
                {
                    key: 'isActive',
                    label: t('common.field.active'),
                    type: 'boolean',
                    help: t('manage.account.field.isActive.help'),
                },
            ],
        },

        /**
         * AccessRole: who may DO what, as opposed to the domain Role directly
         * above, which is scheduling vocabulary and grants nothing (TAXONOMY.md §4
         * vs §2). The two share a word and nothing else, so both descriptions say
         * which one they are.
         *
         * Last in the array, and therefore last in the sidebar: it is the section
         * a tenant visits least and the one whose entries are hardest to undo.
         */
        {
            key: 'access-roles',
            // Unused for permissions (see `permissionOverrides`), but the field is
            // required and naming the table is still the honest answer.
            permissionPrefix: 'access_role',
            permissionOverrides: {
                read: 'access_role.manage',
                create: 'access_role.manage',
                update: 'access_role.manage',
                delete: 'access_role.manage',
            },
            label: t('manage.accessRole.label'),
            plural: t('manage.accessRole.plural'),
            icon: 'material-symbols:admin-panel-settings-outline',
            description: t('manage.accessRole.description'),
            keywords: searchKeywords(t, 'manage.accessRole.keywords', [
                'access', 'permission', 'role', 'admin', 'rights', 'authorization', 'security',
            ]),
            title: (row) => String(row.name ?? t('manage.accessRole.label')),
            detailComponent: 'AccessRoleForm',
            // `tenant-admin` is provisioning's own row: renamable, never deletable.
            // The server refuses it too; this only stops offering the button.
            systemFlag: 'isSystem',
            columns: [
                { key: 'key', label: t('manage.accessRole.column.key'), format: 'code' },
                { key: 'name', label: t('common.field.name') },
                { key: 'description', label: t('common.field.description'), secondary: true },
            ],
            fields: [
                {
                    key: 'key',
                    label: t('manage.accessRole.field.key.label'),
                    type: 'text',
                    required: true,
                    createOnly: true,
                    help: t('manage.accessRole.field.key.help'),
                },
                { key: 'name', label: t('common.field.name'), type: 'text', required: true },
                { key: 'description', label: t('common.field.description'), type: 'textarea' },
                /*
                 * The grants. `custom` because the control is a matrix over the
                 * fixed catalogue rather than a field, and because the value is an
                 * ARRAY: the shape that renders as "[object Object]" if it ever
                 * reaches ManageField. Declared here so it takes part in the draft,
                 * dirty tracking and the payload, exactly as `constraint.scopes`
                 * does.
                 */
                {
                    key: 'permissions',
                    label: t('manage.accessRole.field.permissions.label'),
                    type: 'text',
                    custom: true,
                },
            ],
        },
    ];
}

export function findManageEntity(key: string | undefined, t: Translate): ManageEntity | undefined {
    return manageEntities(t).find((entity) => entity.key === key);
}

/**
 * The registry's WORDLESS HALF: which route segments are management sections,
 * and what permission each one's four verbs need.
 *
 * WHY IT EXISTS AS ITS OWN TYPE. `manageEntities()` takes a `Translate`, and
 * ROUTE MIDDLEWARE CANNOT HAVE ONE: `useT()` needs a component setup context
 * and route middleware is not one, which is exactly why `app/plugins/i18n.ts`
 * hands `i18n.global.ts` an `$applyLanguage` instead of the instance.
 * `app/middleware/manage.ts` asks this registry two questions, "is this a
 * section?" and "what does reading it need?", and neither is a question about
 * words.
 *
 * DERIVED FROM THE ONE REGISTRY, never declared beside it, so a section cannot
 * exist with a gate that disagrees with the one the middleware checks: that is
 * CLAUDE.md's one-implementation-per-operation rule, and a hand-kept second
 * table of permission prefixes is precisely the silent drift it names.
 *
 * `NO_COPY` IS SAFE BECAUSE THE COPY IS UNREACHABLE, not merely unread. The
 * return type is a `Pick` of the three structural fields, so nothing a caller
 * can hold carries a label at all; there is no way for this to become a second
 * path that renders an untranslated string. Memoised because the shape never
 * varies: the copy is what `t` decides, and there is none here.
 */
export type ManageSection = Pick<ManageEntity, 'key' | 'permissionPrefix' | 'permissionOverrides'>;

const NO_COPY: Translate = () => '';

let sections: ManageSection[] | undefined;

export function manageSections(): ManageSection[] {
    sections ??= manageEntities(NO_COPY).map(({ key, permissionPrefix, permissionOverrides }) => ({
        key,
        permissionPrefix,
        permissionOverrides,
    }));

    return sections;
}

/** The `findManageEntity` a caller with no translator can use. */
export function findManageSection(key: string | undefined): ManageSection | undefined {
    return manageSections().find((section) => section.key === key);
}

/**
 * Every resource one relation's option wave fetches from.
 *
 * The relation's own membership GET (`/api/{entity}/{id}/{relation}`) is NOT in
 * here: it is gated on the PARENT's `.read`, which is the page gate itself, so
 * it can never be the thing that fails.
 *
 * This is the one place that knows what a picker fetches. A relation that grows
 * a third fetch must be added here, and the test below will not let it be
 * forgotten quietly.
 */
export function relationOptionResources(def: RelationDef): string[] {
    return [def.resource, ...(def.extraReference ? [def.extraReference.resource] : [])];
}

/**
 * What a caller needs to be OFFERED this relation, derived, never declared.
 *
 * Every relation's option list is fetched in ONE `Promise.all`, so a single 403
 * takes down the whole wave, and because `useEntityRelations` awaits a
 * useAsyncData handle that RESOLVES rather than rejects, the result is not a blank
 * page but every picker rendering empty. Measured: without this gating a person
 * editor's Person page says "No roles defined yet" over a tenant that has them.
 *
 * Derived rather than declared so a new relation is gated by construction and one
 * that changes what it fetches cannot drift from its own gate. The result is an
 * AND of ORs: every endpoint must be reachable, and one may accept several
 * permissions: `lecturers` fetches persons AND roles.
 */
export function relationReadRequirement(def: RelationDef): PermissionRequirement {
    return relationOptionResources(def).map((resource) => {
        const permissions = resourcePermissions(resource, 'read');

        /*
         * A resource nothing can name fails CLOSED: an empty clause is
         * unsatisfiable, so the picker is hidden rather than offered against an
         * endpoint whose gate nobody can predict. That would be a silent
         * vanishing, which this codebase treats as worse than a loud failure,
         * so `tests/manage-relation-gates.test.ts` refuses to let one ship.
         */
        return permissions ? [...permissions] : [];
    });
}

/**
 * The four CRUD permissions for an entity, in catalogue form.
 *
 * Takes a `ManageSection` rather than a whole `ManageEntity`: a permission is
 * not copy, so this is answerable with no translator in play, and typing the
 * parameter that way is what lets `manage.ts` middleware call it.
 */
export function entityPermission(entity: ManageSection, action: 'read' | 'create' | 'update' | 'delete'): string {
    return entity.permissionOverrides?.[action] ?? `${entity.permissionPrefix}.${action}`;
}

/**
 * Fields the form should render for this mode. `createOnly` fields are dropped
 * on edit because the server's update schema rejects them: rendering them
 * would offer an edit that silently does nothing.
 */
export function fieldsFor(entity: ManageEntity, mode: 'create' | 'edit'): FieldDef[] {
    return mode === 'create' ? entity.fields : entity.fields.filter((field) => !field.createOnly);
}

/** Distinct reference resources a form needs to populate its selects. */
export function referencedResources(entity: ManageEntity): string[] {
    const resources = entity.fields
        .filter((field) => field.type === 'reference' && field.reference)
        .map((field) => field.reference!.resource);

    return [...new Set(resources)];
}
