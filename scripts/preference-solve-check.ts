/**
 * Stage 6 verification — proves `person_preference_fit` FIRES end to end.
 *
 * Stage 5 (`calendry-solver` 41f6227) added the evaluator and this repo flipped
 * `wireField` in the same change. What neither of those proves is that the two
 * halves meet: the app can assemble a perfect `SolverInput`, the solver can
 * price preferences perfectly, and the rule can still contribute nothing because
 * the constraint was skipped, the persons carried no `preferred`, or every
 * lecturer with a preference happened to lecture on nothing.
 *
 * That is the `lecturer_veto` shape, and the design record names it as the one
 * failure this feature must not repeat: a rule that is enabled, weighted,
 * rendered as active, and inert. So this script does not ask the solver whether
 * it honoured the preferences. It runs the SAME instance twice — once with the
 * constraint stripped from the assembled input, once as assembled — and scores
 * both placements against an INDEPENDENT re-implementation of the cost rule.
 *
 * Three things have to hold, and only the second is about the solver being good:
 *
 *   1. the constraint is SENT (not in `skippedConstraints`), and at least one
 *      lecturer on a real offering carries a `preferred` — otherwise the run
 *      below would agree with itself and the check would pass while proving
 *      nothing;
 *   2. the unmet cost under the rule is LOWER than without it;
 *   3. the same input and seed give byte-identical placements, so (2) is the
 *      rule working rather than the search wandering.
 *
 * The oracle deliberately does NOT import anything from the solver. It restates
 * ADR-0026's rule from the prose — mean over a placement's counted lecturers of
 * `clamp(multiplier) × unmet`, where `unmet` is the fraction of a person's
 * STATED axes the slot misses — because an oracle that shares code with the
 * thing it checks agrees with it by construction.
 *
 * Nothing is written to the database. The "rule off" run is produced by removing
 * one `ConstraintConfig` from the in-memory input, which is what a tenant with
 * the rule disabled would have assembled.
 *
 * KEPT, not throwaway like the stage 3 check scripts. It cannot live in the test
 * suite — it needs a running solver and a tenant with real preference data — but
 * it is the only thing that would notice the feature going quietly inert again,
 * which is the failure this whole design was shaped around.
 *
 *   bun run scripts/preference-solve-check.ts
 *
 * That talks to the compose solver on 50051. Point it somewhere else when
 * checking a solver you built yourself, which is how stage 6 was verified — the
 * published image and the submodule can disagree:
 *
 *   CALENDRY_SOLVER_ADDR_HOST=127.0.0.1:50052 bun run scripts/preference-solve-check.ts
 */
import { LockPolicy, RunStatus } from '@calendry-de/calendry-proto';
import type { PlacedSession, SolverInput } from '@calendry-de/calendry-proto';
import { createOwnerPrisma } from './lib/cli';
import { assembleSolverInput } from '../server/utils/solverInput';
import { getStatus, startRun, toWireU64 } from '../server/utils/solverClient';

const SEED = 42;
const MAX_MOVES = 2_000_000;
/*
 * GENEROUS ON PURPOSE, so the MOVE budget is the binding one. A run that
 * terminates on `time_budget` is explicitly not reproducible (CLAUDE.md §
 * "Determinism"), and a starved run is worse than useless here: the first
 * version of this script used 25s, three of four runs stopped on
 * `time_budget`, and the search had made so little progress that the rule-on and
 * rule-off placements came back IDENTICAL — which reads exactly like a rule that
 * does not fire. Check `termination` in the output; anything but `move_budget`
 * invalidates the comparison rather than failing it.
 */
const MAX_WALL_MILLIS = 180_000;
/**
 * Fresh idempotency keys per invocation. The solver's run registry is in-memory
 * and keyed by whatever is passed here, so a stable key would replay the first
 * invocation's answers on every later one — including after a code change, which
 * is the one moment a stale result is most convincing.
 */
const TAG = `pref-${Date.now()}`;
/** Matches the `[0.5, 2.0]` clamp the write boundary and the solver both apply. */
const CLAMP_MIN = 0.5;
const CLAMP_MAX = 2.0;

