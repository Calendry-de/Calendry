/**
 * Stands up a new tenant. Infrastructure, not a product feature.
 *
 * WHY THIS IS A CLI AND NOT AN ENDPOINT
 * -------------------------------------
 * The app role literally cannot create a tenant. The RLS write policy on
 * `tenant` is `id = calendry.current_tenant_id()`, which is unsatisfiable for a
 * row that does not exist yet, since there is no context to set. Provisioning
 * therefore needs the OWNER connection.
 *
 * Exposing this over HTTP would mean the Nuxt process holds owner credentials,
 * and a compromised web tier could then create tenants, drop FORCE ROW LEVEL
 * SECURITY, or read every institution's data. Keeping it in a CLI preserves the
 * property that the running application cannot do any of those things.
 *
 * ISSUE #76 ADDED A SECOND CALLER: `POST /api/staff/tenants`, gated by
 * `requireStaffIdentity()`, a Calendry-staff-only credential and the fourth
 * tenant-isolation exception (CLAUDE.md, DECISIONS.md "Staff principal, the
 * fourth tenant-isolation exception"). That is still not self-service signup
 * (an ordinary tenant Account can never reach it), so the property this
 * comment describes is unchanged: the RUNTIME app role still cannot create a
 * tenant, and the owner credential still never leaves routes gated
 * specifically for it. The actual tenant-creation logic lives in ONE place,
 * `calendry_internal.staff_create_tenant()`, a SECURITY DEFINER SQL function
 * (issue #105), called via `provisionTenantViaFunction()`
 * (`server/utils/staffCreateTenant.ts`) so this CLI and that route share one
 * implementation rather than two that can drift, the way they briefly did
 * between issues #105 and #107. This file is the CLI shell around it:
 * argument parsing, the owner connection (needed only because `tenant`'s RLS
 * write policy is unsatisfiable before the row exists; the function itself
 * is what runs privileged, not this connection), and reporting.
 *
 * `calendry_internal.staff_create_tenant()` is already atomic on its own, a
 * single statement invoking a SQL function (see the migration's own
 * "ATOMICITY" note), so this CLI wraps it in no `$transaction` of its own: a
 * failure leaves no half-built tenant for someone to discover later.
 *
 *   bun run provision:tenant -- \
 *     --slug bergakademie --name "TU Bergakademie" \
 *     --admin-email dean@example.edu --admin-name "Ada Lovelace" \
 *     [--federation <slug>] [--timezone Europe/Berlin]
 */
import { PERMISSIONS } from '../shared/permissions';
import { DEFAULT_CONSTRAINTS, UnknownFederationError } from '../server/utils/provisionTenant';
import { provisionTenantViaFunction, rawPostgresErrorCode } from '../server/utils/staffCreateTenant';
import { describeTarget, resolveOwnerDatabaseUrl } from './lib/ownerDatabaseUrl';
import { arg, createOwnerPrisma, isUnreachableDatabaseError } from './lib/cli';

function required(name: string): string {
    const value = arg(name);

    if (!value) {
        console.error(`Missing required --${name}`);
        process.exit(1);
    }

    return value;
}

async function main() {
    const slug = required('slug');
    const name = required('name');
    const adminEmail = required('admin-email').toLowerCase();
    const adminName = required('admin-name');
    const federationSlug = arg('federation');
    const timezone = arg('timezone') ?? 'UTC';

    // Picks the host- or container-appropriate owner URL. Preferring the host
    // one unconditionally was wrong: bun auto-loads .env and the app container
    // mounts the repo, so both variables exist inside the container too.
    let connectionString: string;

    try {
        connectionString = resolveOwnerDatabaseUrl();
    } catch (error) {
        console.error(
            `\n${error instanceof Error ? error.message : String(error)}\n\n`
            + 'Provisioning requires the OWNER connection: the runtime role cannot\n'
            + 'create tenants by design.\n',
        );
        process.exit(1);
    }

    const prisma = createOwnerPrisma();

    try {
        const result = await provisionTenantViaFunction(prisma, {
            slug, name, adminEmail, adminName, federationSlug, timezone,
        });

        console.log(`\nProvisioned tenant '${result.tenant.slug}' (${result.tenant.id})`);
        console.log(`  Admin Person : ${result.person.id} <${result.person.email}>`);
        console.log(`  Access role  : tenant-admin (all ${PERMISSIONS.length} permissions)`);
        console.log('  Access role  : member (session.read_own): the default, assign it to people');
        console.log(`  Domain role  : lecturer (is_system)`);
        console.log(
            `  Constraints  : ${DEFAULT_CONSTRAINTS.length} default rows`
            + ` (${DEFAULT_CONSTRAINTS.filter((c) => c.isEnabled).length} enabled,`
            + ` ${DEFAULT_CONSTRAINTS.filter((c) => !c.isEnabled).length} available but off)`,
        );

        if (result.account.reusedAccount) {
            console.log('\n  Existing account reused: the current password is unchanged.');
        } else {
            console.log(`\n  Initial password: ${result.initialPassword}`);
            console.log('  Shown once and never recoverable. Must be changed at first sign-in.');
        }

        console.log('\nNo TimeGrid, Term or SessionKind was created: those are per-tenant');
        console.log('configuration and TAXONOMY.md §2 forbids assuming a grid shape.\n');
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        if (error instanceof UnknownFederationError) {
            console.error(`\n${message}\n`);
        } else if (rawPostgresErrorCode(error) === '23505') {
            // `calendry_internal.staff_create_tenant()` raises the ordinary
            // `unique_violation` SQLSTATE for a duplicate slug, surfaced via
            // `$queryRaw` as a P2010 wrapper, not the P2002
            // `Prisma.PrismaClientKnownRequestError` a `tx.tenant.create()`
            // call used to raise, so the old `message.includes('Unique
            // constraint')` text match no longer fires. See
            // `rawPostgresErrorCode()`'s own comment
            // (`server/utils/staffCreateTenant.ts`) for why `.originalCode`
            // is the only reliable field here, same check
            // `POST /api/staff/tenants` uses for the identical error.
            console.error(`\nA tenant with slug '${slug}' already exists. Provisioning creates, it does not update.\n`);
        } else if (isUnreachableDatabaseError(message)) {
            // Prisma reports an unreachable host as a transaction-acquisition
            // timeout, which reads like a load problem and sends people looking
            // in the wrong place entirely.
            const host = describeTarget(connectionString);

            console.error(
                `\nCould not reach the database at ${host}.\n\n`
                + '  - Is it running?   docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d db\n'
                + `  - Reachable from here? '${host.split(':')[0]}' must resolve from THIS shell.\n`
                + '    The compose-internal hostname `db` does not; set MIGRATION_DATABASE_URL_HOST\n'
                + '    to the published port (see .env.example).\n\n'
                + `Nothing was written. Underlying error: ${message}\n`,
            );
        } else {
            console.error(`\nProvisioning failed, nothing was written: ${message}\n`);
        }

        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

await main();
