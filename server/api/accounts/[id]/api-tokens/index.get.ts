import { accountScope } from '../../../../utils/accountAdmin';
import { crudPermission } from '../../../../utils/permissions';
import { requireAnyPermission } from '../../../../utils/requirePermission';
import { withRequestTenant } from '../../../../utils/tenantDb';

/**
 * The API tokens a login's Person has minted, as this institution's admin sees
 * them.
 *
 * Same shape as `GET /api/me/api-tokens` — `tokenHash` is not selected, the
 * secret exists in exactly one response, ever, and this route cannot change
 * that: it only ever LISTS what already exists.
 */
export default defineEventHandler(async (event) => {
    const id = getRouterParam(event, 'id') as string;

    return withRequestTenant(event, async (tx, identity) => {
        await requireAnyPermission(event, tx, crudPermission('accounts', 'read'));

        const scope = await accountScope(tx, identity.tenantId, id);

        return tx.apiToken.findMany({
            where: { personId: scope.own.personId },
            orderBy: { createdAt: 'desc' },
            select: {
                id: true,
                name: true,
                permissions: true,
                isActive: true,
                expiresAt: true,
                lastUsedAt: true,
                createdAt: true,
            },
        });
    });
});
