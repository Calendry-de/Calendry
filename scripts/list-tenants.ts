/**
 * Lists every tenant and its slug: read-only, no confirmation needed.
 *
 * OWNER CONNECTION, NOT THE APP ROLE. `tenant` sits above `withTenant()`: there
 * is no tenant context yet to scope by, so an app-role query outside a request
 * would see zero rows (CLAUDE.md, "Never query outside withTenant()"), not
 * "every tenant". Only the owner can answer "what tenants exist at all".
 *
 *   bun run list:tenants
 */
import { describeTarget, resolveOwnerDatabaseUrl } from './lib/ownerDatabaseUrl';
import { createOwnerPrisma, formatUnreachableDatabaseError, isUnreachableDatabaseError } from './lib/cli';

async function main() {
    const connectionString = resolveOwnerDatabaseUrl();
    const prisma = createOwnerPrisma();

    try {
        const tenants = await prisma.tenant.findMany({
            orderBy: { slug: 'asc' },
            include: {
                federation: { select: { slug: true } },
                _count: { select: { people: true } },
            },
        });

        console.log(`${describeTarget(connectionString)}: ${tenants.length} tenant(s)\n`);

        if (tenants.length === 0) {
            console.log('(none, run `bun run provision:tenant` first)');

            return;
        }

        const slugWidth = Math.max(4, ...tenants.map((t) => t.slug.length));
        const nameWidth = Math.max(4, ...tenants.map((t) => t.name.length));

        console.log(`${'SLUG'.padEnd(slugWidth)}  ${'NAME'.padEnd(nameWidth)}  PEOPLE  FEDERATION  ID`);

        for (const t of tenants) {
            console.log(
                `${t.slug.padEnd(slugWidth)}  ${t.name.padEnd(nameWidth)}  `
                + `${String(t._count.people).padEnd(6)}  ${(t.federation?.slug ?? '-').padEnd(10)}  ${t.id}`,
            );
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        if (isUnreachableDatabaseError(message)) {
            console.error(formatUnreachableDatabaseError(connectionString));
        } else {
            console.error(`\nFailed: ${message}\n`);
        }

        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

await main();
