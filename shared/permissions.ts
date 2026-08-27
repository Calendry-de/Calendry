/**
 * The fixed permission catalogue (TAXONOMY.md §4). Tenants configure ROLES —
 * named bundles of these — but never the permissions themselves.
 *
 * In `shared/` because four consumers must not disagree about the list: the seed
 * that mirrors it into the `permission` table, the operator CLIs, the API
 * validator, and the role editor. The editor renders from THIS catalogue, never
 * from a fetch of the table, so a permission the code implements but the database
 * lacks is reported rather than silently missing from a list that looks complete.
 *
 * Adding one: add it here, run `db seed`, then `bun run grant:permissions --role
 * tenant-admin --all-missing` on every EXISTING tenant — provisioning grants the
 * catalogue only at creation time, so without that step the symptom is a 403 on a
 * feature that visibly exists.
 */

/** Entities served by the generic CRUD routes, and their permission prefix. */
export const CRUD_RESOURCES = {
    persons: 'person',
    roles: 'role',
    groups: 'group',
    rooms: 'room',
    equipment: 'equipment',
    offerings: 'offering',
    'time-grids': 'time_grid',
    terms: 'term',
    constraints: 'constraint',
    // Tenant-open vocabulary (TAXONOMY.md §1). `session_kind`, not `session`:
    // renaming the vocabulary is not the authority to move the timetable.
    // Session can carry. Added in Step 13 because there was no way to create one
    // — provisioning deliberately makes none, so a fresh tenant could not create
    // an Offering at all, its `kindId` being a required FK to a table with no
    // rows and no route.
    //
    // Note `session_kind`, not `session`: session.read/move/swap/lock are about
    // placed Sessions. Being able to rename the vocabulary is not the same
    // authority as being able to move the timetable.
    'session-kinds': 'session_kind',
    /**
     * The academic calendar, mapped to `term` rather than a permission of its
     * own: a calendar period is a child of Term with a mandatory `term_id`, and
     * changing when an exam period falls IS editing the term. A separate key
     * would need a backfill on every existing tenant.
     */
    'calendar-periods': 'term',
} as const;

export type CrudAction = 'read' | 'create' | 'update' | 'delete';

/**
 * Prefixes, DEDUPLICATED — two segments share `term` on purpose. `CrudResource`
 * is the segment, `CrudPrefix` what the permission is named after; conflating
 * them produced the duplicate-key bug below.
 */
export type CrudResource = keyof typeof CRUD_RESOURCES;
export type CrudPrefix = (typeof CRUD_RESOURCES)[CrudResource];

const CRUD_ACTIONS = ['read', 'create', 'update', 'delete'] as const;

interface PermissionShape {
    key: string;
    category: string;
    description: string;
}

/**
 * Everything that is not a CRUD verb on a managed entity.
 *
 * `as const satisfies`, not an annotation: `satisfies` checks the shape without
 * WIDENING the literals, which is what lets `PermissionKey` be a real union
 * instead of `string`.
 */
const EXPLICIT_PERMISSIONS = [
    // Session editing — explicit verbs, mirroring the routes (TAXONOMY.md §3).
    { key: 'session.read', category: 'session', description: 'View the schedule' },
    { key: 'session.create', category: 'session', description: 'Create a Session or Event directly' },
    { key: 'session.move', category: 'session', description: 'Re-place a Session' },
    { key: 'session.swap', category: 'session', description: 'Swap two Sessions' },
    { key: 'session.lock', category: 'session', description: 'Lock or unlock a Session' },
    /**
     * Its own permission: an Event carries no Offering, so nothing re-creates it
     * and deletion is irreversible in a way creation is not. Lets a tenant grant
     * "put things on the calendar" without "take them off".
     */
    { key: 'session.update', category: 'session', description: "Edit an Event's title, kind, groups and people" },
    { key: 'session.delete', category: 'session', description: 'Delete an Event (a Session with no Offering)' },

    // Operations
    { key: 'generation.apply', category: 'generation', description: 'Promote a Generation to the current baseline' },
    { key: 'solver.trigger', category: 'solver', description: 'Request a solver run' },
    { key: 'violation.read', category: 'violation', description: 'View current constraint violations' },
    { key: 'notification.preview', category: 'notification', description: 'Resolve who a Session change affects' },

    /**
     * Availability. `manage_own` covers reading and writing your own settings in
     * one key — splitting it would allow "may write but not read your own", and
     * this catalogue has no implication mechanism.
     *
     * Grantable rather than an inherent right, deliberately: the data is yours,
     * the CONSEQUENCE is the tenant's, since an unreviewed veto can make a term
     * infeasible. It carries no "own row only" semantics — that scoping is
     * structural, because `/api/me/*` takes no person id at all.
     *
     * `manage_any` is not folded into `person.update`: widening "rename people"
     * to "declare when the timetable may not use them" would be a silent
     * authority increase for everyone already holding it.
     */
    { key: 'availability.manage_own', category: 'availability', description: 'Set your own unavailability and teaching preferences' },
    { key: 'availability.read_any', category: 'availability', description: "View anyone's unavailability and preferences" },
    { key: 'availability.manage_any', category: 'availability', description: 'Set, approve and reject unavailability for anyone' },

    // Administration
    { key: 'access_role.manage', category: 'administration', description: 'Create and edit access roles' },
    { key: 'person_access_role.assign', category: 'administration', description: 'Grant or revoke access roles' },
] as const satisfies readonly PermissionShape[];

/**
 * A UNION rather than `string`, so a checkbox bound to a key outside the
 * catalogue is a compile error rather than a foreign-key violation found by a
 * tenant.
 */
