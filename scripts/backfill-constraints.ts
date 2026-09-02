/**
 * Creates the missing DEFAULT Constraint rows for existing tenants.
 *
 * WHY THIS EXISTS
 * ---------------
 * Exactly the shape `grant:permissions --all-missing` exists for, one layer
 * down. `provision:tenant` now creates one default row per live catalogue type
 * (TAXONOMY.md §2), but only at creation time, so every tenant provisioned
 * before a type was added is missing that type's row.
 *
 * That is not cosmetic. `refreshViolations()` evaluates ONLY the types a tenant
 * has a row for, so a missing row is a SILENTLY DISABLED rule rather than a
 * neutral absence. The case that proved it: `no_double_booking_person` was
 * added to the catalogue in Stage 7a and never added to the old three-item
 * provisioning list, so the person-clash check had never run in any real
 * tenant, while `tests/violations-person-clash.test.ts` passed, because it
 * creates its own row.
 *
 * WHY A CLI AND NOT `prisma db seed`
 * ----------------------------------
 * The seed runs on EVERY deploy and is reference-data only: it mirrors the
 * `permission` catalogue, which is code. Constraint rows are TENANT DATA: a
 * tenant's weights, toggles and params are theirs. A seed that wrote them per
 * deploy would be the same category of mistake as one that silently widened
 * every tenant's AccessRole, and CLAUDE.md rejects that explicitly.
 *
 * So: an audited, opt-in operator action, run once after adding a type.
 *
 * WHAT `--all-missing` WILL NOT DO
 * --------------------------------
 * It only ever CREATES rows that are absent. It never edits an existing row:
 * not its weight, not its enabled state, not its name. A tenant who disabled a
 * rule or retuned a weight keeps that decision; re-running is idempotent and
 * silent.
 *
 * `--retype` IS THE DELIBERATE EXCEPTION, AND WHY IT EXISTS
 * --------------------------------------------------------
 * The catalogue pins severity per type, because the severity IS the meaning. So
 * when a type's declared severity CHANGES (`online_onsite_same_day_exclusion`
 * went HARD to SOFT when the tenant asked for mixing to be discouraged rather
 * than forbidden), every stored row is left contradicting the catalogue, and no
 * amount of creating absent rows fixes it.
 *
 * Leaving them is not a neutral option. `toWireConstraint` reads the CATALOGUE's
 * severity, not the row's, so a stored HARD row under a SOFT catalogue entry
 * ships as `weight: row.weight ?? 0`, and a HARD row's weight is NULL by
 * database CHECK. Zero means "count it, do not steer". The rule would stop
 * filtering AND stop steering in one deploy, reported only as a line in
 * `report.severityMismatches`.
 *
 * So this mode updates `severity` and `weight` TOGETHER in one statement, which
 * is also the only way to satisfy `constraint_weight_matches_severity`
 * (HARD ⇒ weight NULL, SOFT ⇒ weight NOT NULL); writing either alone would be
 * refused by the database mid-flight.
 *
 * It still touches nothing else: `is_enabled`, `name`, `params` and scoped
 * variants' own settings are the tenant's and stay as they are.
 *
 *   bun run backfill:constraints -- --all-missing --dry-run
 *   bun run backfill:constraints -- --all-missing
 *   bun run backfill:constraints -- --retype online_onsite_same_day_exclusion --dry-run
 *   bun run backfill:constraints -- --retype online_onsite_same_day_exclusion --tenant test --yes
 */
import { createInterface } from 'node:readline/promises';
import { hostname, userInfo } from 'node:os';
import type { PrismaClient } from '@prisma/client';
import {
    CONSTRAINT_TYPE_KEYS,
    defaultConstraintRow,
    defaultConstraintTypes,
    findConstraintType,
} from '../shared/constraintTypes';
import { describeTarget, resolveOwnerDatabaseUrl } from './lib/ownerDatabaseUrl';
import { arg, createOwnerPrisma } from './lib/cli';

/**
 * Realign every stored row of ONE type with the catalogue's current severity.
 *
 * Severity and weight move together in a single UPDATE, because
 * `constraint_weight_matches_severity` refuses HARD-with-weight and
 * SOFT-without, so writing either alone fails, and writing them in two
 * statements would fail on the first.
 *
 * Rows already matching the catalogue are left alone and reported as such, so a
 * re-run is idempotent and says so rather than claiming to have done work.
 */
