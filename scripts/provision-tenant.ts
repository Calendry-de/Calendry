/**
 * Stands up a new tenant. Infrastructure, not a product feature.
 *
 * WHY THIS IS A CLI AND NOT AN ENDPOINT
 * -------------------------------------
 * The app role literally cannot create a tenant. The RLS write policy on
 * `tenant` is `id = calendry.current_tenant_id()`, which is unsatisfiable for a
 * row that does not exist yet — there is no context to set. Provisioning
 * therefore needs the OWNER connection.
 *
 * Exposing this over HTTP would mean the Nuxt process holds owner credentials,
 * and a compromised web tier could then create tenants, drop FORCE ROW LEVEL
 * SECURITY, or read every institution's data. Keeping it in a CLI preserves the
 * property that the running application cannot do any of those things.
 *
 * ISSUE #76 ADDED A SECOND CALLER: `POST /api/staff/tenants`, gated by
 * `requireStaffIdentity()` — a Calendry-staff-only credential, the fourth
 * tenant-isolation exception (CLAUDE.md, DECISIONS.md "Staff principal — the
 * fourth tenant-isolation exception"). That is still not self-service signup
 * (an ordinary tenant Account can never reach it), so the property this
 * comment describes is unchanged: the RUNTIME app role still cannot create a
 * tenant, and the owner credential still never leaves routes gated
 * specifically for it. The actual transaction below moved to
 * `server/utils/provisionTenant.ts` (`provisionTenantCore`) so this CLI and
 * that route share one implementation rather than two that can drift; this
 * file is now the CLI shell around it — argument parsing, the owner
 * connection, and reporting.
 *
 * Everything in `provisionTenantCore` happens in ONE transaction: a failure
 * leaves no half-built tenant for someone to discover later.
 *
 *   bun run provision:tenant -- \
 *     --slug bergakademie --name "TU Bergakademie" \
 *     --admin-email dean@example.edu --admin-name "Ada Lovelace" \
 *     [--federation <slug>] [--timezone Europe/Berlin]
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { PERMISSIONS } from '../shared/permissions';
import { DEFAULT_CONSTRAINTS, UnknownFederationError, provisionTenantCore } from '../server/utils/provisionTenant';
import { describeTarget, resolveOwnerDatabaseUrl } from './lib/ownerDatabaseUrl';

function arg(name: string): string | undefined {
    const index = process.argv.indexOf(`--${name}`);

    return index === -1 ? undefined : process.argv[index + 1];
}

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
            + 'Provisioning requires the OWNER connection — the runtime role cannot\n'
            + 'create tenants by design.\n',
        );
        process.exit(1);
    }

    const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

    try {
        const result = await prisma.$transaction((tx) => provisionTenantCore(tx, {
            slug, name, adminEmail, adminName, federationSlug, timezone,
        }));

        console.log(`\nProvisioned tenant '${result.tenant.slug}' (${result.tenant.id})`);
        console.log(`  Admin Person : ${result.person.id} <${result.person.email}>`);
        console.log(`  Access role  : tenant-admin (all ${PERMISSIONS.length} permissions)`);
        console.log('  Access role  : member (session.read_own) — the default, assign it to people');
        console.log(`  Domain role  : lecturer (is_system)`);
        console.log(
            `  Constraints  : ${DEFAULT_CONSTRAINTS.length} default rows`
            + ` (${DEFAULT_CONSTRAINTS.filter((c) => c.isEnabled).length} enabled,`
            + ` ${DEFAULT_CONSTRAINTS.filter((c) => !c.isEnabled).length} available but off)`,
        );

        if (result.account.reusedAccount) {
            console.log('\n  Existing account reused — the current password is unchanged.');
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
        } else if (message.includes('Unique constraint')) {
            console.error(`\nA tenant with slug '${slug}' already exists. Provisioning creates, it does not update.\n`);
        } else if (/Unable to start a transaction|Can't reach database server|ECONNREFUSED|ENOTFOUND/i.test(message)) {
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
