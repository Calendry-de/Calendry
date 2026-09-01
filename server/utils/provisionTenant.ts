/**
 * The core of "what a brand-new tenant looks like" — extracted from
 * `scripts/provision-tenant.ts` for issue #76 so the CLI and
 * `POST /api/staff/tenants` share exactly ONE implementation of tenant
 * creation rather than two that can drift apart. Neither caller may skip
 * this by hand-rolling the transaction again.
 *
 * MUST run inside a transaction opened on the OWNER connection. The RLS
 * write policy on `tenant` is `id = calendry_internal.current_tenant_id()`,
 * unsatisfiable for a row that does not exist yet — see
 * `scripts/provision-tenant.ts`'s own header comment for the full argument.
 * This module does not open that transaction itself; it only assumes the
 * `tx` it is given already has owner privileges. `scripts/provision-tenant.ts`
 * opens one via `resolveOwnerDatabaseUrl()` directly; `server/api/staff/
 * tenants/index.post.ts` opens one via `getOwnerPrisma()`
 * (`server/utils/ownerPrisma.ts`).
 */
import { randomBytes } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { hashPassword } from './auth';
import { PERMISSIONS } from '../../shared/permissions';
import { LECTURER_ROLE_KEY } from '../../shared/roles';
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

/**
 * Creates a tenant, its `tenant-admin` and `member` AccessRoles, the one
 * fixed `lecturer` domain Role, the admin Person, an Account for them
 * (reused if one already exists for that email), and the default
 * Constraint rows. See `scripts/provision-tenant.ts`'s CLI header for the
 * full reasoning behind each piece — this function is that same reasoning,
 * unchanged, just callable from two places instead of copy-pasted into one.
 */
export async function provisionTenantCore(
    tx: Prisma.TransactionClient,
    input: ProvisionTenantInput,
): Promise<ProvisionTenantResult> {
    const adminEmail = input.adminEmail.toLowerCase();
    const timezone = input.timezone ?? 'UTC';

    // `noUncheckedIndexedAccess` (server tsconfig) types a destructured array
    // element as possibly `undefined`, unlike the CLI's original copy of this
    // logic in scripts/, which `nuxt typecheck` never covered — the flag
    // never had a chance to catch it there. `trimmedName` is non-empty
    // whenever `input.adminName` is (the route's zod schema requires
    // `min(1)`, and the CLI's `required()` does the equivalent), so `parts[0]`
    // falling back to the trimmed name itself is unreachable in practice, not
    // a behaviour change.
    const trimmedName = input.adminName.trim();
    const parts = trimmedName.split(/\s+/);
    const givenName = parts[0] ?? trimmedName;
    const familyName = parts.slice(1).join(' ') || givenName;

    // Shown once, never stored in plaintext. Computed unconditionally, like
    // the original CLI did, even though it goes unused when the Account is
    // reused below — simpler than threading a lazy hash through the branch.
    const initialPassword = randomBytes(12).toString('base64url');
    const passwordHash = await hashPassword(initialPassword);

    let federationId: string | null = null;

    if (input.federationSlug) {
        const federation = await tx.federation.findUnique({ where: { slug: input.federationSlug } });

        if (!federation) {
            throw new UnknownFederationError(`No federation with slug '${input.federationSlug}'. Create it first.`);
        }

        federationId = federation.id;
    }

    const tenant = await tx.tenant.create({
        data: { slug: input.slug, name: input.name, timezone, federationId },
    });

    // Domain vocabulary: the one fixed universal role (TAXONOMY.md §2).
    const lecturerRole = await tx.role.create({
        data: {
            tenantId: tenant.id,
            key: LECTURER_ROLE_KEY,
            name: 'Lecturer',
            description: 'Leads a Session. The one universal domain role.',
            isSystem: true,
        },
    });

    const adminAccessRole = await tx.accessRole.create({
        data: {
            tenantId: tenant.id,
            key: 'tenant-admin',
            name: 'Tenant Administrator',
            description: 'Full access to this tenant.',
            isSystem: true,
        },
    });

    await tx.accessRolePermission.createMany({
        data: PERMISSIONS.map((p) => ({
            accessRoleId: adminAccessRole.id,
            permissionKey: p.key,
            tenantId: tenant.id,
        })),
    });

    // The default role: everybody's own timetable, and nothing else. See the
    // CLI's own comment for why it ships EXACTLY one permission and is NOT
    // `isSystem` and NOT auto-assigned.
    const memberAccessRole = await tx.accessRole.create({
        data: {
            tenantId: tenant.id,
            key: 'member',
            name: 'Member',
            description: 'Sees their own timetable. The baseline for everyone at this institution.',
        },
    });

    await tx.accessRolePermission.create({
        data: {
            accessRoleId: memberAccessRole.id,
            permissionKey: 'session.read_own',
            tenantId: tenant.id,
        },
    });

    const person = await tx.person.create({
        data: { tenantId: tenant.id, givenName, familyName, email: adminEmail },
    });

    await tx.personAccessRole.create({
        data: { personId: person.id, accessRoleId: adminAccessRole.id, tenantId: tenant.id },
    });

    // Reuse an existing Account when this human already logs in elsewhere —
    // the entire point of a tenant-independent credential.
    const existing = await tx.account.findUnique({ where: { email: adminEmail } });
    const account = existing
        ?? (await tx.account.create({
            data: { email: adminEmail, passwordHash, mustChangePassword: true },
        }));

    await tx.accountPerson.create({ data: { accountId: account.id, personId: person.id } });

    await tx.constraint.createMany({
        data: DEFAULT_CONSTRAINTS.map((c) => ({ ...c, tenantId: tenant.id })),
    });

    return {
        tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name },
        person: { id: person.id, email: adminEmail },
        account: { id: account.id, reusedAccount: Boolean(existing) },
        lecturerRole: { id: lecturerRole.id },
        initialPassword: existing ? null : initialPassword,
    };
}
