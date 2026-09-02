import type { H3Event } from 'h3';
import { writeAuditLog } from './auditLog';
import type { Tx } from './tenantDb';

/**
 * Permission enforcement (TAXONOMY.md §4).
 *
 * A Person's permissions are the union of the Permissions carried by every
 * AccessRole assigned to them in the current tenant. Both `person_access_role`
 * and `access_role_permission` are tenant-scoped and behind RLS, so this query
 * runs inside the caller's tenant transaction, so a Person cannot pick up an
 * access role belonging to another institution even if the ids were guessed.
 *
 * Deliberately NOT derived from the domain `Role` entity (Lecturer, Student).
 * Those describe what a Person IS for scheduling purposes; these describe what
 * they may DO in the software. See the AccessRole model comment.
 */

/** Permissions held by a Person in the tenant of the current transaction. */
export async function loadPermissions(tx: Tx, personId: string): Promise<Set<string>> {
    const rows = await tx.personAccessRole.findMany({
        where: { personId },
        select: { accessRole: { select: { permissions: { select: { permissionKey: true } } } } },
    });

    const permissions = new Set<string>();

    for (const row of rows) {
        for (const p of row.accessRole.permissions) {
            permissions.add(p.permissionKey);
        }
    }

    return permissions;
}

/**
 * The caller's permissions, loaded once per request.
 *
 * Cached on the event for the duration of the request: a single handler may
 * check several permissions, and re-querying per check would multiply round
 * trips inside an already-open transaction.
 */
async function heldPermissions(event: H3Event, tx: Tx): Promise<Set<string>> {
    const identity = requireTenantScopedIdentity(event);

    /*
     * `ics_link` DOES carry a real `actorPersonId`, which `ownSessionClause()`
     * needs to build "this Person's own Sessions", but it must never satisfy a
     * permission check with it, or a stray `?token=` on an unrelated route
     * would silently borrow whatever that Person can do everywhere else. Same
     * discipline `screen`'s null `actorPersonId` enforces structurally; this
     * kind needs an explicit refusal instead because the field it must not
     * grant access via is also the field the stream route legitimately reads.
     */
    if (!identity.actorPersonId || identity.kind === 'ics_link') {
        // issue #78: a principal with no acting Person (or one deliberately
        // barred from permission checks) reaching a permission-gated route at
        // all is itself the denial; there is no permission key to name yet.
        await writeAuditLog({
            action: 'access.denied',
            outcome: 'DENIED',
            tenantId: identity.tenantId,
            target: event.path,
            detail: { reason: 'no_acting_person', identityKind: identity.kind },
        });

        throw createError({ statusCode: 403, statusMessage: 'No acting Person on this session.' });
    }

    let held = event.context.permissions as Set<string> | undefined;

    if (!held) {
        held = await loadPermissions(tx, identity.actorPersonId);

        /*
         * An API token is its Person's authority NARROWED: the effective set is
         * the intersection of what the Person holds LIVE and the ceiling chosen
         * at creation. Computed here, at the single point permissions are
         * loaded, so no route can forget it, and cached only per request, so
         * revoking an AccessRole narrows every derived token immediately.
         */
        if (identity.kind === 'token') {
            const ceiling = new Set(identity.grantedPermissions);

            held = new Set([...held].filter((key) => ceiling.has(key)));
        }

        event.context.permissions = held;
    }

    return held;
}

/**
 * Whether the caller holds `permission`, WITHOUT refusing when they do not.
 *
 * For a route whose ANSWER depends on the permission rather than whether it
 * answers at all: `GET /api/sessions` serves both `session.read` (everything)
 * and `session.read_own` (the caller's own), and the difference is a WHERE
 * clause, not a status code. Reads the same request-cached set as the assertions
 * below, so asking costs nothing extra.
 *
 * Deliberately NOT a way to soften a guard. A route that narrows on this must
 * still `requireAnyPermission` first, or "holds neither" silently becomes the
 * narrow branch, which would serve an unauthenticated shape of the data rather
 * than refusing.
 */
export async function holdsPermission(event: H3Event, tx: Tx, permission: string): Promise<boolean> {
    return (await heldPermissions(event, tx)).has(permission);
}

/** Asserts the caller holds `permission`, throwing 403 otherwise. */
export async function requirePermission(event: H3Event, tx: Tx, permission: string): Promise<void> {
    const held = await heldPermissions(event, tx);

    if (!held.has(permission)) {
        // issue #78: every denied permission check is audited, not only the
        // ones on generic CRUD routes.
        const identity = requireTenantScopedIdentity(event);

        await writeAuditLog({
            action: 'access.denied',
            outcome: 'DENIED',
            actorPersonId: identity.actorPersonId,
            tenantId: identity.tenantId,
            target: permission,
            detail: { route: event.path, permission },
        });

        // 403 rather than 404: the caller is legitimately inside this tenant, so
        // hiding the existence of the action buys nothing and makes the API
        // hard to use. Cross-TENANT access still reports 404 (see dbErrors).
        throw createError({
            statusCode: 403,
            statusMessage: `Missing permission '${permission}'.`,
        });
    }
}

/**
 * Asserts the caller holds AT LEAST ONE of `permissions`.
 *
 * Used by the generic CRUD routes, which resolve a resource to a LIST of
 * acceptable permissions (`crudPermission`). For every resource driven by the
 * `<prefix>.<action>` rule that list holds exactly one element, so this is the
 * same check `requirePermission` performs; only `access-roles` currently names
 * two, and only for reading; see the note on RESOURCE_PERMISSIONS.
 *
 * An EMPTY list is a 500, not a pass. "Any of nothing" is vacuously false, but
 * the shape that produces it is a registry mistake, and a route that silently
 * required nothing is the worst possible reading of a guard whose failure mode
 * must never be a quiet no-op.
 */
export async function requireAnyPermission(
    event: H3Event,
    tx: Tx,
    permissions: readonly string[],
): Promise<void> {
    if (permissions.length === 0) {
        throw createError({
            statusCode: 500,
            statusMessage: 'No permission declared for this route.',
        });
    }

    const held = await heldPermissions(event, tx);

    if (permissions.some((permission) => held.has(permission))) {
        return;
    }

    // issue #78: same as requirePermission()'s own denial.
    const identity = requireTenantScopedIdentity(event);

    await writeAuditLog({
        action: 'access.denied',
        outcome: 'DENIED',
        actorPersonId: identity.actorPersonId,
        tenantId: identity.tenantId,
        target: permissions.join(' or '),
        detail: { route: event.path, permissions },
    });

    // Every acceptable permission is named. A caller told only the first one
    // would go and get granted a permission they may not need, and a tenant
    // admin reading the message would configure the wrong role.
    throw createError({
        statusCode: 403,
        statusMessage: `Missing permission '${permissions.join("' or '")}'.`,
    });
}
