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
 * property that the running application cannot do any of those things. The cost
 * is that there is no self-service signup, which is correct for an institutional
 * product.
 *
 * Everything below happens in ONE transaction: a failure leaves no half-built
 * tenant for someone to discover later.
 *
 *   bun run provision:tenant -- \
 *     --slug bergakademie --name "TU Bergakademie" \
 *     --admin-email dean@example.edu --admin-name "Ada Lovelace" \
 *     [--federation <slug>] [--timezone Europe/Berlin]
 */
import { randomBytes } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
// The real hashing path. This script used to re-implement scrypt inline; a
// second copy of the KDF drifts silently the moment the original changes.
import { hashPassword } from '../server/utils/auth';
import { PERMISSIONS } from '../shared/permissions';
import { LECTURER_ROLE_KEY } from '../shared/roles';
import { defaultConstraintRow, defaultConstraintTypes } from '../shared/constraintTypes';
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

/**
 * ONE DEFAULT ROW PER LIVE CATALOGUE TYPE (TAXONOMY.md §2).
 *
 * This used to be three hand-listed structural types. That list was written
 * before `no_double_booking_person` existed and was never updated, and because
 * `refreshViolations()` evaluates only the types a tenant has a row for, the
 * person-clash check has never run in any real tenant — while its unit test
 * passed, because the test creates its own row.
 *
 * Deriving the set from the catalogue instead of listing it is what stops that
 * recurring: a type added to `CONSTRAINT_TYPES` is now provisioned by
 * construction, and existing tenants are repaired by
 * `bun run backfill:constraints`.
 *
 * The evaluator still requires the row to exist at all — `constraint_violation
 * .constraint_id` is NOT NULL — which is why a tenant opts out by DISABLING a
 * default row rather than deleting it.
 */
const DEFAULT_CONSTRAINTS = defaultConstraintTypes().map(defaultConstraintRow);

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

    const [givenName, ...rest] = adminName.trim().split(/\s+/);
    const familyName = rest.join(' ') || givenName;

    // Shown once, never stored in plaintext.
    const initialPassword = randomBytes(12).toString('base64url');
    const passwordHash = await hashPassword(initialPassword);

    const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

    try {
        const result = await prisma.$transaction(async (tx) => {
            let federationId: string | null = null;

            if (federationSlug) {
                // Create-not-upsert: federations are managed separately, so an
                // unknown slug is an operator error rather than something to
                // silently create.
                const federation = await tx.federation.findUnique({ where: { slug: federationSlug } });

                if (!federation) {
                    throw new Error(`No federation with slug '${federationSlug}'. Create it first.`);
                }

                federationId = federation.id;
            }

            const tenant = await tx.tenant.create({
                data: { slug, name, timezone, federationId },
            });

            // Domain vocabulary: the one fixed universal role (TAXONOMY.md §2).
            // NOT a permission — this is what a Person IS, for scheduling.
            const lecturerRole = await tx.role.create({
                data: {
                    tenantId: tenant.id,
                    key: LECTURER_ROLE_KEY,
                    name: 'Lecturer',
                    description: 'Leads a Session. The one universal domain role.',
                    isSystem: true,
                },
            });

            // Authorization: what a Person may DO. A separate concept that
            // happens to share the word "role".
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

            /**
             * The default role: everybody's own timetable, and nothing else.
             *
             * WHY IT SHIPS WITH THE TENANT. Until `session.read_own` existed the
             * smallest role that could see a schedule at all needed six read
             * permissions covering the entire roster, so the honest answer to
             * "what do I give a lecturer?" was "compose one yourself, carefully".
             * A calendar product whose baseline role has to be hand-built is one
             * where the baseline is whatever the first admin guessed.
             *
             * EXACTLY ONE PERMISSION, deliberately. Adding
             * `availability.manage_own` would be defensible and is not this
             * script's call — declaring when the timetable may not use you is a
             * consequence the tenant owns (see the catalogue's note on it), and a
             * default that quietly grants two things is how a default stops being
             * read.
             *
             * NOT `is_system`, unlike `tenant-admin`. That flag means
             * "provisioning owns this and the tenant must not delete it", which
             * is true of the last administrator and false of a suggestion: an
             * institution that wants a different baseline should be able to
             * rename it, widen it, or remove it outright.
             *
             * NOT AUTO-ASSIGNED to new People either. Granting authority is
             * `person_access_role.assign` and belongs to a human decision on the
             * Person page — a generic CRUD route that silently granted a role on
             * every insert would be privilege escalation wearing a default's
             * clothes.
             */
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

            // Reuse an existing Account when this human already logs in
            // elsewhere — that is the entire point of a tenant-independent
            // credential (a lecturer working across a federation).
            const existing = await tx.account.findUnique({ where: { email: adminEmail } });
            const account = existing
                ?? (await tx.account.create({
                    data: { email: adminEmail, passwordHash, mustChangePassword: true },
                }));

            await tx.accountPerson.create({ data: { accountId: account.id, personId: person.id } });

            await tx.constraint.createMany({
                data: DEFAULT_CONSTRAINTS.map((c) => ({ ...c, tenantId: tenant.id })),
            });

            return { tenant, person, account, reusedAccount: Boolean(existing), lecturerRole };
        });

        console.log(`\nProvisioned tenant '${result.tenant.slug}' (${result.tenant.id})`);
        console.log(`  Admin Person : ${result.person.id} <${adminEmail}>`);
        console.log(`  Access role  : tenant-admin (all ${PERMISSIONS.length} permissions)`);
        console.log('  Access role  : member (session.read_own) — the default, assign it to people');
        console.log(`  Domain role  : lecturer (is_system)`);
        console.log(
            `  Constraints  : ${DEFAULT_CONSTRAINTS.length} default rows`
            + ` (${DEFAULT_CONSTRAINTS.filter((c) => c.isEnabled).length} enabled,`
            + ` ${DEFAULT_CONSTRAINTS.filter((c) => !c.isEnabled).length} available but off)`,
        );

        if (result.reusedAccount) {
            console.log('\n  Existing account reused — the current password is unchanged.');
        } else {
            console.log(`\n  Initial password: ${initialPassword}`);
            console.log('  Shown once and never recoverable. Must be changed at first sign-in.');
        }

        console.log('\nNo TimeGrid, Term or SessionKind was created: those are per-tenant');
        console.log('configuration and TAXONOMY.md §2 forbids assuming a grid shape.\n');
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        if (message.includes('Unique constraint')) {
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
