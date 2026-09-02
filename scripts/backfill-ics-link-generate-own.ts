/**
 * Backfills `ics_link.generate_own` onto every EXISTING AccessRole, in every
 * EXISTING tenant, that already holds `session.read` or `session.read_own`
 * (issue #115).
 *
 * WHY THIS SHAPE, NOT `grant-permissions.ts`
 * -------------------------------------------
 * `grant-permissions.ts --role <key>` matches by ROLE KEY, one at a time
 * across tenants. This permission needs to reach whatever a tenant happened
 * to NAME the role that can already see a schedule (`tenant-admin`,
 * `lecturer`, `member`, a hand-composed `department-head`), which is a
 * PERMISSION-SHAPE question, the same reason `backfill-dashboard-view.ts`
 * exists instead of using `--role`.
 *
 * WHY `session.read` OR `session.read_own`, SPECIFICALLY
 * ---------------------------------------------------------
 * Before issue #115, `POST /api/me/ics-links` had NO permission check at
 * all: literally any signed-in Person could mint a link, and it streamed
 * their own Sessions (possibly an empty feed, if they held neither read
 * key). Granting `generate_own` to every role that already holds
 * `session.read`/`session.read_own` reaches every role for which the
 * capability was ever MEANINGFUL: a role holding neither could never have
 * produced a non-empty feed anyway, so this is a non-regression backfill,
 * not a widening one, despite the direction looking the same as
 * `dashboard.view`'s. `ics_link.generate` (the wider key, letting a link
 * target Groups) is a brand-new capability with no prior equivalent and
 * follows the ordinary `grant:permissions --role tenant-admin --all-missing`
 * path instead; see that permission's own comment in shared/permissions.ts.
 *
 * WHY THE OWNER CONNECTION, WHY A CLI
 * -------------------------------------
 * Same reasoning as `backfill-dashboard-view.ts` in full: this writes
 * `access_role_permission` across every tenant in one run, and a script that
 * can WIDEN authority must not be reachable from the running application.
 *
 *   bun run backfill:ics-link-generate-own -- --dry-run
 *   bun run backfill:ics-link-generate-own -- --tenant test --dry-run
 *   bun run backfill:ics-link-generate-own                      # real run, prompts to confirm
 *   bun run backfill:ics-link-generate-own -- --yes             # real run, no prompt
 */
import { hostname, userInfo } from 'node:os';
import { resolveOwnerDatabaseUrl } from './lib/ownerDatabaseUrl';
import {
    arg, confirmOrExit, createOwnerPrisma, formatUnreachableDatabaseError, isUnreachableDatabaseError,
} from './lib/cli';

const GENERATE_OWN = 'ics_link.generate_own';
const TRIGGERS = ['session.read', 'session.read_own'];

interface RolePlan {
    tenantSlug: string;
    tenantId: string;
    accessRoleId: string;
    accessRoleKey: string;
    accessRoleName: string;
    eligible: boolean;
    alreadyHeld: boolean;
}

