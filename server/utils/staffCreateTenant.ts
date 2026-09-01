/**
 * The ONE implementation of "what a brand-new tenant looks like" — issue
 * #105, generalised into the sole implementation (superseding
 * `provisionTenantCore()`, deleted from `server/utils/provisionTenant.ts`)
 * once it became clear the CLI needed no second copy of its own.
 *
 * `POST /api/staff/tenants` used to call `provisionTenantCore()` inside a
 * transaction on `getOwnerPrisma()` (issue #76), handing the running app a
 * live, cached connection authenticated as the database OWNER. Issue #105
 * replaced that with the SAME technique `calendry_internal.session_identity()`
 * / `screen_identity()` already use: a narrow SECURITY DEFINER function
 * (`calendry_internal.staff_create_tenant()`, in the
 * `20260901170000_staff_create_tenant_fn` migration — see that file's header
 * for the full argument). Because the function itself is what runs
 * privileged — `SECURITY DEFINER` executes with its OWNER's rights no matter
 * which role calls it — `provisionTenantViaFunction()` needs no standing
 * owner connection of its own; it takes whichever `PrismaClient` the caller
 * already has. `POST /api/staff/tenants` passes its ordinary runtime
 * connection (`getPrisma()`, `calendry_app`); `scripts/provision-tenant.ts`
 * passes its owner connection (needed only to open the connection at all —
 * see that script's header). One implementation, callable from either
 * vantage point, rather than this SQL function and a second, hand-kept-in-sync
 * TypeScript transaction.
 *
 * NOT wrapped in `withTenant()`/`withRequestTenant()`: there is no tenant to
 * scope to yet, and neither accepts a `StaffIdentity` in the first place (see
 * `tenantDb.ts`). No explicit `$transaction()` either — a single statement
 * invoking a SQL function is already atomic; see the migration's own
 * "ATOMICITY" note.
 */
import { randomBytes } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { hashPassword } from './auth';
import { PERMISSION_KEYS } from '../../shared/permissions';
import {
    DEFAULT_CONSTRAINTS,
    UnknownFederationError,
    type ProvisionTenantInput,
    type ProvisionTenantResult,
} from './provisionTenant';

/** Row shape returned by `calendry_internal.staff_create_tenant()`. */
interface StaffCreateTenantRow {
    tenant_id: string;
    tenant_slug: string;
    tenant_name: string;
    person_id: string;
    person_email: string;
    account_id: string;
    account_reused: boolean;
    lecturer_role_id: string;
}

/**
 * `DEFAULT_CONSTRAINTS` (from `provisionTenant.ts`, itself derived from
 * `shared/constraintTypes.ts`'s catalogue — never reproduced in SQL, see the
 * migration's header) key-renamed to snake_case, matching the column names
 * `jsonb_to_recordset()` reads inside the function. Pure reshaping, no
 * catalogue logic: the values themselves are exactly what
 * `provisionTenantCore()` would insert.
 */
function constraintsParam(): string {
    return JSON.stringify(
        DEFAULT_CONSTRAINTS.map((c) => ({
            type: c.type,
            name: c.name,
            severity: c.severity,
            weight: c.weight,
            params: c.params,
            is_enabled: c.isEnabled,
        })),
    );
}

/**
 * Shared across every staff route that resolves a tenant id against a
 * SECURITY DEFINER function's P0002 (`staffEraseTenant.ts`,
 * `staffFederation.ts`) — one class, not two independently declared copies
 * with the same name and body, which is exactly the kind of drift-by-name
 * collision Nitro's auto-import warns about when two files export the same
 * symbol.
 */
export class UnknownTenantIdError extends Error {}

