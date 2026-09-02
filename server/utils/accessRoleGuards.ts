import type { Tx } from './tenantDb';

/**
 * The one invariant a tenant cannot be allowed to write itself out of.
 *
 * Every other permission is recoverable from inside the application: if nobody
 * can read rooms, an administrator grants `room.read` and the problem is over.
 * These two are different, because they are the permissions that grant
 * permissions. Lose them both and the tenant cannot repair ITSELF: there is no
 * screen left that can compose a role or assign one.
 *
 * Recovery would then mean an operator with the owner database URL running
 * `create:role` plus `create:account` to mint a NEW administrator, because
 * nothing outside this feature can grant a role to a Person who already exists.
 * That is a support ticket, out of hours, for a mis-click.
 *
 * WHY TENANT-WIDE AND NOT "DO NOT DEMOTE YOURSELF"
 *
 * Demoting yourself while colleagues still hold the capability is an ordinary
 * thing to do: handing over administration and stepping back is a real
 * workflow, and refusing it would be this guard inventing a rule nobody asked
 * for. What must not happen is the LAST holder going away, whichever route
 * takes it: editing a role's grants, deleting the role, or revoking the last
 * assignment. All three end here.
 *
 * WHY IT RUNS AFTER THE WRITE
 *
 * Predicting whether a write will breach this means reimplementing the write.
 * Instead the change lands inside the transaction, the invariant is measured
 * against the real post-write state, and a breach throws, which rolls the
 * whole transaction back. A guard that models the write can drift from it; one
 * that measures the result cannot.
 *
 * WHAT IT DELIBERATELY DOES NOT CHECK
 *
 * That the holder can actually LOG IN. Answering that means reading
 * `account_person`, which lives in the pre-tenant auth plane where only
 * `authDb.ts` may query (CLAUDE.md's second deliberate RLS exception). Widening
 * that boundary for a convenience check is not the comparably strong reason a
 * new exception needs. So a tenant whose only administrator is a Person with no
 * account is still reachable by a route this guard cannot see, and one an
 * operator has to fix either way.
 */
const SELF_ADMINISTRATION: { key: string; describes: string }[] = [
    { key: 'access_role.manage', describes: 'compose or edit access roles' },
    { key: 'person_access_role.assign', describes: 'grant an access role to anyone' },
];

export async function assertTenantRetainsAdministrator(tx: Tx, tenantId: string): Promise<void> {
    for (const capability of SELF_ADMINISTRATION) {
        const holders = await tx.personAccessRole.count({
            where: {
                tenantId,
                accessRole: { permissions: { some: { permissionKey: capability.key } } },
            },
        });

        if (holders === 0) {
            throw createError({
                statusCode: 422,
                statusMessage: `This would leave nobody in this tenant able to ${capability.describes} `
                    + `('${capability.key}'). Grant it to somebody else first; recovering from `
                    + 'this state needs an operator with database access.',
                data: { field: 'permissions', permission: capability.key },
            });
        }
    }
}
