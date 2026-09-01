import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { resolveOwnerDatabaseUrl } from '../../scripts/lib/ownerDatabaseUrl';

/**
 * Prisma singleton connected as the OWNER role — issue #76.
 *
 * `server/api/staff/*` is the one place inside the RUNNING APP that
 * legitimately needs this: a staff principal (`StaffIdentity`,
 * `tenantResolver.ts`) acts across every tenant — onboarding, support — and
 * the owner connection is the only one that can see or create rows outside a
 * single tenant's RLS context. Same reasoning `scripts/provision-tenant.ts`
 * already documents in full ("the app role literally cannot create a
 * tenant": the RLS write policy on `tenant` is unsatisfiable for a row that
 * does not exist yet).
 *
 * NEVER import this from a tenant-scoped route. Every ordinary request goes
 * through `getPrisma()` (`server/utils/prisma.ts`) and `withTenant()`, which
 * is what keeps a compromised web-tier request from seeing another
 * institution's data. This client has no such fence — it IS the other side
 * of that fence — so its use stays confined to the small number of routes
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