const prisma = createOwnerPrisma();

const line = (text = '') => console.log(text);
const rule = (text: string) => line(`\n${'─'.repeat(78)}\n${text}\n${'─'.repeat(78)}`);

interface Stated {
    days: number[];
    blocks: number[];
    multiplier: number;
}

/**
 * The cost rule restated from ADR-0026, independently of the solver.
 *
 * `unmet` is the fraction of the axes a person actually STATED that this slot
 * misses — the two axes are additive and earn credit independently, so a person
 * who stated both and gets one right is half-satisfied. A person who stated
 * nothing is not counted at all, which is different from being counted at zero:
 * they must not dilute the mean of the people who did state something.
 */
function unmetFor(stated: Stated, day: number, block: number): number {
    const axes: boolean[] = [];

    if (stated.days.length) {
        axes.push(stated.days.includes(day));
    }

    if (stated.blocks.length) {
        axes.push(stated.blocks.includes(block));
    }

    if (!axes.length) {
        return 0;
    }

    return axes.filter((met) => !met).length / axes.length;
}

/** Mean over the placement's counted lecturers of `multiplier × unmet`. */
function costOf(placements: PlacedSession[], stated: Map<string, Stated>): { cost: number; counted: number } {
    let cost = 0;
    let counted = 0;

    for (const placed of placements) {
        const slot = placed.startSlot;

        if (!slot) {
            continue;
        }

        const withPreference = placed.lecturerIds.filter((id) => stated.has(id));

        if (!withPreference.length) {
            continue;
        }

        counted += 1;

        const sum = withPreference.reduce((total, id) => {
            const person = stated.get(id)!;

            return total + person.multiplier * unmetFor(person, slot.day, slot.block);
        }, 0);

        cost += sum / withPreference.length;
    }

    return { cost, counted };
}

/** A comparable fingerprint of a placement set, order-independent. */
function fingerprint(placements: PlacedSession[]): string {
    return placements
        .map((p) => `${p.offeringId}@${p.startSlot?.week}/${p.startSlot?.day}/${p.startSlot?.block}#${p.roomId}`)
        .sort()
        .join('|');
}

interface Solved {
    placements: PlacedSession[];
    /** The `person_preference_fit` component, or null if the run carried none. */
    component: { weighted: number; rawCount: string } | null;
}

async function solve(input: SolverInput, key: string): Promise<Solved> {
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

    for (let attempt = 0; attempt < 400; attempt++) {
        const status = await getStatus(started.runId, false);

        if (terminal.has(status.status)) {
            break;
        }

        await new Promise((resolve) => setTimeout(resolve, 250));
    }

    const final = await getStatus(started.runId, true);

    if (final.status !== RunStatus.RUN_STATUS_SUCCEEDED) {
        throw new Error(`run ${key} ended ${RunStatus[final.status]}, not SUCCEEDED`);
    }

    /*
     * THE COMPONENT, not just the total, and the reason is a false negative this
     * check nearly reported as a proof. The first run of this script produced an
     * objective of 118.5 with the rule off AND on — identical, which reads like
     * the term was never added. It was not: the search had driven the preference
     * cost to exactly 0, and the remaining soft terms were unmoved by placements
     * that only changed day. A total cannot distinguish "term absent" from "term
     * satisfied", so the breakdown is what says which.
     */
    const found = final.result?.objective?.components
        .find((entry) => entry.constraintType.toLowerCase().includes('preference'));

    line(`  ${key.padEnd(22)} ${RunStatus[final.status]}`
        + `  termination=${final.result?.stats?.terminationReason}`
        + `  objective=${final.result?.objective?.total}`
        + `  preferenceComponent=${found ? `${found.weighted} (raw ${found.rawCount})` : 'ABSENT'}`
        + `  placements=${final.result?.sessions.length}`);

    return {
        placements: final.result?.sessions ?? [],
        component: found ? { weighted: found.weighted, rawCount: found.rawCount } : null,
    };
}

