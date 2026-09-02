/**
 * A Tenant's default locale, set from the staff panel, calling
 * `calendry_internal.staff_set_tenant_locale()` (the
 * `20260902120000_staff_set_tenant_locale_fn` migration, see that file's
 * header for the full argument) through whichever ordinary `calendry_app`
 * connection the caller passes in — the same shape
 * `provisionTenantViaFunction()` (`staffCreateTenant.ts`),
 * `setTenantFederationViaFunction()` (`staffFederation.ts`) and
 * `eraseTenantViaFunction()` (`staffEraseTenant.ts`) already established.
 *
 * `getOwnerPrisma()` was the alternative and is REFUSED: issue #105's whole
 * point was moving staff tenant WRITES off the standing owner connection onto
 * SECURITY DEFINER functions (DECISIONS.md § "Staff tenant creation:
 * SECURITY DEFINER instead of owner-Prisma"). Only the cross-tenant READS
 * (`GET /api/staff/tenants`, `GET /api/staff/federations`) still go through
 * it, which CLAUDE.md records as deliberately outside that issue's scope. A
 * new owner-connection write would reverse a decision taken on purpose.
 *
 * NOT wrapped in `withTenant()`/`withRequestTenant()`: a `StaffIdentity` has
 * no tenant to scope to and cannot be passed to either (a compile error, by
 * design). No explicit `$transaction()` either: a single statement invoking a
 * SQL function is already atomic.
 */
import type { PrismaClient } from '@prisma/client';
import { UnknownTenantIdError, rawPostgresErrorCode } from './staffCreateTenant';

/** Row shape returned by `calendry_internal.staff_set_tenant_locale()`. */
interface StaffSetTenantLocaleRow {
    tenant_id: string;
    tenant_slug: string;
    default_locale: string | null;
    configured: boolean;
}

export interface SetTenantLocaleResult {
    tenantId: string;
    tenantSlug: string;
    defaultLocale: string | null;
    /**
     * Whether a `tenant_display_settings` row exists for this tenant now.
     * `false` is reachable in exactly one case: clearing a default on a
     * tenant that had never saved a display setting, which the function
     * deliberately does not turn into an INSERT (see the migration header).
     * Reported rather than inferred, so "cleared it" and "there was nothing
     * to clear" stay distinguishable — the absent row is itself the read
     * path's answer for "no tenant default".
     */
    configured: boolean;
}

/**
 * Sets (`locale` a validated BCP-47 tag) or clears (`locale: null`) a
 * Tenant's `TenantDisplaySettings.defaultLocale`, upserting the singleton.
 *
 * The tag is NOT validated here: `isUsableLocale()` (`shared/locale.ts`) is
 * the write boundary and the ROUTE applies it, the same place
 * `PUT /api/display-settings` and `PUT /api/me/settings` apply it. A caller
 * reaching this function has already been through it.
 *
 * Throws `UnknownTenantIdError` for an unresolvable tenant id, the shared
 * class every other staff wrapper throws for the function's `no_data_found`
 * (P0002), so the route maps one error type to its 404 rather than reading
 * SQLSTATEs itself.
 */
export async function setTenantLocaleViaFunction(
    prisma: PrismaClient,
    input: { tenantId: string; locale: string | null },
): Promise<SetTenantLocaleResult> {
    try {
        const [row] = await prisma.$queryRaw<StaffSetTenantLocaleRow[]>`
            SELECT * FROM calendry_internal.staff_set_tenant_locale(${input.tenantId}, ${input.locale})
        `;

        if (!row) {
            // The function always RETURNS exactly one row or raises; see
            // `provisionTenantViaFunction()`'s identical comment for why this
            // guard exists anyway.
            throw new Error('calendry_internal.staff_set_tenant_locale() returned no row.');
        }

        return {
            tenantId: row.tenant_id,
            tenantSlug: row.tenant_slug,
            defaultLocale: row.default_locale,
            configured: row.configured,
        };
    } catch (error) {
        if (rawPostgresErrorCode(error) === 'P0002') {
            throw new UnknownTenantIdError(`No tenant with id '${input.tenantId}'.`);
        }

        throw error;
    }
}
