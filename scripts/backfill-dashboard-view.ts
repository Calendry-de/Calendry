/**
 * Backfills `dashboard.view` onto every EXISTING AccessRole, in every
 * EXISTING tenant, whose permission SHAPE is not exactly `member`'s
 * (issue #107).
 *
 * WHY A SEPARATE SCRIPT FROM `grant-permissions.ts`
 * --------------------------------------------------
 * `grant-permissions.ts` matches by ROLE KEY: `--role tenant-admin` grants to
 * every AccessRole named `tenant-admin`, across every tenant. This backfill
 * cannot use that shape at all — it has no role key to match on. `dashboard.view`
 * must reach EVERY AccessRole that is not the schedule-only default, whatever a
 * tenant happened to name it: `tenant-admin`, `lecturer`, a tenant's own
 * hand-composed `department-head`, all of them. The one shape it must NOT reach
 * is an AccessRole holding EXACTLY `{session.read_own}` and nothing else — the
 * seeded `member` role, or any tenant's own copy of that same idea — because
 * that shape is precisely what should keep routing to `/schedule` instead of
 * `/dashboard`. That is a PERMISSION-SHAPE rule, not a role-key rule, and
 * `grant-permissions.ts`'s `--role` flag has nowhere to express it.
 *
 * WHY THIS IS THE DANGEROUS DIRECTION
 * ------------------------------------
 * `/dashboard` had NO permission check before `dashboard.view` existed —
 * every signed-in Person could reach it. The moment the app starts gating on
 * this key, every AccessRole that doesn't explicitly hold it loses dashboard
 * access, not just the new `student`/`parent`-flavoured ones this issue adds.
 * Skipping this backfill, or running it after the gate ships instead of in the
 * same deploy, means every existing lecturer and admin in every existing
 * tenant is locked out of a page they use today. See CLAUDE.md's "A new
 * permission" and "A permission that MOVES" rules — this is closer to the
 * second, despite being a brand new key, because the risk is identical: a
 * capability everyone silently had is about to require a grant nobody has yet.
 *
 * WHY THE OWNER CONNECTION, WHY A CLI
 * -------------------------------------
 * Same reasoning as `grant-permissions.ts` in full: this writes
 * `access_role_permission`, tenant-scoped RLS included, across every tenant in
 * one run, and a script that can WIDEN authority must not be reachable from the
 * running application.
 *
 *   bun run backfill:dashboard-view -- --dry-run
 *   bun run backfill:dashboard-view -- --tenant test --dry-run
 *   bun run backfill:dashboard-view                      # real run, prompts to confirm
 *   bun run backfill:dashboard-view -- --yes             # real run, no prompt
 */
import { hostname, userInfo } from 'node:os';
import { resolveOwnerDatabaseUrl } from './lib/ownerDatabaseUrl';
import {
    arg, confirmOrExit, createOwnerPrisma, formatUnreachableDatabaseError, isUnreachableDatabaseError,
} from './lib/cli';

const DASHBOARD_VIEW = 'dashboard.view';

interface RolePlan {
    tenantSlug: string;
    tenantId: string;
    accessRoleId: string;
    accessRoleKey: string;
    accessRoleName: string;
    /** `true` when this role's held set is EXACTLY `{session.read_own}`. */
    memberShaped: boolean;
    alreadyHeld: boolean;
    heldCount: number;
}

async function main() {
    const tenantSlug = arg('tenant');
    const dryRun = process.argv.includes('--dry-run');
    const skipConfirm = process.argv.includes('--yes');

    const connectionString = resolveOwnerDatabaseUrl();
    const prisma = createOwnerPrisma();

    try {
        // The catalogue must already carry the key, or the FK below fails —
        // same guard `grant-permissions.ts` runs, for the same reason.
        const seeded = await prisma.permission.findUnique({ where: { key: DASHBOARD_VIEW } });

        if (!seeded) {
            console.error(`\n'${DASHBOARD_VIEW}' is in the code (shared/permissions.ts) but not in the database.`);
            console.error('Run `bun run db-seed` first — the catalogue is seeded, not migrated.\n');
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
                memberShaped: held.size === 1 && held.has('session.read_own'),
                alreadyHeld: held.has(DASHBOARD_VIEW),
                heldCount: held.size,
            };
        });

        const toGrant = planned.filter((p) => !p.memberShaped && !p.alreadyHeld);
        const skippedMemberShaped = planned.filter((p) => p.memberShaped);
        const alreadyHad = planned.filter((p) => p.alreadyHeld && !p.memberShaped);

        console.log(`\nPermission ${DASHBOARD_VIEW}`);
        console.log(`Tenants    ${new Set(planned.map((p) => p.tenantSlug)).size}`);
        console.log(`Roles seen ${planned.length}`);
        console.log(`To grant   ${toGrant.length}`);
        console.log(`Already OK ${alreadyHad.length}`);
        console.log(`Skipped    ${skippedMemberShaped.length} (session.read_own-only — must stay schedule-only)\n`);

        for (const plan of planned) {
            const label = `${plan.tenantSlug} / ${plan.accessRoleKey} (${plan.accessRoleName})`;

            if (plan.memberShaped) {
                console.log(`  SKIP    ${label} — exactly {session.read_own}`);
            } else if (plan.alreadyHeld) {
                console.log(`  OK      ${label} — already holds it`);
            } else {
                console.log(`  +GRANT  ${label} — held ${plan.heldCount} other permission(s)`);
            }
        }

        if (toGrant.length === 0) {
            console.log('\nNothing to grant. Every non-schedule-only role already holds it.\n');

            return;
        }

        if (dryRun) {
            console.log('\n--dry-run: nothing was written.\n');

            return;
        }

        if (!skipConfirm) {
            await confirmOrExit(
                `\nGrant ${DASHBOARD_VIEW} to ${toGrant.length} AccessRole(s)? Type "yes" to confirm: `,
                'yes',
                { caseInsensitive: true },
            );
        }

        // One transaction across every tenant — a partial backfill leaves
        // some tenants able to reach /dashboard and others locked out of it,
        // which is harder to diagnose than a clean failure. Same reasoning as
        // `grant-permissions.ts`.
        const written = await prisma.$transaction(async (tx) => {
            const result = await tx.accessRolePermission.createMany({
                data: toGrant.map((plan) => ({
                    accessRoleId: plan.accessRoleId,
                    permissionKey: DASHBOARD_VIEW,
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
            permission: DASHBOARD_VIEW,
            tenants: [...new Set(toGrant.map((p) => p.tenantSlug))],
            roles: toGrant.map((p) => `${p.tenantSlug}/${p.accessRoleKey}`),
            granted: written,
            operator: `${userInfo().username}@${hostname()}`,
            via: 'cli:backfill-dashboard-view',
        };

        console.log(`\nGranted ${DASHBOARD_VIEW} to ${written} AccessRole(s).`);
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
