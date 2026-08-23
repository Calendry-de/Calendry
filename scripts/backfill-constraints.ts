/**
 * Creates the missing DEFAULT Constraint rows for existing tenants.
 *
 * WHY THIS EXISTS
 * ---------------
 * Exactly the shape `grant:permissions --all-missing` exists for, one layer
 * down. `provision:tenant` now creates one default row per live catalogue type
 * (TAXONOMY.md §2), but only at creation time — so every tenant provisioned
 * before a type was added is missing that type's row.
 *
 * That is not cosmetic. `refreshViolations()` evaluates ONLY the types a tenant
 * has a row for, so a missing row is a SILENTLY DISABLED rule rather than a
 * neutral absence. The case that proved it: `no_double_booking_person` was
 * added to the catalogue in Stage 7a and never added to the old three-item
 * provisioning list, so the person-clash check had never run in any real
 * tenant — while `tests/violations-person-clash.test.ts` passed, because it
 * creates its own row.
 *
 * WHY A CLI AND NOT `prisma db seed`
 * ----------------------------------
 * The seed runs on EVERY deploy and is reference-data only: it mirrors the
 * `permission` catalogue, which is code. Constraint rows are TENANT DATA — a
 * tenant's weights, toggles and params are theirs. A seed that wrote them per
 * deploy would be the same category of mistake as one that silently widened
 * every tenant's AccessRole, and CLAUDE.md rejects that explicitly.
 *
 * So: an audited, opt-in operator action, run once after adding a type.
 *
 * WHAT IT WILL NOT DO
 * -------------------
 * It only ever CREATES rows that are absent. It never edits an existing row —
 * not its weight, not its enabled state, not its name. A tenant who disabled a
 * rule or retuned a weight keeps that decision; re-running is idempotent and
 * silent.
 *
 *   bun run backfill:constraints -- --all-missing --dry-run
 *   bun run backfill:constraints -- --all-missing
 *   bun run backfill:constraints -- --all-missing --tenant test --yes
 */
import { createInterface } from 'node:readline/promises';
import { hostname, userInfo } from 'node:os';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { defaultConstraintRow, defaultConstraintTypes } from '../shared/constraintTypes';
import { describeTarget, resolveOwnerDatabaseUrl } from './lib/ownerDatabaseUrl';

function arg(name: string): string | undefined {
    const index = process.argv.indexOf(`--${name}`);

    return index === -1 ? undefined : process.argv[index + 1];
}

async function main() {
    const allMissing = process.argv.includes('--all-missing');
    const tenantSlug = arg('tenant');
    const dryRun = process.argv.includes('--dry-run');
    const skipConfirm = process.argv.includes('--yes');

    if (!allMissing) {
        console.error(
            'Missing required --all-missing.\n\n'
            + '  bun run backfill:constraints -- --all-missing [--tenant <slug>] [--dry-run] [--yes]\n\n'
            + 'The flag is required rather than implied so the command cannot be run by accident;\n'
            + 'there is deliberately no per-type selection, because a partially-seeded tenant is the\n'
            + 'exact state this repairs.',
        );
        process.exit(1);
    }

    const url = resolveOwnerDatabaseUrl();
    const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

    try {
        console.log(`Backfilling ${describeTarget(url)}...`);

        const wanted = defaultConstraintTypes().map(defaultConstraintRow);

        const tenants = await prisma.tenant.findMany({
            where: tenantSlug ? { slug: tenantSlug } : {},
            select: { id: true, slug: true },
            orderBy: { slug: 'asc' },
        });

        if (tenants.length === 0) {
            console.error(
                tenantSlug
                    ? `\nNo tenant with slug '${tenantSlug}'.\n`
                    : '\nNo tenants exist.\n',
            );
            process.exit(1);
        }

        const planned = [];

        for (const tenant of tenants) {
            /**
             * Keyed on `isDefault`, not on "any row of this type". A tenant may
             * legitimately hold scoped VARIANTS of a type without holding its
             * default row, and it is the default row this repairs — matching on
             * type alone would look complete while leaving the rule unreachable.
             */
            const existing = await prisma.constraint.findMany({
                where: { tenantId: tenant.id, isDefault: true },
                select: { type: true },
            });
            const have = new Set(existing.map((row) => row.type));

            planned.push({
                ...tenant,
                missing: wanted.filter((row) => !have.has(row.type)),
            });
        }

        const total = planned.reduce((sum, p) => sum + p.missing.length, 0);

        console.log(`\nCatalogue ${wanted.length} live type(s)`);
        console.log(`Tenants   ${planned.length} (${planned.map((p) => p.slug).join(', ')})`);
        console.log(`To create ${total} default row(s)\n`);

        for (const plan of planned) {
            if (plan.missing.length === 0) {
                console.log(`  ${plan.slug}: already complete`);
            } else {
                console.log(`  ${plan.slug}: +${plan.missing.length} → ${plan.missing.map((m) => m.type).join(', ')}`);
            }
        }

        if (total === 0) {
            console.log('\nNothing to create. Every tenant holds a default row for every live type.\n');

            return;
        }

        if (dryRun) {
            console.log('\n--dry-run: nothing was written.\n');

            return;
        }

        if (!skipConfirm) {
            const rl = createInterface({ input: process.stdin, output: process.stdout });
            const answer = await rl.question(`\nCreate ${total} default row(s)? Type 'backfill' to confirm: `);

            rl.close();

            if (answer.trim() !== 'backfill') {
                console.error('\nDoes not match. Nothing was changed.\n');
                process.exit(1);
            }
        }

        // One transaction across every tenant, for grant:permissions' reason: a
        // partial backfill leaves some tenants evaluating a rule and others
        // silently not, which is harder to diagnose than a clean failure.
        const written = await prisma.$transaction(async (tx) => {
            let count = 0;

            for (const plan of planned) {
                if (plan.missing.length === 0) {
                    continue;
                }

                const result = await tx.constraint.createMany({
                    data: plan.missing.map((row) => ({ ...row, tenantId: plan.id })),
                    // Belt and braces against a concurrent run. The partial
                    // unique index would refuse a genuine duplicate anyway.
                    skipDuplicates: true,
                });

                count += result.count;
            }

            return count;
        });

        console.log(`\nCreated ${written} default constraint row(s).`);
        console.log('Structural rules are enabled; solver-owned rules are created DISABLED,');
        console.log('so no existing tenant\'s next solve changes because of this.\n');

        console.log('AUDIT ' + JSON.stringify({
            ts: new Date().toISOString(),
            action: 'constraint.defaults_backfilled',
            tenants: planned.filter((p) => p.missing.length).map((p) => p.slug),
            created: written,
            operator: `${userInfo().username}@${hostname()}`,
            via: 'cli:backfill-constraints',
        }));
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
