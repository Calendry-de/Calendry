import type { Tx } from './tenantDb';

/**
 * Grants a tenant's configured default AccessRole to a newly created Person,
 * inside the caller's own transaction (issue #25).
 *
 * REVERSES A RECORDED DECISION, DELIBERATELY. `resources.ts`'s `persons`
 * entity used to grant nothing on create — `person_access_role.assign` was
 * the only door, because a generic CRUD route silently granting a role on
 * every insert is privilege escalation wearing a default's clothes. A
 * *tenant-configured* default is a different claim: the tenant chose it, and
 * every grant this function makes is auditable (`isDefaultGrant`). The
 * reasoning for making the exception lives here and in
 * `scripts/provision-tenant.ts`'s own comment on the `member` role, not only
 * in the issue.
 *
 * NOT CALLED BY PROVISIONING. `provision-tenant.ts` writes the first
 * `Person` directly and already assigns `tenant-admin` explicitly — routing
 * it through here too would mean either granting a second role alongside
 * that one or racing to decide which wins, neither of which the bootstrap
 * flow needs.
 *
 * EXPORTED, not folded into `resources.ts`'s `persons.afterWrite` alone, so
 * a future Import (CSV/Excel, issue #14) can call it per row explicitly if
 * it does not create People through the generic resource route — the same
 * question issue #25 asked about Import, answered by making the mechanism
 * reachable from wherever a Person gets created, not only from the one
 * caller yet using it.
 */
export async function applyDefaultAccessRole(tx: Tx, tenantId: string, personId: string): Promise<void> {
    const settings = await tx.tenantAuthSettings.findUnique({
        where: { tenantId },
        select: { defaultAccessRoleId: true },
    });

    if (!settings?.defaultAccessRoleId) {
        return;
    }

    /*
     * Re-checked here rather than trusted from the setting alone: the FK's
     * `onDelete: Restrict` stops the role being deleted WHILE it is somebody's
     * default, but cannot stop a race between "delete this role" and "create
     * this person" landing in adjacent transactions. A vanished role is
     * reported, not silently skipped — "fail loudly" applies here too, not
     * only at delete time.
     */
    const role = await tx.accessRole.findFirst({
        where: { id: settings.defaultAccessRoleId, tenantId },
        select: { id: true },
    });

    if (!role) {
        throw createError({
            statusCode: 409,
            statusMessage: 'This tenant\'s default access role no longer exists. '
                + 'An administrator must choose a new one under Manage → Access defaults '
                + 'before another Person can be created.',
        });
    }

    await tx.personAccessRole.create({
        data: { personId, accessRoleId: role.id, tenantId, isDefaultGrant: true },
    });
}
