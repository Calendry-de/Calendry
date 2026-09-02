import { accountScope, auditAccount } from '../../../../utils/accountAdmin';
import { mapDbErrors } from '../../../../utils/dbErrors';
import { crudPermission } from '../../../../utils/permissions';
import { requireAnyPermission } from '../../../../utils/requirePermission';
import { withRequestTenant } from '../../../../utils/tenantDb';

/**
 * Revoke one of a login's Person's API tokens, as this institution's admin.
 *
 * `account.manage`, not `account.read`: this is a write, same tier as
 * resetting a password or signing a login out everywhere. NOT gated behind
 * `assertSoleTenant`: a token acts as the Person inside THIS tenant alone
 * (`ApiToken.tenantId`), so revoking one has no cross-tenant reach the way a
 * credential reset does, and there is nothing here for that guard to protect.
 *
 * `deleteMany` with the person predicate in the WHERE, the same shape the
 * self-service route uses: somebody else's token id, or a token id belonging
 * to a person outside this scope, deletes zero rows and reads as 404,
 * never as a permission error that confirms the row exists.
 */
export default defineEventHandler(async (event) => {
    const id = getRouterParam(event, 'id') as string;
    const tokenId = getRouterParam(event, 'tokenId') as string;

    return withRequestTenant(event, async (tx, identity) => {
        await requireAnyPermission(event, tx, crudPermission('accounts', 'update'));

        const scope = await accountScope(tx, identity.tenantId, id);

        const deleted = await mapDbErrors(() => tx.apiToken.deleteMany({
            where: { id: tokenId, personId: scope.own.personId },
        }));

        if (deleted.count === 0) {
            throw createError({ statusCode: 404, message: 'Not found.' });
        }

        await auditAccount({
            action: 'account.api_token_revoked',
            tenantId: identity.tenantId,
            accountId: scope.id,
            email: scope.email,
            actorPersonId: identity.actorPersonId ?? 'unknown',
            tokenId,
        });

        return { deleted: tokenId };
    });
});
