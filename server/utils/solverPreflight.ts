import type { Tx } from './tenantDb';
import { type ConstraintIssue, validateConstraint } from '../../shared/constraintTypes';

/**
 * Every reason this tenant's ENABLED constraints would block or corrupt a
 * solver run, checked BEFORE a `solver_run` row exists or a gRPC call is
 * made.
 *
 * Scope matches `assembleSolverInput`'s own constraint query exactly
 * (`tenantId`, `isEnabled: true`, no term filter): a constraint's params are
 * tenant-wide configuration, not per-term, so "in scope for this run" is
 * "every enabled row this tenant holds". Narrowing a rule to one TimeGrid or
 * one offering is legitimate and silent (`toWireConstraint`'s skip-and-report
 * path); what this function surfaces is the other kind, a configuration that
 * cannot function at all, regardless of which term a run is for.
 */
export async function preflightConstraints(tx: Tx, tenantId: string): Promise<ConstraintIssue[]> {
    const rows = await tx.constraint.findMany({
        where: { tenantId, isEnabled: true },
        select: {
            id: true, name: true, type: true, severity: true, params: true,
        },
    });

    return rows.flatMap((row) => validateConstraint(row));
}
