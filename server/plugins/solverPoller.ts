import { claimDueRuns, inTenant, tenantsWithDueRuns } from '../utils/solverPollClaim';
import { pollSolverRun, recoverRunResult } from '../utils/solverPolling';
import { logger } from '../utils/logger';

/**
 * Stage 4: the background solver poller.
 *
 * WHY THIS EXISTS AND ON-DEMAND POLLING IS NOT ENOUGH
 *
 * The solver keeps runs in an in-memory registry with no persistence and no
 * eviction. If nobody opens a run's page, the run finishes, the app never
 * learns, and the result is never captured. If the solver then restarts,
 * the answer is gone for good while the row still says RUNNING. The
 * one-active-run-per-term index would leave that term blocked indefinitely.
 *
 * So correctness lives here, and `GET /api/solver/runs/:id` exists only to give
 * someone who IS watching a faster answer. Both call the same `pollSolverRun`,
 * so they cannot disagree about what a status means.
 *
 * WHERE IT RUNS
 *
 * In-process, rather than an external cron hitting an endpoint: a cron needs
 * authentication, deployment coordination, and is one more thing to forget to
 * set up. The trade is that every app instance would poll, which the claim in
 * `solverPollClaim.ts` handles.
 */

/** Between sweeps. Individual runs have their own cadence via `next_poll_at`. */
const TICK_MS = 500;

/** After a sweep throws, usually because the database is briefly unavailable. */
const ERROR_BACKOFF_MS = 5_000;

function isEnabled(): boolean {
    // Explicit opt-out rather than opt-in: a poller that is off by default is a
    // poller someone forgets to turn on, and the symptom is runs that silently
    // never finish. `tests/run-integration.sh` sets this to `off` so the suites
    // are not racing a background job against their own fixtures.
    return process.env.CALENDRY_SOLVER_POLL !== 'off';
}

export default defineNitroPlugin(() => {
    if (!isEnabled()) {
        logger.info('[solver-poller] disabled (CALENDRY_SOLVER_POLL=off)');

        return;
    }

    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function sweep(): Promise<void> {
        const tenantIds = await tenantsWithDueRuns();

        for (const tenantId of tenantIds) {
            const claimed = await claimDueRuns(tenantId);

            for (const run of claimed) {
                /**
                 * One failing run must never stop the sweep. A solver that is
                 * unreachable for one run is unreachable for all of them, but a
                 * malformed row or an unexpected error is local to itself.
                 */
                try {
                    /**
                     * Two shapes are claimed, and they need opposite handling: a
                     * live run is ADVANCED, while a finished one whose result
                     * never arrived is RE-FETCHED. The claim already knows which
                     * predicate matched, so it is not re-derived here.
                     */
                    if (run.needsResultRecovery) {
                        const outcome = await inTenant(tenantId, (tx) => recoverRunResult(tx, run));

                        if (outcome.recovered) {
                            logger.info(
                                { runId: run.id, attempts: outcome.attempts, generationId: outcome.generationId ?? null },
                                '[solver-poller] result recovered',
                            );
                        } else if (outcome.lost) {
                            logger.warn(
                                { runId: run.id, attempts: outcome.attempts, detail: outcome.detail },
                                '[solver-poller] RESULT LOST',
                            );
                        }

                        continue;
                    }

                    // The gRPC call happens HERE, outside the claim transaction,
                    // because the advisory lock was released at its commit.
                    const outcome = await inTenant(tenantId, (tx) => pollSolverRun(tx, run));

                    if (outcome.becameTerminal) {
                        logger.info(
                            { runId: run.id, status: outcome.status, detail: outcome.detail ?? null },
                            '[solver-poller] run became terminal',
                        );

                        if (outcome.generationId) {
                            logger.info(
                                { runId: run.id, generationId: outcome.generationId },
                                '[solver-poller] generation ready',
                            );
                        }
                    }
                } catch (error) {
                    logger.error({ err: error, runId: run.id }, '[solver-poller] run failed to poll');
                }
            }
        }
    }

    async function tick(): Promise<void> {
        if (stopped) {
            return;
        }

        let delay = TICK_MS;

        try {
            await sweep();
        } catch (error) {
            // Reaching here means the sweep itself broke, most likely the
            // database. Backing off rather than hammering it every 500ms.
            logger.error({ err: error }, '[solver-poller] sweep failed');
            delay = ERROR_BACKOFF_MS;
        }

        if (!stopped) {
            // setTimeout chained rather than setInterval: a slow sweep must not
            // overlap the next one, which would double-poll the same claims.
            timer = setTimeout(() => void tick(), delay);
        }
    }

    logger.info({ tickMs: TICK_MS }, '[solver-poller] started');
    timer = setTimeout(() => void tick(), TICK_MS);

    return () => {
        stopped = true;
        clearTimeout(timer);
    };
});
