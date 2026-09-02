/**
 * Disables enabled Constraint rows whose configured params cannot be sent to
 * the solver at all, per `ConstraintTypeDef.unsendableWhen`.
 *
 * WHY THIS EXISTS
 * ---------------
 * `minimize_block_usage` shipped `defaultEnabled: true` with no default block
 * selection. Every tenant provisioned before that catalogue fix (see
 * `shared/constraintTypes.ts` and `server/utils/provisionTenant.ts`'s
 * boot-time assertion, both of which now catch this for NEW tenants) holds a
 * `minimize_block_usage` row that is enabled, has `params: {}`, and rejects
 * every solver run it is part of with `INVALID_ARGUMENT`, 68ms after the run
 * is created. `GET /api/solver/preflight` and `POST /api/solver/runs` catch
 * this live now, but a tenant provisioned before this repair still has the
 * broken row sitting there, blocking every generate-schedule click with no
 * further explanation than the pre-flight message until someone fixes it.
 *
 * WHAT IT CHANGES, AND THE RULE IT USES
 * --------------------------------------
 * Scans every ENABLED Constraint row, of ANY type (not `minimize_block_usage`
 * specifically): `unsendableWhen` is a general mechanism and this repairs
 * whatever it flags, so a future type that ships the same shape of bug is
 * covered by the same script rather than needing a new one written by hand.
 * A flagged row is set `isEnabled: false`. NOTHING ELSE is touched: not its
 * name, its weight, or its params, so re-enabling it (once configured) is a
 * single flip in the constraint builder, not a re-creation.
 *
 * This is a REPAIR, not a `--retype`: it does not change what the row MEANS
 * (its type, its severity), only whether it currently fires with nothing to
 * fire on.
 *
 * USAGE
 * -----
 *   bun run repair:unsendable-constraints -- --dry-run
 *   bun run repair:unsendable-constraints -- --tenant demo --dry-run
 *   bun run repair:unsendable-constraints -- --yes
 */
import { hostname, userInfo } from 'node:os';
import { validateConstraint } from '../shared/constraintTypes';
import { describeTarget, resolveOwnerDatabaseUrl } from './lib/ownerDatabaseUrl';
import { arg, confirmOrExit, createOwnerPrisma } from './lib/cli';

async function main() {
    const dryRun = process.argv.includes('--dry-run');
    const skipConfirm = process.argv.includes('--yes');
    const tenantSlug = arg('tenant');

    const url = resolveOwnerDatabaseUrl();
    const prisma = createOwnerPrisma();

    try {
        console.log(`Inspecting ${describeTarget(url)}...`);

        const rows = await prisma.constraint.findMany({
            where: {
                isEnabled: true,
                ...(tenantSlug ? { tenant: { slug: tenantSlug } } : {}),
            },
            select: {
                id: true, name: true, type: true, severity: true, params: true,
                tenant: { select: { slug: true } },
            },
        });

        if (tenantSlug && rows.length === 0) {
            const exists = await prisma.tenant.findFirst({ where: { slug: tenantSlug }, select: { id: true } });

            if (!exists) {
                console.error(`\nNo tenant with slug '${tenantSlug}'.\n`);
                process.exit(1);
            }
        }

        const candidates = rows
            .map((row) => ({ row, issues: validateConstraint(row) }))
            .filter(({ issues }) => issues.length > 0);

        if (candidates.length === 0) {
            console.log('\nNothing to repair: every enabled constraint can be sent to the solver as configured.\n');

            return;
        }

        console.log(`\n${candidates.length} enabled constraint row(s) cannot be sent to the solver:\n`);

        for (const { row, issues } of candidates) {
            console.log(`  ${row.tenant.slug}  ${row.type}  "${row.name}"`);

            for (const issue of issues) {
                console.log(`      [${issue.code}] ${issue.message}`);
            }
        }

        if (dryRun) {
            console.log('\n--dry-run: nothing written.\n');

            return;
        }

        if (!skipConfirm) {
            await confirmOrExit(
                `\nDisable these ${candidates.length} row(s) on ${describeTarget(url)} `
                + `as ${userInfo().username}@${hostname()}? Type 'repair' to confirm: `,
                'repair',
            );
        }

        const written = await prisma.constraint.updateMany({
            where: { id: { in: candidates.map(({ row }) => row.id) } },
            data: { isEnabled: false },
        });

        console.log(`\nDisabled ${written.count} row(s). Names, weights and params were not touched.\n`);

        console.log('AUDIT ' + JSON.stringify({
            ts: new Date().toISOString(),
            action: 'constraint.unsendable_disabled',
            rows: candidates.map(({ row, issues }) => ({
                tenant: row.tenant.slug, type: row.type, id: row.id, codes: issues.map((i) => i.code),
            })),
            operator: `${userInfo().username}@${hostname()}`,
            via: 'cli:repair-unsendable-constraints',
        }));
    } finally {
        await prisma.$disconnect();
    }
}

await main();
