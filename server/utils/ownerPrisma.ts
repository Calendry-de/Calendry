import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { resolveOwnerDatabaseUrl } from '../../scripts/lib/ownerDatabaseUrl';

/**
 * Prisma singleton connected as the OWNER role — issue #76.
 *
 * As of issue #105, ONLY `GET /api/staff/tenants` (`index.get.ts`, listing
 * every tenant across the whole install) still uses this: a plain
 * cross-tenant READ that has no single tenant to open an RLS context for.
 * `POST /api/staff/tenants` (tenant CREATION) used to be the other caller and
 * no longer is — it now goes through `calendry_internal.staff_create_tenant()`,
 * a narrow SECURITY DEFINER function reachable via the ORDINARY runtime
 * connection (`provisionTenantViaFunction()`,
 * `server/utils/staffCreateTenant.ts`), which is what #105 was for: a
 * standing owner connection in the running app could see or write across
 * every tenant, gated only by application-level `requireStaffIdentity()`
 * logic rather than by the database itself. This module stays for the
 * read-only case, which is a materially smaller risk (nothing it does is a
 * write, and RLS's read-side widening for Federation-owned resources means
 * an ordinary tenant-scoped connection cannot express "every tenant" the way
 * a write already could not express "a tenant that does not exist yet")
 * — but the same hardening applies if that route ever needs to change.
 *
 * NEVER import this from a tenant-scoped route. Every ordinary request goes
 * through `getPrisma()` (`server/utils/prisma.ts`) and `withTenant()`, which
 * is what keeps a compromised web-tier request from seeing another
 * institution's data. This client has no such fence — it IS the other side
 * of that fence — so its use stays confined to the one remaining route
 * gated by `requireStaffIdentity()`.
 */
let client: PrismaClient | undefined;

export function getOwnerPrisma(): PrismaClient {
    if (!client) {
        client = new PrismaClient({
            adapter: new PrismaPg({ connectionString: resolveOwnerDatabaseUrl() }),
        });
    }

    return client;
}
