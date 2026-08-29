import type { PermissionRequirement } from '#shared/permissions';
import { resourcePermissions } from '#shared/permissions';

/**
 * The management area's entity registry — a client mirror of the server's
 * `RESOURCES`.
 *
 * A MIRROR AND NOT A FETCH because the server registry holds zod schemas, which
 * do not serialise, and what the UI needs is different anyway. The server stays
 * the authority on validity; this file on presentation.
 *
 * ALSO THE NAVIGATION SOURCE: `useNavEntries()` projects the manage section out
 * of this array, so adding an entity here puts it in the sidebar, index, header
 * and palette in one edit. Entities appear only once they have a working editor —
 * an entry whose detail page cannot edit the entity is a nav item that lies.
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
     * the attached Groups when left blank and nothing did — the gap survived
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
     * mapping — all of which stay in `useEntityForm` — and only its CONTROL is
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
 * Declaring these as data is what stops Offering — which references a Term, a
 * Kind, a Role, plus Groups, Lecturers and Equipment — from needing a bespoke
 * page. It is the hub of the model, but nothing about editing it is structurally
 * new; only the number of relations is.
 */
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
    /** Per-row count, for countable equipment. */
    quantity?: { key: string; label: string };
    /**
     * Per-row reference to a second entity — currently only a lecturer's
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
     * Advisory shown when NOTHING IS ASSIGNED — a different question from
     * `emptyHint`, which explains why the option list is empty.
     *
     * Exists because an empty set is ambiguous in exactly the way this codebase
     * keeps getting caught by: "deliberately unprivileged" and "nobody got round
     * to it" render identically, so the second is invisible. Only `access-roles`
     * declares one today, because it is the only relation whose empty state means
     * a person can sign in and be shown nothing.
     *
     * Phrase it as a FACT, not an instruction: it renders in read-only mode too,
     * for a viewer who cannot act on it. And never name a specific role —
     * AccessRole keys are tenant vocabulary (CLAUDE.md: never hardcode an open
     * value into logic), so there is no role this string is allowed to assume
     * exists.
     */
    emptyWarning?: string;
    /**
     * What makes this relation EDITABLE. Absent means the parent's `.update`.
     *
     * Separate from VISIBILITY (derived — see `relationReadRequirement`): seeing
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
     * cannot answer from a flat row list — it would need each Group's scope
     * rows, which is the request it is trying to avoid.
     */
    scopeBy?: { filter: string; from: string };
}

export interface ManageEntity {
    /** Route segment AND API resource name — deliberately the same string. */
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
    /** Extra terms the Ctrl+K fuzzy match should hit. */
    keywords: string[];
    /** Row → human title. Used in lists, delete confirmations and page titles. */
    title: (row: EntityRow) => string;
    columns: ColumnDef[];
    fields: FieldDef[];
    /**
     * True when a Federation can own rows of this entity (TAXONOMY.md §2).
     * Such rows are readable but not writable — the RLS write policy is
     * tenant-only — so the list marks them and the detail renders read-only.
     */
    federationOwnable?: boolean;
    /**
     * Column marking rows provisioning created and the tenant must not delete
     * (Role.isSystem, AccessRole.isSystem).
     */
    systemFlag?: string;
    /** Bespoke detail body, resolved by name. Generic form when absent. */
    detailComponent?: string;
    /**
     * Bespoke LIST body, for an entity whose rows do not read as a flat table.
     * Only Group needs this — a hierarchy shown as a flat list loses the one
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
     * For an entity whose rows are PROVISIONED rather than collected — the
     * constraint catalogue — a prominent "New" action frames a fixed set of
     * switches as a collection you populate, which is how tenants ended up with
     * types that had no row and were therefore never evaluated. Creation is
     * still reachable (a scoped variant, from within its type's row); it is
     * just not the primary verb.
     */
    hideCreateAction?: boolean;
    /** Join tables edited as sets on the detail page. */
    relations?: RelationDef[];
}

