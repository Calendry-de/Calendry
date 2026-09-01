/**
 * Creates a Federation and/or attaches/detaches existing Tenants to one.
 *
 * WHY THIS IS A CLI AND NOT AN ENDPOINT
 * -------------------------------------
 * Same reasoning as `provision-tenant.ts`: this is infrastructure, not a
 * product feature. Beyond that, a self-service "attach my tenant to a
 * federation" HTTP route would let a tenant admin join any federation whose
 * id or slug they merely happen to know — and a Tenant's federation is what
 * widens RLS read access to that federation's shared Room/Equipment/
 * Offering/Session rows (CLAUDE.md, "The three deliberate exceptions to
 * tenant isolation" #1). Joining is therefore a decision with real
 * cross-tenant visibility consequences and no consent step of its own;
 * federation-level permissions are a separate, larger question left out of
 * scope by design (see issue #64). Keeping this an operator-run CLI, with no
 * `/api/federations` route, is what keeps that decision out of a tenant
 * admin's own hands until that larger question is answered.
 *
 * Everything below happens in ONE transaction: a failure leaves nothing
 * half-built (no Federation row with no attached Tenants because the attach
 * half threw, no Tenant half-detached).
 *
 * IDEMPOTENT BY LOOKUP-THEN-CREATE, matching the rest of this family
 * (`create-account.ts`): creating a Federation that already exists (by slug)
 * reports that clearly and changes nothing, rather than throwing a raw unique
 * violation or silently creating a second row (impossible anyway — `slug` is
 * `@unique` — but a confusing error is still a worse experience than a report).
 * Attach/detach are naturally idempotent: setting the same `federationId`
 * twice is a no-op UPDATE.
 *
 *   bun run provision:federation -- --slug ruhr --name "Ruhr Federation"
 *   bun run provision:federation -- --slug ruhr --attach-tenant bergakademie
 *   bun run provision:federation -- --slug ruhr --detach-tenant bergakademie
 *   bun run provision:federation -- --slug ruhr --name "Ruhr Federation" \
 *       --attach-tenant bergakademie --attach-tenant clausthal
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { describeTarget, resolveOwnerDatabaseUrl } from './lib/ownerDatabaseUrl';

function arg(name: string): string | undefined {
    const index = process.argv.indexOf(`--${name}`);

    return index === -1 ? undefined : process.argv[index + 1];
}

function args(name: string): string[] {
    const values: string[] = [];

    for (let i = 0; i < process.argv.length; i += 1) {
        if (process.argv[i] === `--${name}` && process.argv[i + 1]) {
            values.push(process.argv[i + 1]);
        }
    }

    return values;
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
    const name = arg('name');
    const attachTenantSlugs = args('attach-tenant');
    const detachTenantSlugs = args('detach-tenant');

    if (!name && attachTenantSlugs.length === 0 && detachTenantSlugs.length === 0) {
        console.error(
            '\nNothing to do. Pass --name to create the federation, and/or\n'
            + '--attach-tenant / --detach-tenant to change its membership.\n'
            + '\nUsage: bun run provision:federation -- --slug <slug> [--name "<name>"]\n'
            + '           [--attach-tenant <tenant-slug>]... [--detach-tenant <tenant-slug>]...\n',
        );
        process.exit(1);
    }

    let connectionString: string;

    try {
        connectionString = resolveOwnerDatabaseUrl();
    } catch (error) {
        console.error(
            `\n${error instanceof Error ? error.message : String(error)}\n\n`
            + 'Provisioning requires the OWNER connection — the runtime role cannot\n'
            + 'create or reassign federations by design.\n',
        );
        process.exit(1);
    }

    const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

    try {
        const result = await prisma.$transaction(async (tx) => {
            const existing = await tx.federation.findUnique({ where: { slug } });
            let federation = existing;
            let created = false;

            if (!federation) {
                if (!name) {
                    throw new Error(
                        `No federation with slug '${slug}'. Pass --name "<name>" to create it.`,
                    );
                }

                federation = await tx.federation.create({ data: { slug, name } });
                created = true;
            }

            const attached: string[] = [];
            const detached: string[] = [];

            for (const tenantSlug of attachTenantSlugs) {
                const tenant = await tx.tenant.findUnique({ where: { slug: tenantSlug } });

                if (!tenant) {
                    throw new Error(`No tenant with slug '${tenantSlug}'. Nothing was changed.`);
                }

                await tx.tenant.update({ where: { id: tenant.id }, data: { federationId: federation.id } });
                attached.push(tenantSlug);
            }

            for (const tenantSlug of detachTenantSlugs) {
                const tenant = await tx.tenant.findUnique({ where: { slug: tenantSlug } });

                if (!tenant) {
                    throw new Error(`No tenant with slug '${tenantSlug}'. Nothing was changed.`);
                }

                await tx.tenant.update({ where: { id: tenant.id }, data: { federationId: null } });
                detached.push(tenantSlug);
            }

            return { federation, created, reused: Boolean(existing), attached, detached };
        });

        if (result.created) {
            console.log(`\nCreated federation '${result.federation.slug}' (${result.federation.id})`);
        } else {
            console.log(
                `\nFederation '${result.federation.slug}' (${result.federation.id}) already exists`
                + ' — nothing created.',
            );

            if (name && name !== result.federation.name) {
                console.log(`  Note: existing name is '${result.federation.name}'; --name '${name}' was ignored.`);
                console.log('  This script creates and links; it does not rename an existing federation.');
            }
        }

        if (result.attached.length > 0) {
            console.log(`  Attached: ${result.attached.join(', ')}`);
        }

        if (result.detached.length > 0) {
            console.log(`  Detached: ${result.detached.join(', ')}`);
        }

        if (result.attached.length === 0 && result.detached.length === 0) {
            console.log('  No membership changes requested.');
        }

        console.log('');
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        if (message.includes('Unique constraint')) {
            console.error(`\nA federation with slug '${slug}' already exists. Nothing was written.\n`);
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
            console.error(`\n${message}\n`);
        }

        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

await main();
