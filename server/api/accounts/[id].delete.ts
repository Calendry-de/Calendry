import { accountScope, assertSoleTenant, auditAccount } from '../../utils/accountAdmin';
import { mapDbErrors } from '../../utils/dbErrors';
import { crudPermission } from '../../utils/permissions';
import { requireAnyPermission } from '../../utils/requirePermission';
import { withRequestTenant } from '../../utils/tenantDb';

/**
 * Delete a login. The Person stays — they are the timetable's data, this was
 * only their way in.
 *
 * REFUSED FOR A SHARED LOGIN, and this is the sharp edge the whole
 * sole-tenant rule exists for: `account_person` and `auth_session` cascade from
 * `account`, so deleting one that another institution also uses would silently
 * destroy their administrator's way in, from a request that looks like ordinary
 * housekeeping. Such a login is removed with a detach instead (PATCH
 * `personId: null`), which is what the UI offers in its place.
 *
 * `account_person` and `auth_session` cascade, which is why nothing here deletes
 * them: a hand-written cascade is a second definition of the same rule, and the
 * one that gets forgotten when a table is added.
 */
export default defineEventHandler(async (event) => {
    const id = getRouterParam(event, 'id') as string;

    return withRequestTenant(event, async (tx, identity) => {
        await requireAnyPermission(event, tx, crudPermission('accounts', 'delete'));

        const scope = await accountScope(tx, identity.tenantId, id);

        assertSoleTenant(scope, 'deleting it');

        await mapDbErrors(() => tx.account.delete({ where: { id: scope.id } }));

        auditAccount({
            action: 'account.deleted',
            tenantId: identity.tenantId,
            accountId: scope.id,
            email: scope.email,
            actorPersonId: identity.actorPersonId ?? 'unknown',
            personId: scope.own.personId,
        });

        setResponseStatus(event, 204);

        return null;
    });
});
