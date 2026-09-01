/**
 * Creates a StaffAccount — Calendry's own staff credential (issue #76), not a
 * tenant Account. Infrastructure, not a product feature.
 *
 * WHY THIS IS A CLI AND NOT AN ENDPOINT
 * -------------------------------------
 * Decided in issue #106: `StaffAccount` is the highest-privilege credential in
 * the system (cross-tenant reach, can create tenants via `/api/staff/tenants`),
 * so minting one is deliberately out-of-band, provisioned only by someone with
 * server/CLI access — the same trust boundary `provision-tenant.ts`'s own
 * header comment argues for. There is NO HTTP route for this, not even a
 * staff-authenticated one: a self-service "create another staff account"
 * endpoint would let any staff account mint another, with nothing outside the
 * app tier able to say no.
 *
 * `staff_account` carries no `tenant_id` and no RLS (see the
 * `20260901160000_staff_account` migration header), so — unlike
 * `provision-tenant.ts` — this does NOT strictly need the owner connection for
 * correctness. It uses one anyway, matching the rest of this `provision-*`
 * family exactly: same argument-parsing helper, same owner-DB resolution, same
 * "nothing was written" error reporting, so an operator reading one of these
 * scripts already knows how all of them behave.
 *
 * IDEMPOTENT BY LOOKUP-THEN-CREATE (`email` is `@unique`), matching
 * `provision-federation.ts`'s handling of an existing slug: an email that
 * already has a StaffAccount is reported clearly and nothing is written or
 * duplicated, rather than throwing a raw unique-constraint error.
 *
 * NO `--name`: unlike a tenant admin, a `StaffAccount` has no name field (see
 * the `StaffAccount` model in `prisma/schema.prisma`) — it is a bare
 * credential, identified only by `email`.
 *
 *   bun run provision:staff -- --email ops@calendry.de
 */
import { randomBytes } from 'node:crypto';
import { hashPassword } from '../server/utils/auth';
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
    const email = required('email').toLowerCase();

    let connectionString: string;

    try {
        connectionString = resolveOwnerDatabaseUrl();
    } catch (error) {
        console.error(
            `\n${error instanceof Error ? error.message : String(error)}\n\n`
            + 'Provisioning requires the OWNER connection, matching every other\n'
            + 'provision-* script in this family.\n',
        );
        process.exit(1);
    }

    const prisma = createOwnerPrisma();

    try {
        const result = await prisma.$transaction(async (tx) => {
            const existing = await tx.staffAccount.findUnique({ where: { email } });

            if (existing) {
                return { staffAccount: existing, created: false, initialPassword: null as string | null };
            }

            // Shown once, never stored in plaintext — same shape as
            // `provisionTenantViaFunction`'s admin password
            // (`server/utils/staffCreateTenant.ts`).
            const initialPassword = randomBytes(12).toString('base64url');
            const passwordHash = await hashPassword(initialPassword);

            const staffAccount = await tx.staffAccount.create({
                data: { email, passwordHash },
            });

            return { staffAccount, created: true, initialPassword };
        });

        if (!result.created) {
            console.log(
                `\nA StaffAccount for '${email}' already exists (${result.staffAccount.id})`
                + ' — nothing created, the current password is unchanged.\n',
            );
        } else {
            console.log(`\nProvisioned StaffAccount '${email}' (${result.staffAccount.id})`);
            console.log(`\n  Initial password: ${result.initialPassword}`);
            console.log('  Shown once and never recoverable. Sign in at /staff/login.\n');
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        if (message.includes('Unique constraint')) {
            console.error(`\nA StaffAccount for '${email}' already exists. Nothing was written.\n`);
        } else if (isUnreachableDatabaseError(message)) {
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
