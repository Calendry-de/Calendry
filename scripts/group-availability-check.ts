/**
 * End-to-end verification for Group availability windows.
 *
 * The same discipline as `preference-solve-check.ts`, because the same failure is
 * available: the app can store a window, the UI can show it, the solver can
 * enforce group blackouts perfectly, and every Session can still be placed
 * wherever it likes — because the window was on a Group nothing references, or
 * the rule was not enabled, or the inversion produced an empty week list.
 *
 * So this does not ask whether the solve "looks right". It picks a Group that
 * actually leads placements, narrows it to the FIRST HALF of the Term, and
 * checks three things:
 *
 *   1. the window crosses the wire as `Group.blackouts` on the right Group,
 *      with the complementary weeks — the inversion, verified against an
 *      independently computed expectation;
 *   2. with the rule off, placements land in the blocked weeks (so the instance
 *      genuinely had something to move);
 *   3. with the rule on, NO placement attached to that Group lands in a blocked
 *      week — and the ones not attached to it still do, so the rule is narrow
 *      rather than globally restrictive.
 *
 * Writes a window and a constraint row, then RESTORES both. Run against a solver
 * built from a checkout that has GroupVeto:
 *
 *   CALENDRY_SOLVER_ADDR_HOST=127.0.0.1:50052 bun run scripts/group-availability-check.ts
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { LockPolicy, RunStatus } from '@mindcollaps/calendry-proto';
import type { PlacedSession, SolverInput } from '@mindcollaps/calendry-proto';
import { resolveOwnerDatabaseUrl } from './lib/ownerDatabaseUrl';
import { assembleSolverInput } from '../server/utils/solverInput';
import { getStatus, startRun, toWireU64 } from '../server/utils/solverClient';
import { blackedOutWeeks, weekCountOf } from '../shared/academicCalendar';

const SEED = 42;
const MAX_MOVES = 2_000_000;
/** Generous, so the MOVE budget binds — a `time_budget` run is not comparable. */
const MAX_WALL_MILLIS = 180_000;
const TAG = `groupavail-${Date.now()}`;

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: resolveOwnerDatabaseUrl() }) });

const line = (text = '') => console.log(text);
const rule = (text: string) => line(`\n${'─'.repeat(78)}\n${text}\n${'─'.repeat(78)}`);

async function solve(input: SolverInput, key: string): Promise<PlacedSession[]> {
    const started = await startRun({
        input,
        scope: {
            offeringIds: input.offerings.map((offering) => offering.id),
            groupIds: [],
            outsideScopePolicy: LockPolicy.LOCK_POLICY_HARD,
        },
        budget: { maxWallMillis: toWireU64(MAX_WALL_MILLIS), maxMoves: toWireU64(MAX_MOVES) },
        seed: toWireU64(SEED),
        idempotencyKey: `${TAG}:${key}`,
    });

    const terminal = new Set([
        RunStatus.RUN_STATUS_SUCCEEDED,
        RunStatus.RUN_STATUS_CANCELLED,
        RunStatus.RUN_STATUS_FAILED,
    ]);

    for (let attempt = 0; attempt < 800; attempt++) {
        const status = await getStatus(started.runId, false);

        if (terminal.has(status.status)) {
            break;
        }

        await new Promise((resolve) => setTimeout(resolve, 250));
    }

    const final = await getStatus(started.runId, true);

    if (final.status !== RunStatus.RUN_STATUS_SUCCEEDED) {
        throw new Error(`run ${key} ended ${RunStatus[final.status]}: ${final.message}`);
    }

    line(`  ${key.padEnd(14)} ${RunStatus[final.status]}`
        + `  termination=${final.result?.stats?.terminationReason}`
        + `  placements=${final.result?.sessions.length}`
        + `  hardViolations=${final.result?.hardViolations.length}`);

    return final.result?.sessions ?? [];
}

let createdConstraintId: string | null = null;
let windowKey: { groupId: string; termId: string } | null = null;