export const OFFERING_ENTITY: ManageEntity = {
    key: 'offerings',
    permissionPrefix: 'offering',
    label: 'Offering',
    plural: 'Offerings',
    icon: 'material-symbols:book-outline',
    description: 'What must be scheduled — the recurring demand sessions are placed from.',
    keywords: ['offering', 'course', 'module', 'subject', 'demand', 'curriculum', 'lecture'],
    federationOwnable: true,
    title: (row) => [row.code, row.title].filter(Boolean).join(' · ') || 'Offering',
    columns: [
        { key: 'code', label: 'Code', format: 'code' },
        { key: 'title', label: 'Title' },
        { key: 'color', label: 'Colour', format: 'swatch' },
        { key: 'frequency', label: 'Sessions', format: 'number' },
        { key: 'durationBlocks', label: 'Blocks', format: 'number' },
        { key: 'isActive', label: 'Active', format: 'boolean' },
    ],
    fields: [
        { key: 'title', label: 'Title', type: 'text', required: true },
        { key: 'code', label: 'Code', type: 'text' },
        {
            key: 'color',
            label: 'Colour',
            type: 'color',
            help: 'Tints every session of this offering. Leave it empty to inherit the '
                + 'session kind\'s colour — empty means inherit, not grey.',
        },
        {
            key: 'termId',
            label: 'Term',
            type: 'reference',
            required: true,
            // The server's update schema omits termId: moving an Offering between
            // terms would orphan its placed Sessions, which belong to a term.
            createOnly: true,
            reference: {
                resource: 'terms',
                label: (row) => String(row.name),
                emptyHint: 'Create a term first — an offering has to belong to one.',
            },
        },
        {
            key: 'kindId',
            label: 'Kind',
            type: 'reference',
            required: true,
            reference: {
                resource: 'session-kinds',
                label: (row) => String(row.name ?? row.key),
                emptyHint: 'Create a session kind first — lecture, lab, seminar, whatever you call them.',
            },
        },
        {
            key: 'frequency',
            label: 'Sessions per term',
            type: 'number',
            min: 1,
            help: 'Exactly this many sessions must exist. Enforced as a hard constraint.',
        },
        {
            key: 'durationBlocks',
            label: 'Length in blocks',
            type: 'number',
            min: 1,
            help: 'How many consecutive TimeGrid blocks one session occupies.',
        },
        {
            key: 'requiredRoleId',
            label: 'Required role',
            type: 'reference',
            help: 'Scheduling role a lecturer must hold to lead this. Leave unset if it does not matter.',
            reference: {
                resource: 'roles',
                label: (row) => String(row.name ?? row.key),
                nullable: true,
                emptyHint: 'No roles defined yet.',
            },
        },
        {
            key: 'requiredCapacity',
            label: 'Required room capacity',
            type: 'number',
            min: 0,
            help: 'Leave unset to derive it from the attached groups.',
            derived: {
                path: '/api/offering-capacity/:id',
                describe: (data) => {
                    const capacity = data.capacity as number | null;
                    const basis = data.basis as string;
                    const groups = data.attachedGroups as number;

                    if (capacity === null) {
                        return groups === 0
                            ? 'No groups attached, so nothing can be derived \u2014 every room would qualify.'
                            : 'The attached groups have neither members nor an expected size, so nothing '
                                + 'can be derived \u2014 every room would qualify.';
                    }

                    const source = basis === 'membership'
                        ? `${capacity} enrolled ${capacity === 1 ? 'person' : 'people'}`
                        : 'expected sizes';

                    const line = `If left blank: ${capacity}, from ${groups} attached `
                        + `${groups === 1 ? 'group' : 'groups'} (${source}).`;

                    /*
                     * The warning belongs HERE, next to the decision it affects.
                     * A capacity of 4 where 96 are expected is still the honest
                     * count, but someone leaving this field blank on that basis
                     * should see why the number looks small before a room turns
                     * out to be far too small.
                     */
                    if (data.partialEnrolment) {
                        return `${line} Warning: only ${capacity} of an expected `
                            + `${data.estimate as number} are enrolled, so this may be incomplete.`;
                    }

                    return line;
                },
            },
        },
        {
            key: 'allowOnline',
            label: 'May be scheduled online',
            type: 'boolean',
            help: 'Lets the solver place this in a virtual room. Online delivery is a virtual room, not a session flag.',
        },
        { key: 'isActive', label: 'Active', type: 'boolean' },
        { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
    relations: [
        {
            key: 'groups',
            label: 'Groups this is for',
            help: 'Nesting propagates: assigning a cohort also blocks its seminars. '
                + 'Only groups available in this offering\u2019s term are listed.',
            resource: 'groups',
            valueKey: 'groupId',
            indentTree: true,
            optionLabel: (row) => String(row.name),
            // The Offering's own term. Without this the picker offered every
            // cohort the tenant has ever had, so nothing stopped attaching a
            // 2024 cohort to a 2027 Offering.
            scopeBy: { filter: 'termId', from: 'termId' },
            emptyHint: 'No groups available in this term.',
        },
        {
            key: 'lecturers',
            label: 'Who leads it',
            help: 'Optionally state the scheduling role each person fills here.',
            resource: 'persons',
            valueKey: 'personId',
            optionLabel: (row) => `${row.givenName} ${row.familyName}`,
            extraReference: {
                key: 'roleId',
                resource: 'roles',
                label: (row) => String(row.name ?? row.key),
                placeholder: 'Any role',
            },
            emptyHint: 'No people defined yet.',
        },
        {
            key: 'equipment',
            label: 'Equipment it needs',
            help: 'Restricts placement to rooms providing all of it. A count means at '
                + 'least that many units, so only rooms that state enough qualify.',
            resource: 'equipment',
            valueKey: 'equipmentId',
            optionLabel: (row) => String(row.name ?? row.key),
            quantity: { key: 'quantity', label: 'Count' },
            emptyHint: 'No equipment defined yet.',
        },
    ],
};

export const CONSTRAINT_ENTITY: ManageEntity = {
    key: 'constraints',
    permissionPrefix: 'constraint',
    label: 'Constraint',
    plural: 'Constraints',
    icon: 'material-symbols:checklist',
    description: 'The rules a timetable must respect, and the preferences it should weigh.',
    keywords: ['constraint', 'rule', 'hard', 'soft', 'penalty', 'conflict', 'policy'],
    title: (row) => String(row.name ?? 'Constraint'),
    detailComponent: 'ConstraintBuilder',
    /**
     * The catalogue is thirteen live types and every tenant holds one default
     * row for each, plus any scoped variants — bounded and small. The grid
     * needs the WHOLE set to group it correctly, and reports loudly rather than
     * silently truncating if it ever stops being complete.
     */
    listComponent: 'ConstraintGrid',
    listPageSize: 200,
    hideCreateAction: true,
    columns: [
        { key: 'name', label: 'Name' },
        { key: 'type', label: 'Type', format: 'code', secondary: true },
        { key: 'severity', label: 'Severity' },
        { key: 'weight', label: 'Weight', format: 'number' },
        { key: 'isEnabled', label: 'Enabled', format: 'boolean' },
    ],
    /*
     * `type`, `severity`, `weight` and `params` are all `custom`: they constrain
     * each other. The chosen type fixes the severity and dictates which
     * parameters exist, and weight is meaningful only when severity is SOFT — a
     * pairing the database CHECK enforces. Rendered as four independent controls
     * they would compose states the server rejects.
     */
    fields: [
        { key: 'name', label: 'Name', type: 'text', required: true },
        { key: 'type', label: 'Rule', type: 'select', required: true, createOnly: true, custom: true },
        { key: 'severity', label: 'Severity', type: 'select', required: true, custom: true },
        { key: 'weight', label: 'Penalty weight', type: 'number', custom: true },
        { key: 'params', label: 'Parameters', type: 'json', custom: true },
        /*
         * Kind scopes. `custom` because the builder renders the picker, and
         * because the value is an ARRAY — the shape that produced
         * "[object Object]" when a structured field reached ManageField. It is
         * declared here so it takes part in the draft, dirty tracking and the
         * payload, exactly as `time_grid.breaks` does.
         */
        { key: 'scopes', label: 'Applies to kinds', type: 'text', custom: true },
        { key: 'isEnabled', label: 'Enabled', type: 'boolean' },
    ],
};

export const MANAGE_ENTITIES: ManageEntity[] = [
    {
        key: 'persons',
        permissionPrefix: 'person',
        label: 'Person',
        plural: 'People',
        icon: 'material-symbols:person-outline',
        description: 'Everyone the timetable places or notifies.',
        keywords: ['people', 'staff', 'student', 'lecturer', 'teacher', 'roster', 'directory'],
        title: (row) => `${row.givenName ?? ''} ${row.familyName ?? ''}`.trim() || 'Person',
        columns: [
            { key: 'familyName', label: 'Family name' },
            { key: 'givenName', label: 'Given name' },
            { key: 'email', label: 'Email', secondary: true },
            { key: 'isActive', label: 'Active', format: 'boolean' },
        ],
        fields: [
            { key: 'givenName', label: 'Given name', type: 'text', required: true },
            { key: 'familyName', label: 'Family name', type: 'text', required: true },
            { key: 'email', label: 'Email', type: 'email' },
            {
                key: 'externalRef',
                label: 'External reference',
                type: 'text',
                help: 'Stable id from an external SIS or LDAP, used to reconcile imports.',
            },
            {
                key: 'timezone',
                label: 'Timezone',
                type: 'text',
                placeholder: 'Europe/Berlin',
                help: 'Display and export only. It never affects grid placement or "same day" logic.',
            },
            { key: 'isActive', label: 'Active', type: 'boolean' },
        ],
        relations: [
            {
                key: 'roles',
                label: 'Scheduling roles',
                help: 'What this person can be scheduled AS — Lecturer, Auditor. Not permissions.',
                resource: 'roles',
                valueKey: 'roleId',
                optionLabel: (row) => String(row.name ?? row.key),
                emptyHint: 'No roles defined yet.',
            },
            {
                key: 'access-roles',
                label: 'Access roles',
                help: 'What this person may DO in Calendry. Distinct from the scheduling roles '
                    + 'above, which are vocabulary and grant nothing.',
                resource: 'access-roles',
                valueKey: 'accessRoleId',
                optionLabel: (row) => String(row.name ?? row.key),
                emptyHint: 'No access roles defined yet.',
                emptyWarning: 'No access role assigned. This person can sign in and will be '
                    + 'shown an empty application — no schedule, no navigation.',
                /*
                 * No read gate declared: it is DERIVED from `resource` — see
                 * `relationReadRequirement`. `/api/access-roles` accepts either
                 * administration permission, and the derivation says so without
                 * this entry having to know.
                 */
                writeRequiresPermissions: ['person_access_role.assign'],
            },
            {
                key: 'groups',
                label: 'Group memberships',
                help: 'Which cohorts and seminars this person belongs to.',
                resource: 'groups',
                valueKey: 'groupId',
                indentTree: true,
                optionLabel: (row) => String(row.name),
                emptyHint: 'No groups defined yet.',
            },
        ],
    },

    {
        key: 'roles',
        permissionPrefix: 'role',
        label: 'Role',
        plural: 'Roles',
        icon: 'material-symbols:badge-outline',
        // The Role/AccessRole distinction is load-bearing (TAXONOMY.md §2 vs §4)
        // and the two share a word, so the UI says which one this is.
        description: 'Scheduling vocabulary — Lecturer, Auditor. Not permissions.',
        keywords: ['role', 'lecturer', 'auditor', 'vocabulary', 'title'],
        title: (row) => String(row.name ?? 'Role'),
        systemFlag: 'isSystem',
        columns: [
            { key: 'key', label: 'Key', format: 'code' },
            { key: 'name', label: 'Name' },
            { key: 'description', label: 'Description', secondary: true },
        ],
        fields: [
            {
                key: 'key',
                label: 'Key',
                type: 'text',
                required: true,
                createOnly: true,
                help: 'Stable identifier used by imports and constraints. Cannot be changed later.',
            },
            { key: 'name', label: 'Name', type: 'text', required: true },
            { key: 'description', label: 'Description', type: 'textarea' },
        ],
    },

    {
        key: 'rooms',
        permissionPrefix: 'room',
        label: 'Room',
        plural: 'Rooms',
        icon: 'material-symbols:meeting-room-outline',
        description: 'Physical and virtual spaces sessions can be placed in.',
        keywords: ['room', 'space', 'hall', 'lab', 'venue', 'building', 'capacity'],
        federationOwnable: true,
        title: (row) => [row.code, row.name].filter(Boolean).join(' · ') || 'Room',
        columns: [
            { key: 'code', label: 'Code', format: 'code' },
            { key: 'name', label: 'Name' },
            { key: 'capacity', label: 'Capacity', format: 'number' },
            { key: 'location', label: 'Location', secondary: true },
            { key: 'isActive', label: 'Active', format: 'boolean' },
        ],
        fields: [
            { key: 'code', label: 'Code', type: 'text', required: true },
            { key: 'name', label: 'Name', type: 'text', required: true },
            { key: 'capacity', label: 'Capacity', type: 'number', min: 0 },
            { key: 'location', label: 'Location', type: 'text' },
            {
                key: 'ranking',
                label: 'Ranking',
                type: 'number',
                /*
                 * Direction-neutral, because the constraint that reads this is
                 * now direction-neutral too. It used to say "soft constraints
                 * minimise use of high-ranking rooms", which stopped being the
                 * whole truth when "Steer room choice by rank" gained a
                 * direction: the same ranking can now be used to steer TOWARD
                 * the premium rooms.
                 */
                help: 'Desirability, HIGHER = more premium. The "Steer room choice by rank" '
                    + 'constraint reads this to bias placement toward one end of the scale.',
            },
            { key: 'isVirtual', label: 'Virtual', type: 'boolean' },
            { key: 'isActive', label: 'Active', type: 'boolean' },
        ],
        relations: [
            {
                key: 'equipment',
                label: 'Equipment in this room',
                help: 'What this room provides. Offerings requiring it can only be placed '
                    + 'here — and a count is what an offering asking for a minimum is '
                    + 'measured against. Left blank, this room answers presence only.',
                resource: 'equipment',
                valueKey: 'equipmentId',
                optionLabel: (row) => String(row.name ?? row.key),
                quantity: { key: 'quantity', label: 'Count' },
                emptyHint: 'No equipment defined yet.',
            },
        ],
    },

    {
        key: 'equipment',
        permissionPrefix: 'equipment',
        label: 'Equipment',
        plural: 'Equipment',
        icon: 'material-symbols:videocam-outline',
        description: 'Feature tags rooms provide and offerings require.',
        keywords: ['equipment', 'feature', 'projector', 'lab', 'tag', 'facility'],
        federationOwnable: true,
        title: (row) => String(row.name ?? 'Equipment'),
        columns: [
            { key: 'key', label: 'Key', format: 'code' },
            { key: 'name', label: 'Name' },
            { key: 'description', label: 'Description', secondary: true },
        ],
        fields: [
            {
                key: 'key',
                label: 'Key',
                type: 'text',
                required: true,
                createOnly: true,
                help: 'Stable identifier used by imports. Cannot be changed later.',
            },
            { key: 'name', label: 'Name', type: 'text', required: true },
            { key: 'description', label: 'Description', type: 'textarea' },
        ],
    },

    {
        key: 'groups',
        permissionPrefix: 'group',
        label: 'Group',
        plural: 'Groups',
        icon: 'material-symbols:account-tree-outline',
        description: 'Cohorts and their nested sub-groups.',
        keywords: ['group', 'cohort', 'class', 'section', 'seminar', 'nesting', 'hierarchy', 'tree'],
        title: (row) => String(row.name ?? 'Group'),
        listComponent: 'GroupTree',
        detailComponent: 'GroupForm',
        // A tree assembled from one page of rows would show orphans whose
        // parents are on page 2. See ManageGroupTree for what happens past this.
        listPageSize: 200,
        columns: [
            { key: 'name', label: 'Name' },
            { key: 'expectedSize', label: 'Expected size', format: 'number' },
            { key: 'description', label: 'Description', secondary: true },
        ],
        fields: [
            { key: 'name', label: 'Name', type: 'text', required: true },
            { key: 'description', label: 'Description', type: 'textarea' },
            {
                key: 'expectedSize',
                label: 'Expected size',
                type: 'number',
                min: 0,
                help: 'Advisory headcount for room-capacity checks. Membership remains the source of truth.',
            },
            {
                key: 'parentGroupId',
                label: 'Parent group',
                type: 'reference',
                // Rendered by ManageGroupForm: the option list depends on WHICH
                // group is being edited, since self and every descendant must be
                // excluded. A static registry entry cannot express that.
                custom: true,
                reference: {
                    resource: 'groups',
                    label: (row) => String(row.name ?? row.id),
                    nullable: true,
                    emptyHint: 'No other groups to nest under yet.',
                },
            },
        ],
        relations: [
            {
                key: 'terms',
                label: 'Available in terms',
                // The empty case is stated explicitly because it reads backwards:
                // an empty set WIDENS the group rather than hiding it. Leaving
                // the user to infer that from a blank list is how someone
                // "clears" a scope expecting the opposite.
                help: 'Leave empty to make this group available in every term. '
                    + 'Adding terms restricts it to those, which is what narrows the '
                    + 'group pickers on offerings in other terms.',
                resource: 'terms',
                valueKey: 'termId',
                optionLabel: (row) => String(row.name),
                emptyHint: 'Available in every term.',
            },
        ],
    },

    {
        key: 'time-grids',
        permissionPrefix: 'time_grid',
        label: 'Time grid',
        plural: 'Time grids',
        icon: 'material-symbols:grid-on-outline',
        description: 'Block length, blocks per day, and which days this institution teaches on.',
        keywords: ['time grid', 'timegrid', 'blocks', 'periods', 'slots', 'days', 'schedule shape'],
        title: (row) => String(row.name ?? 'Time grid'),
        detailComponent: 'TimeGridEditor',
        columns: [
            { key: 'name', label: 'Name' },
            { key: 'blocksPerDay', label: 'Blocks/day', format: 'number' },
            { key: 'blockLengthMinutes', label: 'Block length', format: 'number' },
            { key: 'activeDays', label: 'Days', format: 'weekdays' },
            { key: 'isDefault', label: 'Default', format: 'boolean' },
        ],
        /*
         * Every field is `custom`: the editor renders them against a live
         * preview of the resulting day, because these numbers are meaningless in
         * isolation — "45 minutes, 8 blocks, break 15" only becomes checkable
         * when you can see it lands at 17:00. They stay declared here so draft
         * seeding, dirty tracking, payload building and server-side field errors
         * all keep working exactly as they do for a generic entity.
         */
        fields: [
            { key: 'name', label: 'Name', type: 'text', required: true, custom: true },
            {
                key: 'blockLengthMinutes',
                label: 'Block length (minutes)',
                type: 'number',
                required: true,
                min: 1,
                custom: true,
            },
            { key: 'blocksPerDay', label: 'Blocks per day', type: 'number', required: true, min: 1, custom: true },
            { key: 'startHour', label: 'Start hour', type: 'number', min: 0, max: 23, custom: true },
            { key: 'startMinute', label: 'Start minute', type: 'number', min: 0, max: 59, custom: true },
            { key: 'breakMinutes', label: 'Default gap between blocks (minutes)', type: 'number', min: 0, custom: true },
            // custom: true keeps it in the draft, dirty tracking and the payload
            // while ManageTimeGridEditor supplies the control. Leaving it out of
            // the registry instead would drop it from the draft and silently
            // from saves — the trap Step 13 documented.
            { key: 'breaks', label: 'Named breaks', type: 'text', custom: true },
            { key: 'activeDays', label: 'Teaching days', type: 'select', required: true, custom: true },
            { key: 'isDefault', label: 'Default grid', type: 'boolean', custom: true },
        ],
    },

    {
        key: 'session-kinds',
        permissionPrefix: 'session_kind',
        label: 'Session kind',
        plural: 'Session kinds',
        icon: 'material-symbols:label-outline',
        description: 'Your own vocabulary — lecture, lab, seminar. Nothing here is built in.',
        keywords: ['kind', 'type', 'lecture', 'lab', 'seminar', 'exam', 'vocabulary', 'category'],
        title: (row) => String(row.name ?? 'Session kind'),
        columns: [
            { key: 'key', label: 'Key', format: 'code' },
            { key: 'name', label: 'Name' },
            { key: 'color', label: 'Colour', format: 'swatch' },
            { key: 'requiresGroup', label: 'Has groups', format: 'boolean' },
        ],
        fields: [
            {
                key: 'key',
                label: 'Key',
                type: 'text',
                required: true,
                createOnly: true,
                help: 'Stable identifier used by imports and constraints. Cannot be changed later.',
            },
            { key: 'name', label: 'Name', type: 'text', required: true },
            {
                key: 'color',
                label: 'Colour',
                type: 'color',
                help: 'Tints this kind on the schedule. Chips stay legible without it — colour is never the only cue.',
            },
            {
                key: 'requiresGroup',
                label: 'Carries groups',
                type: 'boolean',
                help: 'Whether sessions of this kind are expected to have Groups assigned. Lets a group-based constraint be rejected when aimed at a kind that has none.',
            },
        ],
    },

    OFFERING_ENTITY,
    CONSTRAINT_ENTITY,

    {
        /*
         * Lobby displays. Own handlers under `server/api/screens/`, not the
         * generic scaffold — a Screen carries a secret, and the scaffold returns
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
        label: 'Screen',
        plural: 'Screens',
        icon: 'material-symbols:cast-outline',
        description: 'Lobby and corridor displays showing live room occupancy.',
        keywords: [
            'screen', 'screens', 'display', 'displays', 'lobby', 'kiosk',
            'signage', 'board', 'monitor', 'tv', 'corridor', 'occupancy',
        ],
        title: (row) => String(row.name ?? 'Screen'),
        detailComponent: 'ScreenForm',
        columns: [
            { key: 'name', label: 'Name' },
            { key: 'roomSummary', label: 'Shows' },
            { key: 'isActive', label: 'Active', format: 'boolean' },
            { key: 'lastSeenAt', label: 'Last seen', format: 'date', secondary: true },
        ],
        fields: [
            {
                key: 'name',
                label: 'Name',
                type: 'text',
                required: true,
                help: 'Where the display physically is — "Main entrance", "B-block corridor" — '
                    + 'so the right one can be revoked without a guess.',
            },
            {
                key: 'isActive',
                label: 'Active',
                type: 'boolean',
                help: 'Turning a screen off stops its key working immediately, and is reversible. '
                    + 'Deleting it is not.',
            },
            /*
             * `custom`, because both controls are bespoke: the room scope needs
             * "empty means every room" stated in words rather than inferred from
             * a blank multi-select, and the key can only ever be shown once.
             */
            {
                key: 'roomIds',
                label: 'Rooms shown',
                /*
                 * `reference`, not `text`, and that is what makes the picker
                 * work at all: `referencedResources()` builds the form's fetch
                 * wave from fields carrying one, so a field without it renders
                 * an empty list reading "No rooms defined yet" in a tenant full
                 * of rooms. Shipped exactly that way once.
                 *
                 * `custom` because the control is a multi-select whose EMPTY
                 * state means "every room" — a meaning no generic reference
                 * control can convey, and the opposite of what a blank select
                 * looks like.
                 */
                type: 'reference',
                custom: true,
                reference: {
                    resource: 'rooms',
                    label: (row) => String(row.name ?? row.code ?? row.id),
                    nullable: true,
                    emptyHint: 'No rooms defined yet.',
                },
            },
            /*
             * The device key, generated in the BROWSER and shown once — the same
             * shape as an account's initial password, and for the same reason:
             * the create page navigates away on success, so a server-generated
             * secret would be gone before it could be read. `custom` because the
             * control is the display URL with a copy button, not a text input.
             */
            { key: 'key', label: 'Display address', type: 'text', custom: true },
        ],
    },

    {
        key: 'terms',
        permissionPrefix: 'term',
        label: 'Term',
        plural: 'Terms',
        icon: 'material-symbols:calendar-month-outline',
        description: 'Academic periods sessions are scheduled within.',
        keywords: ['term', 'semester', 'trimester', 'academic', 'year', 'period'],
        title: (row) => String(row.name ?? 'Term'),
        columns: [
            { key: 'name', label: 'Name' },
            { key: 'startDate', label: 'Starts', format: 'date' },
            { key: 'endDate', label: 'Ends', format: 'date' },
        ],
        fields: [
            { key: 'name', label: 'Name', type: 'text', required: true },
            { key: 'startDate', label: 'Start date', type: 'date', required: true },
            { key: 'endDate', label: 'End date', type: 'date', required: true },
            {
                key: 'timeGridId',
                label: 'Time grid',
                type: 'reference',
                help: 'Which grid this term is scheduled on. Falls back to the tenant default when unset.',
                reference: {
                    resource: 'time-grids',
                    label: (row) => String(row.name ?? row.id),
                    nullable: true,
                    emptyHint: 'No time grids configured yet.',
                },
            },
        ],
    },

    {
        key: 'calendar-periods',
        // A child of Term, so `term.update` governs it — changing when a term's
        // exam period falls IS editing the term. Same reasoning as
        // `time_grid_break` living under `time_grid.update`.
        permissionPrefix: 'term',
        label: 'Calendar period',
        plural: 'Calendar periods',
        icon: 'material-symbols:event-busy-outline',
        description: 'Holidays, break weeks and exam periods within a term.',
        keywords: ['calendar', 'period', 'holiday', 'break', 'exam', 'vacation', 'reading week', 'recess'],
        title: (row) => String(row.name ?? 'Calendar period'),
        detailComponent: 'CalendarPeriodForm',
        columns: [
            { key: 'name', label: 'Name' },
            { key: 'kind', label: 'Kind' },
            { key: 'startDate', label: 'Starts', format: 'date' },
            { key: 'endDate', label: 'Ends', format: 'date' },
        ],
        fields: [
            {
                key: 'termId',
                label: 'Term',
                type: 'reference',
                required: true,
                createOnly: true,
                help: 'Which term this period falls in. Cannot be changed afterwards — '
                    + 'moving a period to another term is creating a different period.',
                reference: {
                    resource: 'terms',
                    label: (row) => String(row.name ?? row.id),
                    emptyHint: 'No terms configured yet.',
                },
            },
            {
                key: 'kind',
                label: 'Kind',
                type: 'select',
                required: true,
                // Structural, not tenant vocabulary: TAXONOMY.md §2 names these
                // three explicitly, and each has different week-classification
                // semantics that only exist because the set is fixed.
                options: [
                    { value: 'EXAM', label: 'Exam period' },
                    { value: 'BREAK', label: 'Break' },
                    { value: 'HOLIDAY', label: 'Holiday' },
                ],
                help: 'An EXAM period claims any week it touches. A BREAK or HOLIDAY '
                    + 'claims a week only if it covers the whole of it.',
            },
            { key: 'name', label: 'Name', type: 'text', required: true },
            { key: 'startDate', label: 'Start date', type: 'date', required: true },
            { key: 'endDate', label: 'End date', type: 'date', required: true },
            {
                key: 'weekPreview',
                label: 'Weeks this reclassifies',
                type: 'text',
                // Rendered by ManageCalendarPeriodPreview. `custom` keeps the key
                // out of the payload while leaving the field in the form's
                // layout — there is no `weekPreview` column.
                custom: true,
            },
        ],
    },

    /**
     * Account — the LOGIN, which is not a Person.
     *
     * THE DISTINCTION THIS SECTION EXISTS TO MAKE VISIBLE: a Person is who the
     * timetable places and notifies (TAXONOMY.md §2); an Account is a credential
     * that can act as one Person per institution (§4). Creating a Person
     * therefore does not create a login — which is exactly the gap that sent
     * admins to `bun run create:account`, where an already-existing Person
     * answered "already exists" and the trail ended.
     *
     * SECTION GATE IS `account.read`, and reading the API additionally accepts
     * `account.manage` — the same deliberate divergence `access-roles` carries in
     * the opposite direction. A role that may issue logins therefore needs
     * `account.read` as well to see the section; the API stays usable either way
     * so a create response and the person picker never 403 under a manage-only
     * role.
     *
     * Second-to-last, immediately before Access roles: the two administration
     * sections belong together, and this is the one you visit first — a login is
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
        label: 'Login',
        plural: 'Logins',
        icon: 'material-symbols:key-outline',
        description: 'How people sign in — credentials, separate from the people they act as.',
        keywords: [
            'account', 'accounts', 'login', 'logins', 'credential', 'password',
            'sign in', 'signin', 'user', 'users', 'reset',
        ],
        title: (row) => String(row.email ?? 'Login'),
        detailComponent: 'AccountForm',
        columns: [
            { key: 'email', label: 'Email' },
            { key: 'personName', label: 'Acts as' },
            { key: 'isActive', label: 'Active', format: 'boolean' },
            { key: 'mustChangePassword', label: 'Must change', format: 'boolean', secondary: true },
            { key: 'lastLoginAt', label: 'Last sign-in', format: 'date', secondary: true },
        ],
        fields: [
            {
                key: 'email',
                label: 'Email',
                type: 'email',
                required: true,
                help: 'The sign-in address, and unique across the whole deployment — one '
                    + 'credential can act in several institutions.',
            },
            /*
             * `custom`, so the control is the bespoke picker over
             * `/api/accounts/candidates` rather than a `reference` field over
             * every Person. Most people already have a login, and offering them
             * produces a 409 from `@@unique([personId])` after the form is
             * filled in. Declared here so the key still takes part in the draft,
             * dirty tracking and the payload — omitting it drops it from saves
             * silently.
             */
            { key: 'personId', label: 'Acts as', type: 'text', required: true, custom: true },
            /*
             * `createOnly` AND `custom`. Changing a password later is an explicit
             * verb (`POST /api/accounts/:id/reset-password`) because it revokes
             * every session, so an editable field on the detail page would offer
             * that consequence as an ordinary save.
             */
            { key: 'password', label: 'Initial password', type: 'text', createOnly: true, custom: true },
            /*
             * Explicit consent to reuse the credential that already holds the
             * typed address, rather than minting a second one. A FIELD and not a
             * second endpoint, because it has to ride along in the create payload
             * the shared form builds — and because it belongs to the draft: the
             * admin's answer to "attach instead?" is part of what they are about
             * to submit, not a separate action.
             */
            { key: 'attachExisting', label: 'Attach the existing login', type: 'boolean', createOnly: true, custom: true },
            {
                key: 'mustChangePassword',
                label: 'Must choose a new password at first sign-in',
                type: 'boolean',
                help: 'A password an administrator knows is a shared secret. This is what makes '
                    + 'that temporary — sign-in succeeds but issues no session until it is changed.',
            },
            {
                key: 'isActive',
                label: 'Active',
                type: 'boolean',
                help: 'Deactivating blocks sign-in immediately, in every institution this '
                    + 'credential is used at. The Person stays on the timetable either way.',
            },
        ],
    },

    /**
     * AccessRole — who may DO what, as opposed to the domain Role directly
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
        label: 'Access role',
        plural: 'Access roles',
        icon: 'material-symbols:admin-panel-settings-outline',
        description: 'Who may do what — bundles of permissions people are granted.',
        keywords: ['access', 'permission', 'role', 'admin', 'rights', 'authorization', 'security'],
        title: (row) => String(row.name ?? 'Access role'),
        detailComponent: 'AccessRoleForm',
        // `tenant-admin` is provisioning's own row: renamable, never deletable.
        // The server refuses it too — this only stops offering the button.
        systemFlag: 'isSystem',
        columns: [
            { key: 'key', label: 'Key', format: 'code' },
            { key: 'name', label: 'Name' },
            { key: 'description', label: 'Description', secondary: true },
        ],
        fields: [
            {
                key: 'key',
                label: 'Key',
                type: 'text',
                required: true,
                createOnly: true,
                help: 'Stable identifier. `create:account --role <key>` and any import address the role by it, '
                    + 'so it cannot be changed later.',
            },
            { key: 'name', label: 'Name', type: 'text', required: true },
            { key: 'description', label: 'Description', type: 'textarea' },
            /*
             * The grants. `custom` because the control is a matrix over the
             * fixed catalogue rather than a field, and because the value is an
             * ARRAY — the shape that renders as "[object Object]" if it ever
             * reaches ManageField. Declared here so it takes part in the draft,
             * dirty tracking and the payload, exactly as `constraint.scopes`
             * does.
             */
            { key: 'permissions', label: 'Permissions', type: 'text', custom: true },
        ],
    },
];


