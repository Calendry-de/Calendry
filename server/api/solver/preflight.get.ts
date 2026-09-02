import { requirePermission } from '../../utils/requirePermission';
import { withRequestTenant } from '../../utils/tenantDb';
import { preflightConstraints } from '../../utils/solverPreflight';

/**
 * Whether this tenant's enabled constraints would let a solver run start, read
 * BEFORE anyone clicks "Generate schedule" rather than found out from a run
 * that fails 68ms after being created.
 *
 * `termId` is accepted (matching `POST /api/solver/runs`'s shape) but not
 * required and not read: a constraint's params are tenant-wide configuration,
 * not per-term, so what this reports is identical for every term. See
 * `preflightConstraints`'s own comment for why scope is "every enabled row",
 * not "rows relevant to one term".
 */
export default defineEventHandler(async (event) => withRequestTenant(event, async (tx, identity) => {
    await requirePermission(event, tx, 'solver.trigger');

    const issues = await preflightConstraints(tx, identity.tenantId);

    return { issues };
}));
