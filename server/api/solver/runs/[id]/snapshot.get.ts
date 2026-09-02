import { gunzipSync } from 'node:zlib';
import { SolverInput } from '@calendry-de/calendry-proto';
import { requirePermission } from '../../../../utils/requirePermission';
import { withRequestTenant } from '../../../../utils/tenantDb';

/**
 * The full `SolverInput` one run actually sent (issue #24): answers "what
 * was configured when this calendar was generated" beyond what `inputHash`
 * alone can prove.
 *
 * Gated on `solver.snapshot.read`, separate from `solver.trigger`: this is a
 * tenant's whole scheduling configuration at one moment (people, groups,
 * rooms, preferences), the single most sensitive payload the app stores.
 */
export default defineEventHandler(async (event) => {
    const id = getRouterParam(event, 'id');

    return withRequestTenant(event, async (tx, identity) => {
        await requirePermission(event, tx, 'solver.snapshot.read');

        const run = await tx.solverRun.findFirst({
            where: { id, tenantId: identity.tenantId },
            select: { id: true },
        });

        if (!run) {
            throw createError({ statusCode: 404, statusMessage: 'Not found.' });
        }

        const snapshot = await tx.solverInputSnapshot.findUnique({
            where: { solverRunId: run.id },
            select: { compressedInput: true, createdAt: true },
        });

        if (!snapshot) {
            // A run started before this feature shipped, or one whose write
            // genuinely failed: distinguishable from "no such run" above.
            throw createError({ statusCode: 404, statusMessage: 'No snapshot stored for this run.' });
        }

        const decoded = SolverInput.decode(gunzipSync(snapshot.compressedInput));

        return { runId: run.id, createdAt: snapshot.createdAt, input: SolverInput.toJSON(decoded) };
    });
});
