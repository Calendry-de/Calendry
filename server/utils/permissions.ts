/**
 * The fixed permission catalogue (TAXONOMY.md §4).
 *
 * Tenants configure ROLES — named bundles of these — but never the permissions
 * themselves, because each one corresponds to a code path and tenants do not
 * write code. This list is mirrored into the `permission` table by migration so
 * that `access_role_permission` can hold a real foreign key.
 *
 * Adding a permission means: add it here, add it to the migration's catalogue
 * INSERT, and grant it to whichever access roles should have it. Removing one
 * is a breaking change for every tenant that assigned it.
 */
export interface PermissionDef {
    key: string;
    category: string;
    description: string;
}

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

function crudPermissions(): PermissionDef[] {
    const out: PermissionDef[] = [];

    for (const prefix of Object.values(CRUD_RESOURCES)) {
        for (const action of ['read', 'create', 'update', 'delete'] as CrudAction[]) {
            out.push({
                key: `${prefix}.${action}`,
                category: prefix,
                description: `${action} ${prefix.replace('_', ' ')} records`,
            });
        }
    }

    return out;
}

export const PERMISSIONS: PermissionDef[] = [
    ...crudPermissions(),

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

    // Administration
    { key: 'access_role.manage', category: 'administration', description: 'Create and edit access roles' },
    { key: 'person_access_role.assign', category: 'administration', description: 'Grant or revoke access roles' },
];

export const PERMISSION_KEYS = PERMISSIONS.map((p) => p.key);

/** Permission required for a generic CRUD route. */
export function crudPermission(resource: string, action: CrudAction): string {
    const prefix = CRUD_RESOURCES[resource as keyof typeof CRUD_RESOURCES];

    if (!prefix) {
        throw createError({ statusCode: 404, statusMessage: `Unknown resource '${resource}'.` });
    }

    return `${prefix}.${action}`;
}
