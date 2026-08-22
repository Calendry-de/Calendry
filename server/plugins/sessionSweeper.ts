import { SESSION_RETENTION_MS, deleteExpiredSessions } from '../utils/authDb';

/**
 * Sweep long-expired `auth_session` rows.
 *
 * Nothing has ever deleted them: sessions are only ever looked up by primary
 * key or unique token hash, so a dead row costs nothing to read past and was
 * never in anyone's way. It just accumulates, one row per login, for as long as
 * the deployment lives — harmless and unbounded, which is exactly the shape of
 * thing that is fine until it is not.
 *
 * WHY THIS NEEDS NONE OF THE SOLVER POLLER'S MACHINERY
 *
 * `solverPoller.ts` leases its work with `FOR UPDATE SKIP LOCKED` because two
 * instances advancing the same run would double-poll a stateful external
 * service. Here the work is one idempotent DELETE: if two instances sweep at
 * once, the loser deletes zero rows and both are correct. Adding a claim would
 * be copying the shape of the poller without the reason for it.
 *
 * It also needs no tenant context and no new RLS exception — see
 * `deleteExpiredSessions`.
 */

/**
 * Six hours. The work is one indexed DELETE, so the cadence is not about cost —
 * it is about a container that restarts often still sweeping regularly, while a
 * long-lived one sweeps four times a day. Nothing depends on the interval:
 * rows become eligible 30 days after expiry and stay eligible, so a missed
 * sweep is caught by the next one.
 */
const INTERVAL_MS = 1000 * 60 * 60 * 6;

/**
 * Delay before the first sweep. Keeps a DELETE off the startup path, where it
 * would compete with migrations and the first requests.
 */
const FIRST_RUN_MS = 1000 * 60;

/** After a sweep throws — usually the database being briefly unavailable. */
const ERROR_BACKOFF_MS = 1000 * 60 * 5;

function isEnabled(): boolean {
    // Explicit opt-out, matching CALENDRY_SOLVER_POLL: a cleanup that is off by
    // default is one someone forgets to turn on, and the symptom is invisible
    // for months. `tests/run-integration.sh` sets this to `off` — not because
    // it could damage a fixture (test sessions are hours old, not 30 days) but
    // because a suite racing a background job is a suite that fails once a week
    // for no reason anyone can reproduce.
    return process.env.CALENDRY_SESSION_SWEEP !== 'off';
}

export default defineNitroPlugin(() => {
    if (!isEnabled()) {
        console.log('[session-sweeper] disabled (CALENDRY_SESSION_SWEEP=off)');

        return;
    }

    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function tick(): Promise<void> {
        if (stopped) {
            return;
        }

        let delay = INTERVAL_MS;

        try {
            const { deleted, before } = await deleteExpiredSessions();

            /**
             * Logged on EVERY sweep, including the ones that delete nothing.
             * "Deleted 0" and "never ran" are different states and must not
             * produce the same silence — the whole class of bug CLAUDE.md's
             * "guards must fail loudly or match exactly" rule is about. The
             * cutoff is included so the retention window is visible in the log
             * rather than only in the source.
             */
            console.log(`[session-sweeper] deleted ${deleted} session(s) expired before `
                + `${before.toISOString()}`);
        } catch (error) {
            console.error('[session-sweeper] sweep failed:', error);
            delay = ERROR_BACKOFF_MS;
        }

        if (!stopped) {
            // Chained setTimeout rather than setInterval, matching the poller: a
            // slow sweep must not overlap the next one.
            timer = setTimeout(() => void tick(), delay);
        }
    }

    // Derived, not restated: a retention window that drifts from the log line
    // describing it is a log line that lies.
    const retentionDays = SESSION_RETENTION_MS / 86_400_000;

    console.log(`[session-sweeper] started (first sweep in ${FIRST_RUN_MS / 1000}s, then every `
        + `${INTERVAL_MS / 3_600_000}h, retaining ${retentionDays} days)`);
    timer = setTimeout(() => void tick(), FIRST_RUN_MS);

    return () => {
        stopped = true;

        if (timer) {
            clearTimeout(timer);
        }
    };
});
