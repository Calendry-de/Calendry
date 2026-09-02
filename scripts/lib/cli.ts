/**
 * Shared plumbing for the operator CLIs under `scripts/`.
 *
 * Every script here independently redefined `arg()`, most constructed the
 * exact same owner-connected `PrismaClient`, nine independently duplicated
 * the same "could not reach the database" detection and message, and two
 * independently implemented the same type-to-confirm readline prompt. None
 * of that was a designed difference: it was N copies of the same few lines,
 * found by grepping for one of the error strings and discovering it in nine
 * files. This module is the one copy.
 *
 * Pure extraction: every export here is byte-for-byte what the scripts
 * already did inline, kept working exactly as before. Nothing was
 * "improved" while moving it; see the callers for what genuinely differs
 * between scripts, which is documented at each export below rather than
 * papered over.
 */
import { createInterface } from 'node:readline/promises';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { describeTarget, resolveOwnerDatabaseUrl } from './ownerDatabaseUrl';

/** Reads `--<name> <value>` out of `process.argv`, or `undefined` if absent. */
export function arg(name: string): string | undefined {
    const index = process.argv.indexOf(`--${name}`);

    return index === -1 ? undefined : process.argv[index + 1];
}

/**
 * Reads every occurrence of a repeatable `--<name> <value>` flag, in the
 * order given. `provision-federation.ts` had this under the name `args()`
 * (its `--attach-tenant`/`--detach-tenant` can each be repeated), same
 * behavior, renamed only because `args` shadows too easily.
 */
export function multiArg(name: string): string[] {
    const values: string[] = [];

    for (let i = 0; i < process.argv.length; i += 1) {
        if (process.argv[i] === `--${name}` && process.argv[i + 1]) {
            values.push(process.argv[i + 1]);
        }
    }

    return values;
}

/**
 * The owner-connected `PrismaClient` every provisioning/backfill/repair/
 * check script needs; see `resolveOwnerDatabaseUrl()`'s own comment for why
 * the owner role specifically (RLS is unsatisfiable before a row exists, or
 * a backfill has to cross tenants in one transaction).
 *
 * NOT used by `reset-password.ts`: that script's connection is genuinely
 * conditional: the owner only for `--create` (which reads `person`, behind
 * RLS), the ordinary runtime role for every other reset (see that script's
 * own "WHY THE APP ROLE, NOT THE OWNER" header), so routing it through an
 * always-owner helper would silently widen its normal-path credential,
 * which is exactly the escalation CLAUDE.md's Accounts section warns
 * against. That script keeps its own conditional construction.
 */
export function createOwnerPrisma(): PrismaClient {
    return new PrismaClient({ adapter: new PrismaPg({ connectionString: resolveOwnerDatabaseUrl() }) });
}

/**
 * True when a database error's message indicates the SERVER was unreachable
 * (down, wrong host, wrong port) rather than a rejected query: the same
 * regex nine scripts independently ran against `error.message`.
 */
export function isUnreachableDatabaseError(message: string): boolean {
    return /Unable to start a transaction|Can't reach database server|ECONNREFUSED|ENOTFOUND/i.test(message);
}

/**
 * The SHORT "Running? / Reachable from here?" unreachable-database message:
 * byte-identical across `create-account.ts`, `create-role.ts`,
 * `grant-permissions.ts`, `list-tenants.ts` and `backfill-dashboard-view.ts`,
 * parameterized only by which env var the "reachable from here" line names.
 * Every one of those five always names `MIGRATION_DATABASE_URL_HOST` (the
 * default here); `reset-password.ts` is the one caller that picks between
 * it and `DATABASE_URL_HOST` depending on which connection its `--create`
 * flag chose, so it passes the env var name explicitly.
 *
 * `provision-tenant.ts`, `provision-federation.ts` and `provision-staff.ts`
 * print a LONGER, differently-worded block of their own (an "Is it
 * running?" phrasing, a shell-resolvability check, and a trailing "Nothing
 * was written. Underlying error: …" line) and are deliberately NOT routed
 * through this helper: the bodies are not the same text, and forcing them
 * through one template would change what they print. They still use
 * `isUnreachableDatabaseError()` above for the detection itself.
 */
export function formatUnreachableDatabaseError(
    connectionString: string,
    envVarName: string = 'MIGRATION_DATABASE_URL_HOST',
): string {
    return `\nCould not reach the database at ${describeTarget(connectionString)}.\n`
        + '  - Running?  docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d db\n'
        + `  - Reachable from here? See ${envVarName} in .env.example.\n`;
}

/**
 * Prompts for typed confirmation and `process.exit(1)`s with "Does not
 * match. Nothing was changed." on anything else: the readline pattern
 * `grant-permissions.ts` (expects the role key, case-sensitive) and
 * `backfill-dashboard-view.ts` (expects the literal "yes", case-insensitive)
 * both already had. Only these two scripts print exactly this "Nothing was
 * changed" wording on a mismatch; other confirm prompts elsewhere in
 * scripts/ use different wording ("Nothing was created", a plain [y/N], a
 * non-exiting abort) and are deliberately left as they are rather than bent
 * to fit this one message.
 */
export async function confirmOrExit(
    prompt: string,
    expected: string,
    options?: { caseInsensitive?: boolean },
): Promise<void> {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(prompt);

    rl.close();

    const matches = options?.caseInsensitive
        ? answer.trim().toLowerCase() === expected.toLowerCase()
        : answer.trim() === expected;

    if (!matches) {
        console.error('\nDoes not match. Nothing was changed.\n');
        process.exit(1);
    }
}