async function retypeMode(
    prisma: PrismaClient,
    url: string,
    options: { key: string; tenantSlug?: string; dryRun: boolean; skipConfirm: boolean },
): Promise<void> {
    const type = findConstraintType(options.key);

    if (!type) {
        console.error(`\nNot a catalogue type: '${options.key}'.`);
        console.error(`The catalogue is shared/constraintTypes.ts. Known: ${CONSTRAINT_TYPE_KEYS.join(', ')}\n`);
        process.exit(1);
    }

    if (!type.severity) {
        console.error(
            `\n'${type.key}' declares no fixed severity: the tenant chooses it, so there is\n`
            + 'nothing to realign to. Nothing was changed.\n',
        );
        process.exit(1);
    }

    /*
     * The catalogue is the authority on what the rows SHOULD be, and
     * `defaultConstraintRow` is the one function that reads it, including the
     * throw for a SOFT type with no `defaultWeight`, which is what stops this
     * command from quietly writing weight 0 and disabling the rule it is
     * repairing.
     */
    const target = defaultConstraintRow(type);

    console.log(`Realigning ${describeTarget(url)}...`);
    console.log(`\nType      ${type.key}`);
    console.log(`Catalogue ${target.severity}${target.weight === null ? '' : `, weight ${target.weight}`}`);

    const tenants = await prisma.tenant.findMany({
        where: options.tenantSlug ? { slug: options.tenantSlug } : {},
        select: { id: true, slug: true },
        orderBy: { slug: 'asc' },
    });

    if (tenants.length === 0) {
        console.error(options.tenantSlug ? `\nNo tenant with slug '${options.tenantSlug}'.\n` : '\nNo tenants exist.\n');
        process.exit(1);
    }

    const rows = await prisma.constraint.findMany({
        where: { type: type.key, tenantId: { in: tenants.map((t) => t.id) } },
        select: { id: true, tenantId: true, name: true, severity: true, weight: true, isDefault: true },
    });

    const slugOf = new Map(tenants.map((t) => [t.id, t.slug]));
    // Already correct rows are counted, not skipped silently: "0 to change"
    // reads very differently from "0 rows found", and only one of them means
    // the command has nothing to do.
    const stale = rows.filter((row) => row.severity !== target.severity || row.weight !== target.weight);

    console.log(`Tenants   ${tenants.length} (${tenants.map((t) => t.slug).join(', ')})`);
    console.log(`Rows      ${rows.length} of this type, ${stale.length} to change\n`);

    for (const row of stale) {
        console.log(
            `  ${slugOf.get(row.tenantId)}: ${row.isDefault ? 'default' : `variant "${row.name}"`}`
            + ` ${row.severity}/${row.weight ?? 'null'} → ${target.severity}/${target.weight ?? 'null'}`,
        );
    }

    if (stale.length === 0) {
        console.log(rows.length === 0
            ? '\nNo rows of this type exist. Nothing to change.\n'
            : '\nEvery row already matches the catalogue. Nothing to change.\n');

        return;
    }

    if (options.dryRun) {
        console.log('\n--dry-run: nothing was written.\n');

        return;
    }

    if (!options.skipConfirm) {
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        const answer = await rl.question(`\nRewrite ${stale.length} row(s)? Type 'retype' to confirm: `);

        rl.close();

        if (answer.trim() !== 'retype') {
            console.error('\nDoes not match. Nothing was changed.\n');
            process.exit(1);
        }
    }

    const written = await prisma.constraint.updateMany({
        where: { id: { in: stale.map((row) => row.id) } },
        // BOTH fields, one statement. The CHECK pairs them, so this is not a
        // stylistic choice: either alone is refused.
        data: { severity: target.severity, weight: target.weight },
    });

    console.log(`\nRewrote ${written.count} row(s).`);
    console.log('Enabled state, names, params and scope rows were not touched.\n');

    console.log('AUDIT ' + JSON.stringify({
        ts: new Date().toISOString(),
        action: 'constraint.retyped',
        type: type.key,
        to: { severity: target.severity, weight: target.weight },
        tenants: [...new Set(stale.map((row) => slugOf.get(row.tenantId)))],
        rewritten: written.count,
        operator: `${userInfo().username}@${hostname()}`,
        via: 'cli:backfill-constraints',
    }));
}

async function main() {
    const allMissing = process.argv.includes('--all-missing');
    const retype = arg('retype');
    const tenantSlug = arg('tenant');
    const dryRun = process.argv.includes('--dry-run');
    const skipConfirm = process.argv.includes('--yes');

    if (allMissing && retype) {
        console.error(
            '\n--all-missing and --retype do different things and must not be combined.\n'
            + 'One creates absent rows; the other rewrites existing ones. Run them separately\n'
            + 'so each is audited for what it actually did.\n',
        );
        process.exit(1);
    }

    if (!allMissing && !retype) {
        console.error(
            'Missing required --all-missing or --retype <key>.\n\n'
            + '  bun run backfill:constraints -- --all-missing [--tenant <slug>] [--dry-run] [--yes]\n'
            + '  bun run backfill:constraints -- --retype <key> [--tenant <slug>] [--dry-run] [--yes]\n\n'
            + 'A flag is required rather than implied so the command cannot be run by accident.\n'
            + '`--all-missing` has deliberately no per-type selection, because a partially-seeded\n'
            + 'tenant is the exact state it repairs; `--retype` is per-type by nature.',
        );
        process.exit(1);
    }

    const url = resolveOwnerDatabaseUrl();
    const prisma = createOwnerPrisma();

    if (retype) {
        try {
            await retypeMode(prisma, url, { key: retype, tenantSlug, dryRun, skipConfirm });
        } finally {
            await prisma.$disconnect();
        }

        return;
    }

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
             * default row, and it is the default row this repairs: matching on
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
