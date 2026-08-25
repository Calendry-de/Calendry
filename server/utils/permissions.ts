import { CRUD_RESOURCES } from '../../shared/permissions';
import type { CrudAction, PermissionKey } from '../../shared/permissions';

/**
 * Route-side permission resolution.
 *
 * The CATALOGUE itself lives in `shared/permissions.ts`, because the role
 * editor renders from it and the seed writes from it — see that file for why it
 * is shared and how it reaches the database. Nothing is re-exported from here:
 * a re-export would give importers a second name for one list, and
 * `export { x } from './y'` does not bind `x` locally, so this file could hand
 * out a symbol its own code then throws on. Import from `shared/permissions`
 * directly.
 */

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
 * Gating the read on `manage` alone would give that registrar an empty picker,
 * which says "this tenant has no roles" rather than "you may not see them".
 *
 * A resource listed here must declare EVERY action it serves. A missing one is
 * a 500 naming the gap rather than a fall-through to the prefix rule, which
 * would silently gate a write on a permission nobody meant.
 */
const RESOURCE_PERMISSIONS: Record<string, Partial<Record<CrudAction, readonly PermissionKey[]>>> = {
    'access-roles': {
        read: ['access_role.manage', 'person_access_role.assign'],
        create: ['access_role.manage'],
        update: ['access_role.manage'],
        delete: ['access_role.manage'],
    },
};

/**
 * Permissions that satisfy a generic CRUD route — ANY one of them is enough.
 *
 * A LIST rather than a string, and always has been in effect: every resource
 * driven by the prefix rule returns exactly one element, so this is the same
 * check it was, expressed in a shape that can also say "either of these".
 */
export function crudPermission(resource: string, action: CrudAction): readonly string[] {
    const declared = RESOURCE_PERMISSIONS[resource];

    if (declared) {
        const permissions = declared[action];

        if (!permissions) {
            // Not a 404: the resource plainly exists, and falling through to the
            // prefix rule would gate this action on a permission nobody chose.
            throw createError({
                statusCode: 500,
                statusMessage: `Resource '${resource}' declares no permission for '${action}'.`,
            });
        }

        return permissions;
    }

    const prefix = CRUD_RESOURCES[resource as keyof typeof CRUD_RESOURCES];

    if (!prefix) {
        throw createError({ statusCode: 404, statusMessage: `Unknown resource '${resource}'.` });
    }

    return [`${prefix}.${action}`];
}