export type PermissionKey = `${CrudPrefix}.${CrudAction}` | (typeof EXPLICIT_PERMISSIONS)[number]['key'];

export interface PermissionDef {
    key: PermissionKey;
    category: string;
    description: string;
}

/**
 * Over DISTINCT PREFIXES, not entries: `calendar-periods` maps to `term`, so
 * iterating entries emitted `term.*` twice. `provision-tenant.ts` inserts this
 * with one `createMany` and no `skipDuplicates`, so provisioning a new tenant
 * failed outright. A `Set` means the duplication never exists.
 * Pinned by tests/permission-catalogue.test.ts.
 */
function crudPermissions(): PermissionDef[] {
    const out: PermissionDef[] = [];

    for (const prefix of new Set(Object.values(CRUD_RESOURCES))) {
        for (const action of CRUD_ACTIONS) {
            out.push({
                key: `${prefix}.${action}`,
                category: prefix,
                description: `${action} ${prefix.replace('_', ' ')} records`,
            });
        }
    }

    return out;
}

export const PERMISSIONS: readonly PermissionDef[] = [...crudPermissions(), ...EXPLICIT_PERMISSIONS];

export const PERMISSION_KEYS: readonly PermissionKey[] = PERMISSIONS.map((p) => p.key);

const PERMISSION_KEY_SET: ReadonlySet<string> = new Set<string>(PERMISSION_KEYS);

/**
 * The single place `unknown` becomes `PermissionKey`, so a bad key is rejected
 * once, at the boundary, with the key named.
 */
export function isPermissionKey(value: unknown): value is PermissionKey {
    return typeof value === 'string' && PERMISSION_KEY_SET.has(value);
}

export function findPermission(key: string): PermissionDef | undefined {
    return PERMISSIONS.find((permission) => permission.key === key);
}

export interface PermissionCategory {
    key: string;
    permissions: PermissionDef[];
}

/**
 * Grouped for display in catalogue order, not sorted: a sort would put
 * `access_role` first, which is the least commonly granted group.
 */
export function permissionCategories(): PermissionCategory[] {
    const byKey = new Map<string, PermissionCategory>();

    for (const permission of PERMISSIONS) {
        const existing = byKey.get(permission.category);

        if (existing) {
            existing.permissions.push(permission);
        } else {
            byKey.set(permission.category, { key: permission.category, permissions: [permission] });
        }
    }

    return [...byKey.values()];
}

/**
 * Resources whose permissions are NOT `<prefix>.<action>`.
 *
 * `access_role` forced this: the catalogue has held `access_role.manage` and
 * `person_access_role.assign` from the start — two capabilities, not eight CRUD
 * verbs — and inventing the CRUD shape would mean re-seeding and backfilling
 * every tenant to end up with `access_role.manage` checked by nothing.
 *
 * ANY listed permission suffices, which matters for reading the role list: the
 * manage section needs `access_role.manage`, but the Person page's role picker
 * needs the same list under `person_access_role.assign`.
 *
 * SHARED, not server-only: the routes enforce this map and the management UI has
 * to PREDICT it, so a page never assembles a fetch wave it will be refused.
 */
export const RESOURCE_PERMISSIONS: Record<string, Partial<Record<CrudAction, readonly PermissionKey[]>>> = {
    'access-roles': {
        read: ['access_role.manage', 'person_access_role.assign'],
        create: ['access_role.manage'],
        update: ['access_role.manage'],
        delete: ['access_role.manage'],
    },
};

/**
 * Permissions accepted for one action on a resource — ANY one is sufficient.
 *
 * `undefined` means the question cannot be answered: either the resource is not
 * served by the generic routes at all, or it is declared above and does not
 * name this action. The two are different problems and the caller distinguishes
 * them — the API answers 404 for the first and 500 for the second, rather than
 * falling through to a prefix rule that would gate a write on a permission
 * nobody chose.
 */
export function resourcePermissions(
    resource: string,
    action: CrudAction,
): readonly PermissionKey[] | undefined {
    const declared = RESOURCE_PERMISSIONS[resource];

    if (declared) {
        return declared[action];
    }

    const prefix = CRUD_RESOURCES[resource as CrudResource];

    return prefix ? [`${prefix}.${action}`] : undefined;
}

/**
 * A permission requirement: AND of ORs.
 *
 * Each entry must be satisfied; an entry that is an ARRAY is satisfied by any
 * one of its members. So:
 *
 *     ['role.read']                                  role.read
 *     ['person.read', 'role.read']                   BOTH
 *     [['access_role.manage', 'person_access_role.assign']]   EITHER
 *
 * The two levels are not decoration. A management page's relation picker
 * fetches its options from one or more endpoints, and it may only be offered if
 * EVERY one of them is reachable — while a single endpoint can accept SEVERAL
 * permissions. One level cannot express both, and the version of this that had
 * only the any-of level got the `lecturers` picker wrong: it fetches persons
 * AND roles, so "any of person.read, role.read" would have offered a picker
 * that renders half empty.
 */
export type PermissionRequirement = readonly (string | readonly string[])[];

/** Whether `held` satisfies every clause of `requirement`. */
export function satisfiesPermissionRequirement(
    held: ReadonlySet<string>,
    requirement: PermissionRequirement,
): boolean {
    return requirement.every((clause) => (typeof clause === 'string'
        ? held.has(clause)
        // An EMPTY alternatives array is unsatisfiable, deliberately. It means
        // "one of nothing", and the shape that produces it is a bug in whatever
        // built the requirement — failing closed reports it, failing open hides
        // it behind a control that then 403s.
        : clause.some((permission) => held.has(permission))));
}
