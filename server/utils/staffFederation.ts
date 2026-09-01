/**
 * Federation management from the staff panel — issue #64's UI half.
 *
 * SAME TECHNIQUE `staffCreateTenant.ts` uses for tenant creation (issue
 * #105): narrow, parameterized SECURITY DEFINER functions
 * (`calendry_internal.staff_create_federation()` /
 * `staff_set_tenant_federation()`, in the
 * `20260901220000_staff_federation_management` migration — see its header
 * for the full argument), callable through the ORDINARY `calendry_app` role.
 * `federation` and `tenant` both carry RLS policies that a staff request —
 * which opens no tenant/federation context at all — cannot satisfy on the
 * ordinary connection, so these functions are what run privileged instead of
 * a standing owner connection.
 */
import type { PrismaClient } from '@prisma/client';
import { rawPostgresErrorCode } from './staffCreateTenant';

export class UnknownFederationIdError extends Error {}
export class UnknownTenantIdError extends Error {}

interface StaffCreateFederationRow {
    id: string;
    slug: string;
    name: string;
    created_at: Date;
    already_existed: boolean;
}

export interface CreateFederationResult {
    federation: { id: string; slug: string; name: string; createdAt: Date };
    alreadyExisted: boolean;
}

/** Creates a Federation, or returns the existing one for an already-taken slug. */
export async function createFederationViaFunction(
    prisma: PrismaClient,
    input: { slug: string; name: string },
): Promise<CreateFederationResult> {
    const [row] = await prisma.$queryRaw<StaffCreateFederationRow[]>`
        SELECT * FROM calendry_internal.staff_create_federation(${input.slug}, ${input.name})
    `;

    if (!row) {
        // The function always RETURNS exactly one row or raises — see
        // `provisionTenantViaFunction`'s own comment for why this guard
        // exists anyway.
        throw new Error('calendry_internal.staff_create_federation() returned no row.');
    }

    return {
        federation: { id: row.id, slug: row.slug, name: row.name, createdAt: row.created_at },
        alreadyExisted: row.already_existed,
    };
}

interface StaffSetTenantFederationRow {
    tenant_id: string;
    tenant_slug: string;
    federation_id: string | null;
}

/**
 * Attaches (`federationId` set) or detaches (`federationId: null`) a
 * Tenant's OWN federation membership.
 *
 * Distinguishes an unknown tenant id from an unknown federation id by
 * PROBING the tenant first on the ordinary connection — the function itself
 * raises the same `no_data_found` (P0002) for either, and probing here is
 * simpler than parsing the exception message to tell them apart.
 */
export async function setTenantFederationViaFunction(
    prisma: PrismaClient,
    input: { tenantId: string; federationId: string | null },
): Promise<{ tenantId: string; tenantSlug: string; federationId: string | null }> {
    try {
        const [row] = await prisma.$queryRaw<StaffSetTenantFederationRow[]>`
            SELECT * FROM calendry_internal.staff_set_tenant_federation(${input.tenantId}, ${input.federationId})
        `;

        if (!row) {
            throw new Error('calendry_internal.staff_set_tenant_federation() returned no row.');
        }

        return { tenantId: row.tenant_id, tenantSlug: row.tenant_slug, federationId: row.federation_id };
    } catch (error) {
        if (rawPostgresErrorCode(error) === 'P0002') {
            const tenantExists = await prisma.tenant.findUnique({ where: { id: input.tenantId }, select: { id: true } });

            throw tenantExists
                ? new UnknownFederationIdError(`No federation with id '${input.federationId}'.`)
                : new UnknownTenantIdError(`No tenant with id '${input.tenantId}'.`);
        }

        throw error;
    }
}