try {
    const tenant = await prisma.tenant.findFirstOrThrow({ where: { slug: 'test' } });

    /*
     * THE TERM WITH THE MOST OFFERINGS, not the earliest — and this was a real
     * false negative rather than a precaution.
     *
     * This originally took the first Term by `startDate`. A second Term was then
     * created in the development tenant with an earlier start and no offerings,
     * and every check below reported exactly what a broken feature reports: zero
     * placements, unmet cost 0 both ways, "moved toward the stated preferences:
     * NO". Nothing was wrong except that the script was solving an empty Term.
     *
     * A verification script whose "nothing found" is indistinguishable from
     * "nothing to find" is the failure this codebase keeps re-learning, so the
     * fixture choice is now REPORTED and an empty instance ABORTS instead of
     * being scored.
     */
    const terms = await prisma.term.findMany({
        where: { tenantId: tenant.id },
        orderBy: { startDate: 'asc' },
        include: { _count: { select: { offerings: true } } },
    });
    const term = terms.reduce((best, candidate) => (
        candidate._count.offerings > best._count.offerings ? candidate : best
    ));

    line(`Tenant '${tenant.slug}', ${terms.length} term(s):`);

    for (const candidate of terms) {
        line(`  ${candidate.id === term.id ? '→' : ' '} ${candidate.name}`
            + `  starts ${candidate.startDate.toISOString().slice(0, 10)}`
            + `  offerings=${candidate._count.offerings}`);
    }

    if (term._count.offerings === 0) {
        throw new Error(
            'No Term in this tenant has any offerings, so there is nothing to solve. '
            + 'This is a fixture problem, NOT a result — every comparison below would '
            + 'report 0 and look exactly like a rule that does not fire.',
        );
    }

    const { input, report } = await prisma.$transaction((tx) => assembleSolverInput(tx as never, {
        tenantId: tenant.id,
        termId: term.id,
        now: new Date(),
    }));

    // -- 1. The rule must actually be on the wire ---------------------------
    rule('PRECONDITIONS — a rule that cannot fire would pass every check below');

    const skipped = report.skippedConstraints.find((entry) => entry.type === 'person_preference_fit');
    const sent = input.constraints.filter((config) => config.personPreferenceFit !== undefined);

    line(`  person_preference_fit skipped   ${skipped ? `YES ✗  (${skipped.reason})` : 'no ✓'}`);
    line(`  configs carrying the variant    ${sent.length}`);

    for (const config of sent) {
        // `roles` must be EMPTY: the solver refuses any other value rather than
        // approximating it, so a non-empty one here would fail the run outright.
        const roles = config.personPreferenceFit?.roles ?? [];

        line(`      weight=${config.weight}  roles=[${roles.join(',')}]${roles.length ? '  ✗ WILL FAIL THE RUN' : '  ✓ empty'}`);
    }

    const stated = new Map<string, Stated>();

    for (const person of input.persons) {
        if (!person.preferred) {
            continue;
        }

        const raw = person.preferred.weightMultiplier ?? 1;

        stated.set(person.id, {
            days: person.preferred.days,
            blocks: person.preferred.blocks,
            multiplier: Math.min(CLAMP_MAX, Math.max(CLAMP_MIN, raw)),
        });
    }

    line(`  persons carrying a preference   ${stated.size}`);
    line(`  report.preferences.lecturersWithPreference  ${report.preferences.lecturersWithPreference}`);
    line(`  report.preferences.placementsWithNoSignal   ${report.preferences.placementsWithNoSignal} of ${report.preferences.placementsCounted}`);
    line(`  report.preferences.droppedOutOfGridValues   ${report.preferences.droppedOutOfGridValues}`);

    if (report.preferences.placementsWithNoSignal === report.preferences.placementsCounted) {
        line('\n  ⚠ WHOLLY INERT — every placement has no preference signal. The runs below');
        line('    would agree with each other and this check would pass while proving nothing.');
        line('    This is the `lecturer_veto` shape. Give a lecturer on a real offering a');
        line('    preference before trusting anything under RESULT.');
    }

    // -- 2. Off vs on -------------------------------------------------------
    rule('RUNS — same instance, same seed, one constraint apart');

    const withoutRule: SolverInput = {
        ...input,
        constraints: input.constraints.filter((config) => config.personPreferenceFit === undefined),
    };

    /*
     * A deliberately UNSATISFIABLE variant, because a component of 0 and no
     * component at all print the same way in a total. Every stated preference is
     * rewritten in memory to the single slot (day 1, block 0), which 40
     * placements cannot share — no room double-booking rule would permit it — so
     * a solver that prices the term MUST report a non-zero component here. If
     * this run also reports 0, the term is not being evaluated and the clean
     * result above is a coincidence rather than a proof.
     */
    const contested: SolverInput = {
        ...input,
        persons: input.persons.map((person) => (person.preferred
            ? { ...person, preferred: { ...person.preferred, days: [1], blocks: [0] } }
            : person)),
    };

    const off = (await solve(withoutRule, 'rule-off')).placements;
    const onSolved = await solve(input, 'rule-on');
    const on = onSolved.placements;
    const onAgain = (await solve(input, 'rule-on-repeat')).placements;
    const contestedSolved = await solve(contested, 'rule-on-contested');

    const offCost = costOf(off, stated);
    const onCost = costOf(on, stated);

    /*
     * ABORT rather than score. Zero scored placements makes every line under
     * RESULT read as a failure of the rule, when what it actually means is that
     * the instance had nothing for the rule to say anything about — an empty
     * Term, no lecturer links, or preferences on people who teach nothing.
     */
    if (onCost.counted === 0) {
        throw new Error(
            `Nothing to score: ${on.length} placements, none carrying a lecturer with a stated `
            + 'preference. That is a fixture problem, not a result. Check the term chosen above, '
            + '`offering_lecturer`, and `person_preference`.',
        );
    }

    rule('RESULT');
    line(`  placements scored (have a lecturer with a preference)   ${onCost.counted}`);
    line(`  unmet cost, rule OFF                                   ${offCost.cost.toFixed(4)}`);
    line(`  unmet cost, rule ON                                    ${onCost.cost.toFixed(4)}`);
    line(`  moved toward the stated preferences                     ${onCost.cost < offCost.cost ? 'YES ✓' : 'NO ✗'}`);
    line('');
    line(`  placements differ off vs on                             ${fingerprint(off) === fingerprint(on) ? 'no ✗' : 'YES ✓'}`);
    line(`  identical across two runs at the same seed             ${fingerprint(on) === fingerprint(onAgain) ? 'YES ✓' : 'no ✗'}`);
    line('');
    line(`  the term is IN the objective (component reported)       ${onSolved.component ? 'YES ✓' : 'NO ✗'}`);
    line(`  ... and prices a breach it cannot avoid                 ${(contestedSolved.component?.weighted ?? 0) > 0 ? 'YES ✓' : 'NO ✗'}`);
    line(`      unsatisfiable variant charged                       ${contestedSolved.component?.weighted ?? 0}`);

    // Per-lecturer detail, because an aggregate can improve while the person
    // whose preference the tenant actually cares about got worse.
    rule('PER LECTURER — where each stated preference landed');

    for (const [personId, person] of stated) {
        const mine = (placements: PlacedSession[]) => placements.filter((p) => p.lecturerIds.includes(personId));
        const hits = (placements: PlacedSession[]) => mine(placements)
            .filter((p) => p.startSlot && unmetFor(person, p.startSlot.day, p.startSlot.block) === 0).length;

        const total = mine(on).length;

        if (!total) {
            line(`  ${personId.slice(-12)}  lectures on nothing placed — contributes nothing`);
            continue;
        }

        line(`  ${personId.slice(-12)}  days=[${person.days.join(',')}] blocks=[${person.blocks.join(',')}]`
            + ` ×${person.multiplier}  fully satisfied: ${hits(off)}/${mine(off).length} off → ${hits(on)}/${total} on`);
    }

    line('');
} finally {
    await prisma.$disconnect();
}