/**
 * Reads the original PostgreSQL error code off a raw-query failure.
 *
 * `$queryRaw`/`$executeRaw` against the `@prisma/adapter-pg` driver adapter
 * (the one this app uses everywhere — see `server/utils/prisma.ts`) wrap
 * every database error as `PrismaClientKnownRequestError` with `code:
 * 'P2010'` ("raw query failed"); the ORIGINAL SQLSTATE the database raised
 * lives at `error.meta.driverAdapterError.cause.originalCode` — NOT `.code`,
 * which the adapter only populates for a generic/unrecognized Postgres error
 * (a plain `RAISE EXCEPTION`) and OMITS for one it classifies into a named
 * `kind` of its own (a unique-constraint violation comes back as `kind:
 * 'UniqueConstraintViolation'` with no `.code` at all). `.originalCode` is
 * present in both shapes and is the only field to rely on. Verified
 * empirically against this exact Prisma/adapter version (there is no public,
 * documented accessor) by raising a custom PL/pgSQL exception and a real
 * unique-constraint violation through `$queryRaw` and inspecting both result
 * shapes — see the migration's "ERROR SURFACE" note. Returns `undefined` for
 * anything that is not a raw-query database failure, so a caller can fall
 * through to rethrowing the original error.
 */
export function rawPostgresErrorCode(error: unknown): string | undefined {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2010') {
        return undefined;
    }

    const meta = error.meta as { driverAdapterError?: { cause?: { originalCode?: string } } } | undefined;

    return meta?.driverAdapterError?.cause?.originalCode;
}

/**
 * Creates a tenant via `calendry_internal.staff_create_tenant()`, on
 * whichever `prisma` connection the caller passes in — the SECURITY DEFINER
 * function is what runs privileged, not the caller's role, so this works
 * identically over the app's ordinary runtime connection or the CLI's owner
 * connection. Returns a `ProvisionTenantResult` so `POST /api/staff/tenants`'s
 * response shape is unchanged from before this was the only implementation.
 *
 * Password hashing is the one piece of work that stays on the app side —
 * `hashPassword()` is `scrypt`, which PL/pgSQL has no primitive for (see the
 * migration header) — computed here on whichever connection was passed in,
 * same as every other caller that hashes a password. The hash is passed in
 * even when it turns out to go unused (the email already has an Account) —
 * simpler than threading a lazy hash through the reused-account branch, and
 * the branch itself is decided INSIDE the function, not here, since only the
 * function can see whether the email is already taken without a second round
 * trip.
 */
export async function provisionTenantViaFunction(
    prisma: PrismaClient,
    input: ProvisionTenantInput,
): Promise<ProvisionTenantResult> {
    const adminEmail = input.adminEmail.toLowerCase();
    const trimmedName = input.adminName.trim();
    const parts = trimmedName.split(/\s+/);
    const givenName = parts[0] ?? trimmedName;
    const familyName = parts.slice(1).join(' ') || givenName;

    const initialPassword = randomBytes(12).toString('base64url');
    const passwordHash = await hashPassword(initialPassword);

    try {
        const [row] = await prisma.$queryRaw<StaffCreateTenantRow[]>`
            SELECT * FROM calendry_internal.staff_create_tenant(
                ${input.slug}, ${input.name}, ${input.timezone ?? 'UTC'}, ${input.federationSlug ?? null},
                ${adminEmail}, ${givenName}, ${familyName},
                ${[...PERMISSION_KEYS]}::text[],
                ${constraintsParam()}::jsonb,
                ${passwordHash}
            )
        `;

        if (!row) {
            // The function always RETURNS exactly one row or raises — this is
            // unreachable in practice, and exists so a future change to the
            // function that silently returns zero rows fails loudly here
            // instead of the caller reading `undefined` fields off `row`.
            throw new Error('calendry_internal.staff_create_tenant() returned no row.');
        }

        return {
            tenant: { id: row.tenant_id, slug: row.tenant_slug, name: row.tenant_name },
            person: { id: row.person_id, email: row.person_email },
            account: { id: row.account_id, reusedAccount: row.account_reused },
            lecturerRole: { id: row.lecturer_role_id },
            initialPassword: row.account_reused ? null : initialPassword,
        };
    } catch (error) {
        // 'P0002' is the SQLSTATE for plpgsql's standard `no_data_found`
        // condition, which the function raises for an unknown federation
        // slug (see the migration). Anything else — including '23505'
        // (unique_violation) on a duplicate tenant slug — is left for the
        // route to map via `rawPostgresErrorCode()`, the same way it already
        // maps a raw error rather than a typed one.
        if (rawPostgresErrorCode(error) === 'P0002') {
            throw new UnknownFederationError(`No federation with slug '${input.federationSlug}'. Create it first.`);
        }

        throw error;
    }
}
