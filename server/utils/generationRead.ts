import type { Prisma } from '@prisma/client';
import type { Tx } from './tenantDb';

/**
 * Shared read shaping for the Generation routes (Stage 6a).
 *
 * The list, the detail and the preview all describe the same thing, so they
 * describe it the same way — a review screen that shows one set of fields in a
 * list and a differently-named set on the detail page is a screen nobody trusts.
 */

/** Everything the UI needs about a proposal, without its placements. */
export const GENERATION_SELECT = {
    id: true,
    version: true,
    /**
     * The Generation's OWN term, not its run's. Null means tenant-wide (a
     * MANUAL_BASELINE or an import). Every consumer that used to reach through
     * `run.termId` should read this instead: a version number only means
     * something alongside the term it counts within, and a Generation with no
     * run still has to say which term it belongs to.
     */
    termId: true,
    source: true,
    status: true,
    isCurrent: true,
    solverMeta: true,
    parentGenerationId: true,
    createdAt: true,
    appliedAt: true,
    createdById: true,
} satisfies Prisma.GenerationSelect;

/**
 * Terminations this app knows to be reproducible.
 *
 * AN ALLOW-LIST, NOT A DENY-LIST, and the difference is the whole point. This
 * was `reason !== 'time_budget'`, which answers "reproducible" for every string
 * it has never seen — so when the solver gained `stagnated` (a run that could
 * not place everything and stopped searching), the app reported it as a clean,
 * repeatable result without a line of code being wrong about `stagnated`
 * specifically. A new termination reason must now arrive as UNKNOWN and stay
 * there until somebody decides what it means.
 */
const REPRODUCIBLE_TERMINATIONS = new Set(['converged', 'move_budget']);

/**
 * Reproducibility, stated only when it is actually known.
 *
 * `time_budget` is not reproducible: how many moves fit in a second is not a
 * property of the input. `converged` and `move_budget` both are.
 *
 * NULL means the run predates Stage 6a's `termination_reason` capture, OR ends
 * for a reason this version does not recognise. Both are honestly "unknown" —
 * never "reproducible". Rows are not backfilled, so the first case is real and
 * permanent, not transitional.
 */
export function isReproducible(terminationReason: string | null): boolean | null {
    if (!terminationReason) {
        return null;
    }

    if (REPRODUCIBLE_TERMINATIONS.has(terminationReason)) {
        return true;
    }

    // Named, so the one reason we know NOT to be reproducible still answers
    // false rather than falling into the unknown bucket with everything else.
    return terminationReason === 'time_budget' ? false : null;
}

export interface RunSummary {
    id: string;
    status: string;
    terminationReason: string | null;
    reproducible: boolean | null;
    objective: number | null;
    movesEvaluated: string | null;
    elapsedMillis: number | null;
    seed: string | null;
    inputHash: string | null;
    termId: string;
}

/**
 * The run behind a Generation, or null.
 *
 * Null is a legitimate shape, not a failure: a MANUAL_BASELINE or imported
 * Generation has no solver run, and a review screen must render that rather
 * than treat it as a broken solver Generation.
 */
export async function runSummaryFor(tx: Tx, tenantId: string, generationId: string): Promise<RunSummary | null> {
    const run = await tx.solverRun.findFirst({
        where: { tenantId, generationId },
        select: {
            id: true, termId: true, status: true, terminationReason: true,
            bestObjective: true, movesEvaluated: true, elapsedMillis: true,
            seed: true, inputHash: true,
        },
    });

    if (!run) {
        return null;
    }

    return {
        id: run.id,
        termId: run.termId,
        status: run.status,
        terminationReason: run.terminationReason,
        reproducible: isReproducible(run.terminationReason),
        objective: run.bestObjective,
        // BigInt does not survive JSON; the wire has carried these as strings
        // since Stage 2 (`toWireU64`) and this keeps that consistent.
        movesEvaluated: run.movesEvaluated?.toString() ?? null,
        elapsedMillis: run.elapsedMillis,
        seed: run.seed?.toString() ?? null,
        inputHash: run.inputHash,
    };
}
