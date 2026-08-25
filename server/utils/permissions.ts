import { CRUD_RESOURCES } from '../../shared/permissions';
import type { CrudAction } from '../../shared/permissions';

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

/** Permission required for a generic CRUD route. */
export function crudPermission(resource: string, action: CrudAction): string {
    const prefix = CRUD_RESOURCES[resource as keyof typeof CRUD_RESOURCES];

    if (!prefix) {
        throw createError({ statusCode: 404, statusMessage: `Unknown resource '${resource}'.` });
    }

    return `${prefix}.${action}`;
}