try {
    const tenant = await prisma.tenant.findFirstOrThrow({ where: { slug: 'test' } });
    const terms = await prisma.term.findMany({
        where: { tenantId: tenant.id },
        orderBy: { startDate: 'asc' },
        include: { _count: { select: { offerings: true } } },
    });
    const term = terms.reduce((best, candidate) => (
        candidate._count.offerings > best._count.offerings ? candidate : best
    ));

    if (term._count.offerings === 0) {
        throw new Error('No Term has offerings — nothing to solve. A fixture problem, not a result.');
    }

    rule(`FIXTURE — tenant '${tenant.slug}', term '${term.name}'`);

    const totalWeeks = weekCountOf(term.startDate, term.endDate);

    line(`  term ${term.startDate.toISOString().slice(0, 10)} → ${term.endDate.toISOString().slice(0, 10)}`
        + `  (${totalWeeks} weeks)`);

    /*
     * A Group that actually appears on offerings in this Term. Picking any Group
     * would risk one nothing references, whose window would then be correctly
     * sent and correctly ignored — passing every check below while proving
     * nothing.
     */
    const candidate = await prisma.offeringGroup.findFirst({
        where: { tenantId: tenant.id, offering: { termId: term.id } },
        include: { group: true },
    });

    if (!candidate) {
        throw new Error('No offering in this Term references a Group. A fixture problem, not a result.');
    }

    const group = candidate.group;
    // First half of the Term, so roughly half the weeks are blocked.
    const midpoint = new Date(
        term.startDate.getTime() + (term.endDate.getTime() - term.startDate.getTime()) / 2,
    );

    line(`  narrowing group '${group.name}' to ${term.startDate.toISOString().slice(0, 10)}`
        + ` → ${midpoint.toISOString().slice(0, 10)}`);

    const expectedBlocked = blackedOutWeeks(term.startDate, term.endDate, {
        availableFrom: term.startDate,
        availableTo: midpoint,
    });

    line(`  expected blocked weeks (independent of assembly): [${expectedBlocked.join(', ')}]`);

    if (!expectedBlocked.length) {
        throw new Error('The chosen window blocks no week, so nothing below would be measuring the rule.');
    }

    await prisma.groupTermAvailability.create({
        data: {
            groupId: group.id,
            termId: term.id,
            tenantId: tenant.id,
            availableFrom: term.startDate,
            availableTo: midpoint,
        },
    });
    windowKey = { groupId: group.id, termId: term.id };

    const existing = await prisma.constraint.findFirst({
        where: { tenantId: tenant.id, type: 'group_veto' },
    });

    if (existing) {
        throw new Error(
            `The tenant already has a group_veto row (${existing.id}, enabled=${existing.isEnabled}). `
            + 'This script creates and removes its own; delete or rename that row first rather than '
            + 'having it silently decide the result.',
        );
    }

    const created = await prisma.constraint.create({
        data: {
            tenantId: tenant.id,
            type: 'group_veto',
            name: 'Honour group availability windows (check script)',
            severity: 'HARD',
            isEnabled: true,
        },
    });
    createdConstraintId = created.id;

    // -- Assembly ------------------------------------------------------------
    const { input, report } = await prisma.$transaction((tx) => assembleSolverInput(tx as never, {
        tenantId: tenant.id,
        termId: term.id,
        now: new Date(),
    }));

    rule('THE WIRE — did the window cross, and did the polarity flip correctly?');

    const wireGroup = input.groups.find((g) => g.id === group.id);
    const sentWeeks = wireGroup?.blackouts.flatMap((b) => b.weeks) ?? [];
    const others = input.groups.filter((g) => g.id !== group.id && g.blackouts.length);

    line(`  group present in the sent set        ${wireGroup ? 'YES ✓' : 'NO ✗ (reference-derived filter dropped it)'}`);
    line(`  blackouts sent                       [${sentWeeks.join(', ')}]`);
    line(`  matches the independent expectation  ${
        JSON.stringify(sentWeeks) === JSON.stringify(expectedBlocked) ? 'YES ✓' : 'NO ✗'}`);
    line(`  every other group left unrestricted  ${others.length === 0 ? 'YES ✓' : `NO ✗ (${others.length})`}`);
    line(`  report.windowsSent                   ${report.groupAvailability.windowsSent}`);
    line(`  report.windowsCoveringWholeTerm      ${report.groupAvailability.windowsCoveringWholeTerm}`);
    line(`  group_veto skipped                   ${
        report.skippedConstraints.some((s) => s.type === 'group_veto') ? 'YES ✗' : 'no ✓'}`);

    // -- Runs ----------------------------------------------------------------
    rule('RUNS — same instance, same seed, one constraint apart');

    const withoutRule: SolverInput = {
        ...input,
        constraints: input.constraints.filter((config) => config.groupVeto === undefined),
    };

    const off = await solve(withoutRule, 'rule-off');
    const on = await solve(input, 'rule-on');

    const blocked = new Set(expectedBlocked);
    const mine = (placements: PlacedSession[]) => placements.filter((p) => p.groupIds.includes(group.id));
    const inBlockedWeek = (placements: PlacedSession[]) => placements
        .filter((p) => p.startSlot && blocked.has(p.startSlot.week));

    const offMine = inBlockedWeek(mine(off)).length;
    const onMine = inBlockedWeek(mine(on)).length;
    const onOthers = inBlockedWeek(on.filter((p) => !p.groupIds.includes(group.id))).length;

    rule('RESULT');
    line(`  placements attached to '${group.name}'   ${mine(on).length} of ${on.length}`);
    line('');
    line(`  ... in a blocked week, rule OFF      ${offMine}`);
    line(`  ... in a blocked week, rule ON       ${onMine}`);
    line(`  the window is honoured               ${onMine === 0 ? 'YES ✓' : 'NO ✗'}`);
    line(`  the instance had something to move   ${offMine > 0 ? 'YES ✓' : 'NO ✗ (vacuous — see below)'}`);
    line('');
    // A rule that blocked those weeks for EVERYBODY would also show onMine == 0,
    // and would be a much worse bug than the one being tested for.
    line(`  other groups still use those weeks   ${onOthers > 0 ? `YES ✓ (${onOthers})` : 'no ✗'}`);

    if (!offMine) {
        line('');
        line('  ⚠ With the rule off, nothing landed in the blocked weeks anyway — so "the window');
        line('    is honoured" is not evidence. Widen the window or pick a busier term.');
    }

    line('');
} finally {
    // Restore, whatever happened above.
    if (windowKey) {
        await prisma.groupTermAvailability.deleteMany({ where: windowKey });
    }

    if (createdConstraintId) {
        await prisma.constraint.deleteMany({ where: { id: createdConstraintId } });
    }

    await prisma.$disconnect();
}
