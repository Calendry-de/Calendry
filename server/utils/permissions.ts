import { RESOURCE_PERMISSIONS, resourcePermissions } from '../../shared/permissions';
import type { CrudAction } from '../../shared/permissions';

/**
 * Route-side permission resolution.
 *
 * The CATALOGUE itself lives in `shared/permissions.ts`, because the role
 * editor renders from it and the seed writes from it: see that file for why it
 * is shared and how it reaches the database. Nothing is re-exported from here:
 * a re-export would give importers a second name for one list, and
 * `export { x } from './y'` does not bind `x` locally, so this file could hand
 * out a symbol its own code then throws on. Import from `shared/permissions`
 * directly.
 *
 * `RESOURCE_PERMISSIONS` moved there too. The routes ENFORCE it and the
 * management UI has to PREDICT it: a page must not assemble a fetch wave it
 * will be refused, so both read one definition. What stays here is only the
 * part that cannot be shared: turning "cannot answer" into the right HTTP
 * failure.
 */

/**
 * Permissions that satisfy a generic CRUD route: ANY one of them is enough.
 *
 * A LIST rather than a string, and always has been in effect: every resource
 * driven by the prefix rule returns exactly one element, so this is the same
 * check it was, expressed in a shape that can also say "either of these".
 */
export function crudPermission(resource: string, action: CrudAction): readonly string[] {
    const permissions = resourcePermissions(resource, action);

    if (permissions) {
        return permissions;
    }

    if (RESOURCE_PERMISSIONS[resource]) {
        // Not a 404: the resource plainly exists, and falling through to the
        // prefix rule would gate this action on a permission nobody chose.
        throw createError({
            statusCode: 500,
            statusMessage: `Resource '${resource}' declares no permission for '${action}'.`,
        });
    }

    throw createError({ statusCode: 404, statusMessage: `Unknown resource '${resource}'.` });
}
