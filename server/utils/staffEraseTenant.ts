/**
 * The staff-only erasure half of issue #84, calling
 * `calendry_internal.staff_erase_tenant()` (the
 * `20260901230000_staff_erase_tenant_fn` migration, see that file's header
 * for the full argument) through whichever ordinary `calendry_app`
 * connection the caller passes in, the same shape
 * `provisionTenantViaFunction()` (`staffCreateTenant.ts`) already
 * established for tenant creation.
 *
 * NOT wrapped in `withTenant()`/`withRequestTenant()`: a `StaffIdentity` has
 * no tenant to scope to, and erasing ITS OWN row from inside an RLS context
 * scoped to it would be exactly backwards. No explicit `$transaction()`
 * either: a single statement invoking a SQL function is already atomic.
 */
import type { PrismaClient } from '@prisma/client';
import { UnknownTenantIdError, rawPostgresErrorCode } from './staffCreateTenant';

interface StaffEraseTenantRow {
    tenant_id: string;
    tenant_slug: string;
    tenant_name: string;
    person_count: number;
    accounts_erased: number;
}

export interface EraseTenantResult {
    tenant: { id: string; slug: string; name: string };
    personCount: number;
    accountsErased: number;
}

/**
 * Erases a tenant and everything it owns, IMMEDIATELY and IRREVERSIBLY.
 * See the migration's header for exactly what does and does not cascade.
 * The caller (`DELETE /api/staff/tenants/:id`) is responsible for requiring
 * the operator to type the tenant's slug back before reaching here; this
 * function performs no confirmation of its own.
 */
export async function eraseTenantViaFunction(prisma: PrismaClient, tenantId: string): Promise<EraseTenantResult> {
    try {
        const [row] = await prisma.$queryRaw<StaffEraseTenantRow[]>`
            SELECT * FROM calendry_internal.staff_erase_tenant(${tenantId})
        `;

        if (!row) {
            // The function always RETURNS exactly one row or raises, see
            // `provisionTenantViaFunction()`'s identical comment.
            throw new Error('calendry_internal.staff_erase_tenant() returned no row.');
        }

        return {
            tenant: { id: row.tenant_id, slug: row.tenant_slug, name: row.tenant_name },
            personCount: row.person_count,
            accountsErased: row.accounts_erased,
        };
    } catch (error) {
        if (rawPostgresErrorCode(error) === 'P0002') {
            throw new UnknownTenantIdError(`No tenant with id '${tenantId}'.`);
        }

        throw error;
    }
}
