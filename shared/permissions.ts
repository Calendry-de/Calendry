/**
 * The fixed permission catalogue (TAXONOMY.md §4).
 *
 * Tenants configure ROLES — named bundles of these — but never the permissions
 * themselves, because each one corresponds to a code path and tenants do not
 * write code.
 *
 * WHY THIS IS IN `shared/` RATHER THAN `server/utils/`
 *
 * Four consumers need the identical list and cannot be allowed to disagree
 * about it: the seed that mirrors it into the `permission` table, the operator
 * CLIs that validate a requested key against it, the API that validates a
 * submitted one, and — since Step 14 — the role editor, which renders a
 * checkbox per permission.
 *
 * That last one is the reason for the move. The editor renders from THIS
 * CATALOGUE, never from a fetch of the `permission` table, for the same reason
 * the constraint grid renders from `shared/constraintTypes.ts`: a permission
 * the code implements but the database has not been seeded with must be
 * REPORTED, not silently missing from a list that looks complete.
 *
 * HOW IT REACHES THE DATABASE. Not by migration — migrations here are
 * schema-only and the `permission` table is created empty on purpose. The rows
 * are written by `prisma db seed` (prisma/seeds/reference/permissions.ts),
 * which both container entrypoints run immediately after `migrate deploy`.
 * Adding a permission is therefore: add it here, run `db seed`, then
 * `bun run grant:permissions -- --role tenant-admin --all-missing` on every
 * EXISTING tenant — provisioning grants the whole catalogue only at creation
 * time, so without that last step the symptom is a 403 on a feature that
 * visibly exists. Removing one is a breaking change for every tenant that
 * assigned it.
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
    // Tenant-open vocabulary (TAXONOMY.md §1): the `kind` values an Offering or
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
     * Holidays, break weeks and exam periods — the academic calendar
     * (TAXONOMY.md §2, "FIXED, core from day one").
     *
     * Mapped to `term`, NOT a permission of its own. A calendar period is a
     * child of Term with a mandatory `term_id`, exactly as `time_grid_break` is
     * a child of TimeGrid, and the same reasoning applies: changing when a
     * term's exam period falls IS editing the term. A separate
     * `calendar_period.manage` would be authority over a TABLE rather than over
     * a capability, and would need a backfill on every existing tenant or the
     * feature 403s on a screen that visibly exists.
     */
    'calendar-periods': 'term',
} as const;

export type CrudAction = 'read' | 'create' | 'update' | 'delete';

/**
 * Prefixes, DEDUPLICATED — two segments share `term` on purpose (above).
 *
 * `CrudResource` is the segment; `CrudPrefix` is what the permission is named
 * after. They are not the same set and conflating them is what produced the
 * duplicate-key bug this file's history records.
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
 * `as const satisfies` rather than a plain annotation: `satisfies` checks the
 * shape without WIDENING the literals, which is what lets `PermissionKey` below
 * be a real union of the keys instead of `string`. An annotation here would
 * type-check identically and silently give up every downstream guarantee.
 */
const EXPLICIT_PERMISSIONS = [
    // Session editing — explicit verbs, mirroring the routes (TAXONOMY.md §3).
    { key: 'session.read', category: 'session', description: 'View the schedule' },
    { key: 'session.create', category: 'session', description: 'Create a Session or Event directly' },
    { key: 'session.move', category: 'session', description: 'Re-place a Session' },
    { key: 'session.swap', category: 'session', description: 'Swap two Sessions' },
    { key: 'session.lock', category: 'session', description: 'Lock or unlock a Session' },
    /**
     * Its own permission rather than a reuse of `session.create`.
     *
     * Deletion is irreversible in a way creation is not: an Event carries no
     * Offering, so nothing re-creates it and the only record left is the DELETE
     * event. Separating it lets a tenant grant "put things on the calendar"
     * without also granting "take them off".
     *
     * NOTE the cost, which CLAUDE.md documents: a permission added after a
     * tenant was provisioned is not held by anyone until
     * `grant:permissions --all-missing` runs, and the symptom is a 403 on a
     * feature that visibly exists.
     */
    { key: 'session.update', category: 'session', description: "Edit an Event's title, kind, groups and people" },
    { key: 'session.delete', category: 'session', description: 'Delete an Event (a Session with no Offering)' },

    // Operations
    { key: 'generation.apply', category: 'generation', description: 'Promote a Generation to the current baseline' },
    { key: 'solver.trigger', category: 'solver', description: 'Request a solver run' },
    { key: 'violation.read', category: 'violation', description: 'View current constraint violations' },
    { key: 'notification.preview', category: 'notification', description: 'Resolve who a Session change affects' },

    /**
     * Availability — declared unavailability (a HARD constraint) and soft
     * scheduling preferences.
     *
     * `manage_own` is the SELF-SERVICE capability and covers reading and writing
     * your own settings in one key. Splitting it would create "may write but not
     * read your own availability", which is nonsense — and this catalogue has no
     * implication mechanism, so a nonsense pairing is reachable by grant.
     *
     * It is a granted permission rather than an inherent right, and that was the
     * load-bearing call in the design. The data is yours; the CONSEQUENCE is the
     * tenant's, because an unreviewed veto can make a term infeasible. Tenants
     * genuinely differ on whether staff self-declare or a scheduler collects it,
     * so it has to be grantable.
     *
     * What it does NOT do is carry any "own row only" semantics of its own. The
     * scoping is structural: `/api/me/*` takes no person id from the URL or the
     * body, so another Person's row is unnameable rather than merely rejected. A
     * self-scoped FLAG in this catalogue would mean the generic route machinery
     * had to understand ownership, and a permission marked self-scoped that one
     * route forgets to narrow reads as safe while being tenant-wide.
     *
     * `manage_any` is deliberately not folded into `person.update`. That
     * currently means "rename people, change their email"; widening it to
     * "declare when the timetable may not use them" would be a silent authority
     * increase for everyone who already holds it.
     */
    { key: 'availability.manage_own', category: 'availability', description: 'Set your own unavailability and teaching preferences' },
    { key: 'availability.read_any', category: 'availability', description: "View anyone's unavailability and preferences" },
    { key: 'availability.manage_any', category: 'availability', description: 'Set, approve and reject unavailability for anyone' },

    // Administration
    { key: 'access_role.manage', category: 'administration', description: 'Create and edit access roles' },
    { key: 'person_access_role.assign', category: 'administration', description: 'Grant or revoke access roles' },
] as const satisfies readonly PermissionShape[];

