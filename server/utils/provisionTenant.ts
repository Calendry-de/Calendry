/**
 * Shared types and constants for "what a brand-new tenant looks like".
 *
 * There is now exactly ONE implementation of tenant creation:
 * `calendry_internal.staff_create_tenant()`, a SECURITY DEFINER SQL function
 * (issue #105, `prisma/migrations/20260901170000_staff_create_tenant_fn/`),
 * called via `provisionTenantViaFunction()`
 * (`server/utils/staffCreateTenant.ts`) — by both `POST /api/staff/tenants`
 * (its ordinary runtime connection) and `scripts/provision-tenant.ts` (its
 * owner connection, needed only because `tenant`'s RLS write policy is
 * unsatisfiable before the row exists — the function itself is what runs
 * privileged, not the caller's connection).
 *
 * This module used to also hold `provisionTenantCore()`, a second,
 * hand-written Prisma transaction that duplicated the SQL function's logic
 * for the CLI's sole use. Issue #107 had to update both by hand to add
 * `student`/`parent` Role seeding — exactly the drift a comment on this file
 * once warned "must be kept in agreement by hand" — which is why
 * `provisionTenantCore()` was deleted rather than kept in sync a second time.
 * What remains here is shared, non-duplicated: the input/result shapes and
 * the default-constraints constant, both read by `staffCreateTenant.ts` to
 * build the function's parameters, and by `scripts/provision-tenant.ts` to
 * report what was created.
 */
import { defaultConstraintRow, defaultConstraintTypes } from '../../shared/constraintTypes';

/**
 * ONE DEFAULT ROW PER LIVE CATALOGUE TYPE — see `scripts/provision-tenant.ts`
 * (the original home of this constant) for the full history of why this is
 * derived from the catalogue rather than hand-listed.
 */
export const DEFAULT_CONSTRAINTS = defaultConstraintTypes().map(defaultConstraintRow);

export interface ProvisionTenantInput {
    slug: string;
    name: string;
    adminEmail: string;
    adminName: string;
    /** Must already exist — this function creates tenants, never federations. */
    federationSlug?: string | null;
    timezone?: string;
}

export interface ProvisionTenantResult {
    tenant: { id: string; slug: string; name: string };
    person: { id: string; email: string };
    account: { id: string; reusedAccount: boolean };
    lecturerRole: { id: string };
    /** Shown once; `null` when an existing Account was reused (its password is unchanged). */
    initialPassword: string | null;
}

/**
 * Thrown when `federationSlug` is given but no such Federation exists.
 * Federations are managed separately, so an unknown slug is an operator
 * error rather than something to silently create.
 */
export class UnknownFederationError extends Error {}
