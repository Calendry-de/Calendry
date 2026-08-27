import { accountScope, accountView } from '../../utils/accountAdmin';
import { crudPermission } from '../../utils/permissions';
import { requireAnyPermission } from '../../utils/requirePermission';
import { withRequestTenant } from '../../utils/tenantDb';

/** One login, as this institution sees it. 404 when it has no identity here. */
export default defineEventHandler(async (event) => {
    const id = getRouterParam(event, 'id') as string;

    return withRequestTenant(event, async (tx, identity) => {
        await requireAnyPermission(event, tx, crudPermission('accounts', 'read'));

        const scope = await accountScope(tx, identity.tenantId, id);

        return accountView(tx, scope);
    });
});
