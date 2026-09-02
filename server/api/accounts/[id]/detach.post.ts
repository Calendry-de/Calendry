import { accountScope, assertDetachable, auditAccount } from '../../../utils/accountAdmin';
import { mapDbErrors } from '../../../utils/dbErrors';
import { crudPermission } from '../../../utils/permissions';
import { requireAnyPermission } from '../../../utils/requirePermission';
import { withRequestTenant } from '../../../utils/tenantDb';

/**
 * Remove a login from this institution without deleting it.
 *
 * FOR A SHARED LOGIN ONLY, and that restriction is what makes the whole scheme
 * closed. An Account with no `account_person` row is invisible to every tenant
 * while its password still works, so detaching the last identity is refused
 * (`assertDetachable`) rather than warned about, and the two rules are exact
 * complements:
 *
 *   sole tenant     → delete allowed, detach refused
 *   shared account  → detach allowed, credential operations refused
 *
 * An EXPLICIT VERB rather than `PATCH { personId: null }`, for the reason the
 * routes convention gives: it removes the tenant's access to a credential, and a
 * request that says so is one the log can be read back from. It is also
 * unreachable by accident from a form whose person select happens to be empty.
 *
 * Gated on `delete`, not `update`: from this institution's point of view the
 * login is gone afterwards, which is the consequence the permission is about.
 */
export default defineEventHandler(async (event) => {
    const id = getRouterParam(event, 'id') as string;

    return withRequestTenant(event, async (tx, identity) => {
        await requireAnyPermission(event, tx, crudPermission('accounts', 'delete'));

        const scope = await accountScope(tx, identity.tenantId, id);

        assertDetachable(scope);

        await mapDbErrors(async () => {
            await tx.accountPerson.delete({
                where: { accountId_personId: { accountId: scope.id, personId: scope.own.personId } },
            });

            /*
             * Only the sessions acting AS this tenant's person. The account keeps
             * working elsewhere, and revoking a session that is currently acting
             * as another institution's identity would be this tenant signing
             * somebody out of a place it has no authority over.
             */
            await tx.authSession.updateMany({
                where: { accountId: scope.id, activePersonId: scope.own.personId, revokedAt: null },
                data: { revokedAt: new Date() },
            });
        });

        await auditAccount({
            action: 'account.detached',
            tenantId: identity.tenantId,
            accountId: scope.id,
            email: scope.email,
            actorPersonId: identity.actorPersonId ?? 'unknown',
            personId: scope.own.personId,
            remainingTenants: scope.otherTenantCount,
        });

        setResponseStatus(event, 204);

        return null;
    });
});