async function main() {
    const tenantSlug = arg('tenant');
    const dryRun = process.argv.includes('--dry-run');
    const skipConfirm = process.argv.includes('--yes');

    const connectionString = resolveOwnerDatabaseUrl();
    const prisma = createOwnerPrisma();

    try {
        // The catalogue must already carry the key, or the FK below fails:
        // same guard `grant-permissions.ts` runs, for the same reason.
        const seeded = await prisma.permission.findUnique({ where: { key: GENERATE_OWN } });

        if (!seeded) {
            console.error(`\n'${GENERATE_OWN}' is in the code (shared/permissions.ts) but not in the database.`);
            console.error('Run `bun run db-seed` first: the catalogue is seeded, not migrated.\n');
            process.exit(1);
        }

        const roles = await prisma.accessRole.findMany({
            where: tenantSlug ? { tenant: { slug: tenantSlug } } : undefined,
            select: {
                id: true,
                key: true,
                name: true,
                tenantId: true,
                tenant: { select: { slug: true } },
                permissions: { select: { permissionKey: true } },
            },
            orderBy: [{ tenant: { slug: 'asc' } }, { key: 'asc' }],
        });

        if (roles.length === 0) {
            console.error(
                `\nNo AccessRole found${tenantSlug ? ` in tenant '${tenantSlug}'` : ' in any tenant'}.\n`,
            );
            process.exit(1);
        }

        const planned: RolePlan[] = roles.map((role) => {
            const held = new Set(role.permissions.map((p) => p.permissionKey));

            return {
                tenantSlug: role.tenant.slug,
                tenantId: role.tenantId,
                accessRoleId: role.id,
                accessRoleKey: role.key,
                accessRoleName: role.name,
                eligible: TRIGGERS.some((key) => held.has(key)),
                alreadyHeld: held.has(GENERATE_OWN),
            };
        });

        const toGrant = planned.filter((p) => p.eligible && !p.alreadyHeld);
        const skippedIneligible = planned.filter((p) => !p.eligible);
        const alreadyHad = planned.filter((p) => p.alreadyHeld && p.eligible);

        console.log(`\nPermission ${GENERATE_OWN}`);
        console.log(`Tenants    ${new Set(planned.map((p) => p.tenantSlug)).size}`);
        console.log(`Roles seen ${planned.length}`);
        console.log(`To grant   ${toGrant.length}`);
        console.log(`Already OK ${alreadyHad.length}`);
        console.log(`Skipped    ${skippedIneligible.length} (holds neither session.read nor session.read_own)\n`);

        for (const plan of planned) {
            const label = `${plan.tenantSlug} / ${plan.accessRoleKey} (${plan.accessRoleName})`;

            if (!plan.eligible) {
                console.log(`  SKIP    ${label}: no schedule visibility`);
            } else if (plan.alreadyHeld) {
                console.log(`  OK      ${label}: already holds it`);
            } else {
                console.log(`  +GRANT  ${label}`);
            }
        }

        if (toGrant.length === 0) {
            console.log('\nNothing to grant. Every eligible role already holds it.\n');

            return;
        }

        if (dryRun) {
            console.log('\n--dry-run: nothing was written.\n');

            return;
        }

        if (!skipConfirm) {
            await confirmOrExit(
                `\nGrant ${GENERATE_OWN} to ${toGrant.length} AccessRole(s)? Type "yes" to confirm: `,
                'yes',
                { caseInsensitive: true },
            );
        }

        // One transaction across every tenant: a partial backfill leaves
        // some tenants able to self-serve a calendar link and others locked
        // out of a capability they had unconditionally a moment ago, which
        // is harder to diagnose than a clean failure. Same reasoning as
        // `backfill-dashboard-view.ts`.
        const written = await prisma.$transaction(async (tx) => {
            const result = await tx.accessRolePermission.createMany({
                data: toGrant.map((plan) => ({
                    accessRoleId: plan.accessRoleId,
                    permissionKey: GENERATE_OWN,
                    tenantId: plan.tenantId,
                })),
                // Belt and braces against a concurrent run.
                skipDuplicates: true,
            });

            return result.count;
        });

        const record = {
            ts: new Date().toISOString(),
            action: 'access_role.permissions_granted',
            permission: GENERATE_OWN,
            tenants: [...new Set(toGrant.map((p) => p.tenantSlug))],
            roles: toGrant.map((p) => `${p.tenantSlug}/${p.accessRoleKey}`),
            granted: written,
            operator: `${userInfo().username}@${hostname()}`,
            via: 'cli:backfill-ics-link-generate-own',
        };

        console.log(`\nGranted ${GENERATE_OWN} to ${written} AccessRole(s).`);
        console.log('Sessions are NOT revoked: permissions are read per request, so');
        console.log('signed-in users pick this up on their next call.\n');

        console.log(`AUDIT ${JSON.stringify(record)}`);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        if (isUnreachableDatabaseError(message)) {
            console.error(formatUnreachableDatabaseError(connectionString));
        } else {
            console.error(`\nBackfill failed, nothing was changed: ${message}\n`);
        }

        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

await main();
