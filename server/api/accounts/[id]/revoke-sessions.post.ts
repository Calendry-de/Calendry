import { accountScope, auditAccount } from '../../../utils/accountAdmin';
import { mapDbErrors } from '../../../utils/dbErrors';
import { crudPermission } from '../../../utils/permissions';
import { requireAnyPermission } from '../../../utils/requirePermission';
import { withRequestTenant } from '../../../utils/tenantDb';

/**
 * Sign a login out everywhere.
 *
 * ALLOWED EVEN FOR A SHARED LOGIN, unlike every other write here, and the
 * distinction is recoverability. `auth_session` hangs off `account_id`, so this
 * does reach the other institutions a shared credential serves — but its holder
 * knows their own password and signs straight back in, whereas a reset, a
 * rename or a deactivation leaves them locked out of a tenant that never agreed
 * to it. Refusing this for a shared login would also remove the one immediate
 * response to a stolen laptop from the tenant most likely to hear about it.
 *
 * The UI says so on the button rather than in a tooltip, because "signs them out
 * of every institution" is not a detail.
 */
export default defineEventHandler(async (event) => {
    const id = getRouterParam(event, 'id') as string;

    return withRequestTenant(event, async (tx, identity) => {
        await requireAnyPermission(event, tx, crudPermission('accounts', 'update'));

        const scope = await accountScope(tx, identity.tenantId, id);

        const revoked = await mapDbErrors(async () => {
            const result = await tx.authSession.updateMany({
                where: { accountId: scope.id, revokedAt: null },
                data: { revokedAt: new Date() },
            });

            return result.count;
        });

        await auditAccount({
            action: 'account.sessions_revoked',
            tenantId: identity.tenantId,
            accountId: scope.id,
            email: scope.email,
            actorPersonId: identity.actorPersonId ?? 'unknown',
            sessionsRevoked: revoked,
            sharedLogin: !scope.isSoleTenant,
        });

        return { sessionsRevoked: revoked };
    });
});