export function findManageEntity(key: string | undefined): ManageEntity | undefined {
    return MANAGE_ENTITIES.find((entity) => entity.key === key);
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
 * What a caller needs to be OFFERED this relation — derived, never declared.
 *
 * Every relation's option list is fetched in ONE `Promise.all`, so a single 403
 * takes down the whole wave — and because `useEntityRelations` awaits a
 * useAsyncData handle that RESOLVES rather than rejects, the result is not a blank
 * page but every picker rendering empty. Measured: without this gating a person
 * editor's Person page says "No roles defined yet" over a tenant that has them.
 *
 * Derived rather than declared so a new relation is gated by construction and one
 * that changes what it fetches cannot drift from its own gate. The result is an
 * AND of ORs: every endpoint must be reachable, and one may accept several
 * permissions — `lecturers` fetches persons AND roles.
 */
export function relationReadRequirement(def: RelationDef): PermissionRequirement {
    return relationOptionResources(def).map((resource) => {
        const permissions = resourcePermissions(resource, 'read');

        /*
         * A resource nothing can name fails CLOSED — an empty clause is
         * unsatisfiable, so the picker is hidden rather than offered against an
         * endpoint whose gate nobody can predict. That would be a silent
         * vanishing, which this codebase treats as worse than a loud failure,
         * so `tests/manage-relation-gates.test.ts` refuses to let one ship.
         */
        return permissions ? [...permissions] : [];
    });
}

/** The four CRUD permissions for an entity, in catalogue form. */
export function entityPermission(entity: ManageEntity, action: 'read' | 'create' | 'update' | 'delete'): string {
    return entity.permissionOverrides?.[action] ?? `${entity.permissionPrefix}.${action}`;
}

/**
 * Fields the form should render for this mode. `createOnly` fields are dropped
 * on edit because the server's update schema rejects them — rendering them
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