/**
 * Every permission the code implements, as a UNION rather than `string`.
 *
 * This is what makes the role editor and the write-boundary schema typed
 * against the same thing the seed writes: a checkbox bound to a key that is not
 * in the catalogue, or a zod schema admitting one, is a compile error rather
 * than a foreign-key violation discovered by a tenant.
 */
export type PermissionKey = `${CrudPrefix}.${CrudAction}` | (typeof EXPLICIT_PERMISSIONS)[number]['key'];

export interface PermissionDef {
    key: PermissionKey;
    category: string;
    description: string;
}

/**
 * Iterated over DISTINCT PREFIXES, not over the entries.
 *
 * Two resource segments deliberately share one prefix: `calendar-periods` maps
 * to `term`. Iterating the entries emitted `term.read/create/update/delete`
 * TWICE — 57 entries where the catalogue has 53 keys.
 *
 * That was not cosmetic. `provision-tenant.ts` inserts this array into
 * `access_role_permission` with a single `createMany` and no `skipDuplicates`,
 * and Postgres rejects duplicate primary keys inside one INSERT — so
 * provisioning a NEW tenant failed outright from the moment `calendar-periods`
 * was added, with the existing tenant unaffected because
 * `grant:permissions --all-missing` computes what is missing and skips
 * duplicates. Anything rendering the catalogue as a list had the same problem
 * one level up: two identical rows under one key.
 *
 * `Set` rather than a dedupe of the OUTPUT, so the duplication never exists.
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
 * Narrows an untrusted string to a catalogue key.
 *
 * The single place `unknown` becomes `PermissionKey` — used by the API schema
 * and by the role editor when it reads a stored grant. Everything downstream of
 * it is typed, so a key that is not in the catalogue is rejected once, at the
 * boundary, with the key named.
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
 * The catalogue grouped for display, in catalogue order.
 *
 * Order comes from the array rather than an alphabetical sort so the editor
 * shows the same shape this file reads in: the managed entities first, then
 * the schedule verbs, then operations, then administration. A sort would put
 * `access_role` at the top, which is the least commonly granted group.
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
 * `access_role` is the case that forced this. The catalogue has held
 * `access_role.manage` and `person_access_role.assign` since the beginning —
 * two capabilities, not eight CRUD verbs — and inventing
 * `access_role.read/create/update/delete` to fit the generic shape would mean
 * editing the catalogue, re-seeding, and backfilling every existing tenant, to
 * end up with `access_role.manage` still checked by nothing. The registry bends
 * to the catalogue, not the other way round.
 *
 * ANY of the listed permissions is sufficient, which matters for exactly one
 * entry: reading the role list. The manage SECTION requires
 * `access_role.manage`, but the Person page's role picker needs the same list
 * under `person_access_role.assign` — a tenant may reasonably define a
 * registrar who grants existing roles without being able to invent new ones.
 *
 * SHARED, not server-only, and that is the point of it living here. The routes
 * enforce this map; the management UI has to PREDICT it, so that a page never
 * assembles a fetch wave it will be refused. Two copies of "what does reading
 * rooms require" would disagree eventually, and the symptom would be a picker
 * that renders empty instead of being absent — the exact failure this map is
 * now used to prevent.
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
