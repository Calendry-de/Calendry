/**
 * Repairs Generation rows wrongly marked SUPERSEDED by the cross-term apply bug.
 *
 * WHY THIS EXISTS
 * ---------------
 * Until migration `20260901040000_generation_per_term`, three things about a
 * Generation were scoped to the TENANT that should have been scoped to the term:
 * its version series, the "exactly one current" unique index, and — the one that
 * corrupted data — `POST /generations/:id/apply`, which looked up
 * `{tenant_id, is_current}` with no term condition and marked whatever it found
 * SUPERSEDED.
 *
 * So applying Semester 3's proposal marked Semester 1's LIVE applied schedule as
 * superseded. On the demo tenant that left five terms' records reading
 * "discarded or superseded" that nobody had discarded. The schema fix stops it
 * happening again; it cannot know which existing rows it happened to.
 *
 * WHY A CLI AND NOT PART OF THE MIGRATION
 * ---------------------------------------
 * Because it is a judgment, and the migration has no business making it. A
 * genuinely superseded proposal and a wrongly superseded one are the same row:
 * `status = SUPERSEDED`, `applied_at` set, `is_current = false`. The only thing
 * that distinguishes them is whether a LATER Generation in the SAME TERM took
 * over — which is a rule this script states explicitly, prints per row, and
 * lets an operator refuse.
 *
 * The migration's backfill of `term_id` is different in kind: there is exactly
 * one right answer (the run's term) and no judgment in it, so it belongs there.
 *
 * WHAT IT CHANGES, AND THE RULE IT USES
 * ------------------------------------
 * A row is repaired only when ALL of these hold:
 *
 *   - `status = 'SUPERSEDED'` and `applied_at IS NOT NULL` — it was really
 *     applied once, so it is a former live schedule rather than a proposal
 *     somebody discarded before applying. A discard sets SUPERSEDED too
 *     (`discard.post.ts`) but never sets `applied_at`, which is what keeps this
 *     from resurrecting deliberately discarded proposals.
 *   - it has a `term_id`. A tenant-wide baseline (`term_id IS NULL`) WAS also
 *     superseded by this bug — the demo tenant's MANUAL_BASELINE v1 sits at
 *     SUPERSEDED because the first solver apply found it as "the tenant's
 *     current" and took the flag — but it is deliberately left alone anyway.
 *     Under the new invariant a tenant-wide baseline MAY be current alongside
 *     per-term schedules, so reviving it is possible; whether it SHOULD be is a
 *     product question (is a starting snapshot still "live" once every term has
 *     a real applied schedule?), and this script exists precisely to avoid
 *     answering that kind of question on an operator's behalf. Revive one by
 *     hand if you decide it should be.
 *   - NO other Generation in the same term has a LATER `applied_at`. If one
 *     does, this row was superseded correctly, by its own term's next schedule.
 *
 * Rows meeting all three are set back to `status = 'APPLIED'`, `is_current =
 * true`. One per term at most, by construction: the rule selects the latest
 * applied row in each term, and the new partial unique index would reject a
 * second.
 *
 * Deliberately NOT repaired: a term whose only applied row is already APPLIED
 * but `is_current = false` (the flag was cleared without the status changing).
 * That combination is not what this bug produced, and inventing a rule for it
 * would be repairing a state nobody has observed.
 *
 * USAGE
 * -----
 *   bun run repair:generation-status -- --dry-run
 *   bun run repair:generation-status -- --tenant demo --dry-run
 *   bun run repair:generation-status -- --yes
 */
import { createInterface } from 'node:readline/promises';
import { hostname, userInfo } from 'node:os';
import { describeTarget, resolveOwnerDatabaseUrl } from './lib/ownerDatabaseUrl';
import { arg, createOwnerPrisma } from './lib/cli';

interface Candidate {
    id: string;
    tenantSlug: string;
    termName: string;
    version: number;
    appliedAt: Date;
}

async function main() {
    const dryRun = process.argv.includes('--dry-run');
    const skipConfirm = process.argv.includes('--yes');
    const tenantSlug = arg('tenant');

    const url = resolveOwnerDatabaseUrl();
    const prisma = createOwnerPrisma();

    try {
        console.log(`Inspecting ${describeTarget(url)}...`);

        const applied = await prisma.generation.findMany({
            where: {
                appliedAt: { not: null },
                termId: { not: null },
                ...(tenantSlug ? { tenant: { slug: tenantSlug } } : {}),
            },
            select: {
                id: true,
                version: true,
                status: true,
                isCurrent: true,
                appliedAt: true,
                termId: true,
                tenant: { select: { slug: true } },
                term: { select: { name: true } },
            },
            orderBy: { appliedAt: 'desc' },
        });

        if (tenantSlug && applied.length === 0) {
            const exists = await prisma.tenant.findFirst({ where: { slug: tenantSlug }, select: { id: true } });

            if (!exists) {
                console.error(`\nNo tenant with slug '${tenantSlug}'.\n`);
                process.exit(1);
            }
        }

        /*
         * The latest applied row per term. `applied` is already sorted newest
         * first, so the first row seen for a term is that term's winner — and
         * every later row in the same term is a correct supersede.
         */
        const winnerByTerm = new Map<string, typeof applied[number]>();

        for (const row of applied) {
            if (row.termId && !winnerByTerm.has(row.termId)) {
                winnerByTerm.set(row.termId, row);
            }
        }

        const candidates: Candidate[] = [];

        for (const row of winnerByTerm.values()) {
            if (row.status !== 'SUPERSEDED' || !row.appliedAt) {
                continue;
            }

            candidates.push({
                id: row.id,
                tenantSlug: row.tenant.slug,
                termName: row.term?.name ?? '(term deleted)',
                version: row.version,
                appliedAt: row.appliedAt,
            });
        }

        if (candidates.length === 0) {
            console.log('\nNothing to repair: no term has a latest-applied Generation left marked SUPERSEDED.\n');

            return;
        }

        console.log(`\n${candidates.length} Generation row(s) look wrongly superseded:\n`);

        for (const row of candidates) {
            console.log(
                `  ${row.tenantSlug}  ${row.termName}  v${row.version}`
                + `  applied ${row.appliedAt.toISOString()}  SUPERSEDED -> APPLIED + current`,
            );
        }

        if (dryRun) {
            console.log('\n--dry-run: nothing written.\n');

            return;
        }

        if (!skipConfirm) {
            const rl = createInterface({ input: process.stdin, output: process.stdout });
            const answer = await rl.question(
                `\nWrite these ${candidates.length} change(s) to ${describeTarget(url)}`
                + ` as ${userInfo().username}@${hostname()}? [y/N] `,
            );

            rl.close();

            if (answer.trim().toLowerCase() !== 'y') {
                console.log('Aborted; nothing written.\n');

                return;
            }
        }

        /*
         * One transaction, so a partial repair cannot leave two terms disagreeing
         * about which of them holds the tenant's single current flag — the state
         * the old index permitted and the new one forbids.
         */
        await prisma.$transaction(candidates.map((row) => prisma.generation.update({
            where: { id: row.id },
            data: { status: 'APPLIED', isCurrent: true },
        })));

        console.log(`\nRepaired ${candidates.length} row(s).\n`);
    } finally {
        await prisma.$disconnect();
    }
}

await main();
