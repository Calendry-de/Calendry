import type { Ref } from 'vue';
import { useT } from '~/composables/i18n';
import type { SolverMode } from '#shared/solverMode';
import type { ConstraintIssue } from '#shared/constraintTypes';
import type { ResolvedSolverError } from '#shared/solverErrorParsing';

/**
 * The solver run in flight, for one Term.
 *
 * OWNERSHIP BOUNDARY: everything about *a run happening right now*: its status,
 * its live numbers, whether it is improving, and the two actions that change it.
 * It does not own the Generation the run produces; the moment a run goes
 * terminal this hands off to the review route and stops caring.
 *
 * WHY THE OBJECTIVE SERIES LIVES HERE AND NOT IN THE DATABASE
 *
 * `solver_run` deliberately stores only the latest snapshot. Its schema says
 * "Overwritten per poll, not appended: the run's history is not something
 * anything needs." That stays true. A trend is only meaningful while somebody is
 * watching, which is exactly when a client-side series exists; persisting a
 * sample per poll per run would add write volume to serve a sparkline nobody is
 * looking at. The cost is that reloading the page restarts the series, which is
 * a fair trade and stated rather than hidden.
 *
 * POLLING IS THE LATENCY PATH, NOT THE CORRECTNESS PATH. The background poller
 * (Stage 4) is what guarantees a run reaches a terminal state and its result is
 * captured. Nothing here is load-bearing for that, which is why it can back off
 * and pause freely.
 *
 * The Nuxt trap this must not fall into: no top-level `await`. An `await`
 * before a `useState`/`useRequestFetch` call detaches everything after it from
 * the Nuxt instance and fails at runtime.
 */

export type RunStatus = 'PENDING' | 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';

export interface SolverRunRow {
    id: string;
    termId: string;
    status: RunStatus;
    progress: number;
    bestObjective: number | null;
    movesEvaluated: string | null;
    elapsedMillis: number | null;
    terminationReason: string | null;
    errorDetail: string | null;
    /**
     * `errorDetail`, parsed and its subject resolved to a display name
     * server-side (`server/utils/solverErrorMapping.ts`). `null` when there is
     * no `errorDetail`, or when it does not match the one shape the solver's
     * own rejections take (`shared/solverErrorParsing.ts`): a message this app
     * has never seen falls back to being shown raw, not hidden.
     */
    parsedError?: ResolvedSolverError | null;
    /** Set when a SUCCEEDED run's result could not be recovered. */
    resultLostAt?: string | null;
    generationId: string | null;
    maxMoves: string | null;
    maxWallMillis: number | null;
    /**
     * The stored scope, opaque here except for `mode`. Optional because only the
     * active-run list selects it: the control needs it to say what a 409
     * adopted it into, and nothing else reads it.
     */
    scope?: unknown;
    createdAt: string;
    /** Null until `StartRun` acks (or forever, for a run that never got that far). */
    startedAt?: string | null;
    /** Null while the run is still active. */
    finishedAt?: string | null;
}

/** The six states the control renders. Derived, never stored. */
export type ControlState =
    | 'idle'
    | 'starting'
    | 'running'
    | 'cancelling'
    | 'finished'
    | 'failed';

const ACTIVE: RunStatus[] = ['PENDING', 'QUEUED', 'RUNNING'];

/** How long a flat objective counts as "still working" before it reads as stalled. */
const STALL_AFTER_MS = 12_000;

/**
 * Fast while the interesting part happens, slower once it is clearly a long run.
 *
 * Mirrors the server's adaptive cadence in spirit without duplicating its table:
 * this one only decides how often a watching human's numbers refresh.
 */
export function clientPollMs(ageMs: number): number {
    return ageMs < 10_000 ? 1_000 : 2_500;
}

/** `68ms`/`3.2s`: whichever reads better at that magnitude. */
export function formatDuration(ms: number): string {
    return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/**
 * The created → finished delta for a terminal run, so an instant validation
 * rejection ("failed 68ms after it was created") reads as nothing like a
 * solver that ran for a while and then timed out.
 *
 * Computed from the row's OWN timestamps, not `elapsedMillis`: that field is
 * the solver's own figure, `null` for a run that failed before the solver
 * ever answered a `GetStatus` (a pre-flight-shaped rejection, or a transport
 * failure), which is exactly the case this exists to describe.
 *
 * `null` for a run that has not finished, or whose timestamps do not make
 * sense (clock skew, a row from before both columns existed).
 */
export function elapsedMs(run: Pick<SolverRunRow, 'createdAt' | 'finishedAt'>): number | null {
    if (!run.finishedAt) {
        return null;
    }

    const ms = new Date(run.finishedAt).getTime() - new Date(run.createdAt).getTime();

    return Number.isFinite(ms) && ms >= 0 ? ms : null;
}

/**
 * Which `subjectType`s a solver error's `parsedError` can name that also have
 * a `/manage/<resource>/:id` edit page. `session` and `person` are
 * deliberately absent: a Session is the schedule grid itself, not a `/manage`
 * entity, and a Person's edit page is not where anyone would look to fix a
 * SOLVER rejection naming them.
 */
const MANAGE_RESOURCE_BY_SUBJECT: Record<string, string> = {
    constraint: 'constraints',
    offering: 'offerings',
    room: 'rooms',
    group: 'groups',
};

/** The `/manage/...` edit link for a resolved solver error's subject, or `null` when there is none. */
export function manageLinkForSubject(
    parsed: Pick<ResolvedSolverError, 'subjectType' | 'subjectId'> | null | undefined,
): string | null {
    if (!parsed) {
        return null;
    }

    const resource = MANAGE_RESOURCE_BY_SUBJECT[parsed.subjectType];

    return resource ? `/manage/${resource}/${parsed.subjectId}` : null;
}

/**
 * The six states, derived from the run and the two in-flight flags.
 *
 * Pure and exported so the machine can be tested without a browser: every
 * transition below is a rule someone will otherwise have to rediscover by
 * clicking, and two of them (`cancelling`, and SUCCEEDED-without-a-Generation)
 * are exactly the ones that are hard to reproduce by hand.
 */
export function deriveState(input: {
    starting: boolean;
    cancelling: boolean;
    run: Pick<SolverRunRow, 'status' | 'generationId'> | null;
}): ControlState {
    if (input.starting) {
        return 'starting';
    }

    if (input.cancelling) {
        return 'cancelling';
    }

    if (!input.run) {
        return 'idle';
    }

    if (ACTIVE.includes(input.run.status)) {
        return 'running';
    }

    // A SUCCEEDED run always produces a Generation (Stage 5), so its absence
    // means the capture failed: a failure to report, not a proposal to review.
    if (input.run.status === 'SUCCEEDED' && input.run.generationId) {
        return 'finished';
    }

    return 'failed';
}

/**
 * Whether the objective is still improving, and for how long it has not been.
 *
 * The one number on screen that says whether waiting longer buys anything: a
 * flat objective is precisely when to cancel. Derived explicitly rather than
 * left for a human to infer from a twitching counter.
 */
export function deriveTrend(
    series: { at: number; objective: number }[],
    stallAfterMs = STALL_AFTER_MS,
): { improving: boolean; flatForMs: number } | null {
    if (series.length < 2) {
        return null;
    }

    const latest = series[series.length - 1]!;
    let lastChangeAt = series[0]!.at;

    for (let i = 1; i < series.length; i++) {
        if (series[i]!.objective !== series[i - 1]!.objective) {
            lastChangeAt = series[i]!.at;
        }
    }

    const flatForMs = latest.at - lastChangeAt;

    return { improving: flatForMs < stallAfterMs, flatForMs };
}

export interface StartOptions {
    maxMoves?: number;
    maxWallMillis?: number;
    /**
     * What the run is FOR. Omitted is `rebuild`, matching the route's own
     * default, so every existing caller is unchanged.
     *
     * A `repair` sends no scope at all, which is the whole feature: every
     * Session is then out of scope, movable, and charged for moving.
     */
    mode?: SolverMode;
}

export function useSolverRun(termId: Ref<string>) {
    const { t } = useT();

    const run = ref<SolverRunRow | null>(null);
    const starting = ref(false);
    const cancelling = ref(false);
    const error = ref<string | null>(null);
    /**
     * Why this tenant's enabled constraints would block a run, checked BEFORE
     * anyone clicks: `GET /api/solver/preflight`, the same check
     * `POST /api/solver/runs` runs before creating a row. Kept separate from
     * `error` (a start ATTEMPT that failed) because this is not a failure, it
     * is the reason the button is disabled.
     */
    const preflightIssues = ref<ConstraintIssue[]>([]);
    /** Set when a POST loses the one-active-run race and we adopt the winner. */
    const adopted = ref(false);
    /** What the losing POST asked for, so the adoption notice can name both. */
    const requestedMode = ref<SolverMode>('rebuild');

    /** (timestamp, objective) samples for this run only. Reset when the run changes. */
    const series = ref<{ at: number; objective: number }[]>([]);
    const watchedRunId = ref<string | null>(null);

    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const isActive = computed(() => Boolean(run.value && ACTIVE.includes(run.value.status)));

    const state = computed<ControlState>(() => deriveState({
        starting: starting.value,
        cancelling: cancelling.value,
        run: run.value,
    }));

    const trend = computed(() => deriveTrend(series.value));

    function record(row: SolverRunRow) {
        // A different run means a different series; carrying samples across would
        // invent a trend out of two unrelated searches.
        if (watchedRunId.value !== row.id) {
            watchedRunId.value = row.id;
            series.value = [];
        }

        // `typeof`, not `!== null`: the active-run rows from the list endpoint
        // are a partial select and carry no objective at all, and `undefined`
        // would otherwise be recorded as a sample and poison the trend.
        if (typeof row.bestObjective === 'number') {
            series.value = [...series.value.slice(-119), { at: Date.now(), objective: row.bestObjective }];
        }
    }

    function schedule(delay: number) {
        clearTimeout(timer);

        if (stopped) {
            return;
        }

        timer = setTimeout(() => void poll(), delay);
    }

    async function poll() {
        const current = run.value;

        if (!current || !ACTIVE.includes(current.status)) {
            return;
        }

        // Nothing on screen to update, so nothing worth asking for. The
        // background poller keeps the run correct meanwhile.
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
            schedule(2_000);

            return;
        }

        try {
            const fresh = await $fetch<{ run: SolverRunRow }>(`/api/solver/runs/${current.id}`);

            run.value = fresh.run;
            record(fresh.run);

            if (ACTIVE.includes(fresh.run.status)) {
                schedule(clientPollMs(Date.now() - new Date(fresh.run.createdAt).getTime()));
            } else {
                cancelling.value = false;
            }
        } catch {
            // A failed poll is not a failed run: Stage 4's rule. Keep the last
            // known state and try again rather than inventing a failure.
            schedule(3_000);
        }
    }

    /**
     * Refresh `preflightIssues` for the CURRENT tenant (not per-term; see
     * `preflightConstraints`'s own comment for why a constraint's params are
     * tenant-wide configuration).
     *
     * Best-effort like `adopt()`: no permission or an unreachable API leaves
     * the last known list rather than inventing a "nothing wrong" answer, and
     * an empty issue list is only ever a POSITIVE claim when the fetch
     * actually returned one.
     */
    async function checkPreflight() {
        if (!termId.value) {
            return;
        }

        try {
            const result = await $fetch<{ issues: ConstraintIssue[] }>(
                `/api/solver/preflight?termId=${encodeURIComponent(termId.value)}`,
            );

            preflightIssues.value = result.issues;
        } catch {
            // No permission, or the endpoint is unavailable. Leave the button
            // exactly as it was rather than claiming certainty either way.
        }
    }

    /**
     * Pick up whatever is already running for this term, started by anyone.
     *
     * Solving is a TENANT activity, not a per-user one: a run someone else
     * launched changes the schedule this browser is looking at, so it belongs in
     * this toolbar even though this browser did not start it.
     */
    async function adopt() {
        clearTimeout(timer);
        run.value = null;
        series.value = [];
        watchedRunId.value = null;
        error.value = null;
        adopted.value = false;

        if (!termId.value) {
            return;
        }

        try {
            const list = await $fetch<{ runs: SolverRunRow[]; active: SolverRunRow[] }>(
                `/api/solver/runs?termId=${encodeURIComponent(termId.value)}&limit=1`,
            );

            /**
             * `active` is an ARRAY, and an empty one is truthy: reading it as a
             * single row made adoption silently never fire, which looks exactly
             * like "there is no run in progress". Take its first element, and
             * only ever adopt from `active`: `runs[0]` is merely the newest run,
             * which is usually a finished one.
             */
            const found = list.active?.[0] ?? null;

            if (found && ACTIVE.includes(found.status)) {
                run.value = found;
                record(found);
                adopted.value = true;
                schedule(500);
            }
        } catch {
            // No permission, or the list is unavailable. Either way the control
            // simply shows nothing rather than an error nobody can act on.
        }
    }

    /** What KIND of run this is, for a message that has to name it. */
    function modeOf(row: SolverRunRow | null): SolverMode {
        const scope = row?.scope as { mode?: SolverMode } | undefined;

        // Anything unrecognised, including a run stored before `mode` existed,
        // reads as a rebuild, which is what those runs actually were.
        return scope?.mode === 'repair' ? 'repair' : 'rebuild';
    }

    async function start(options: StartOptions = {}) {
        starting.value = true;
        error.value = null;
        adopted.value = false;

        try {
            const created = await $fetch<{ run: SolverRunRow }>('/api/solver/runs', {
                method: 'POST',
                body: { termId: termId.value, ...options },
            });

            run.value = created.run;
            record(created.run);
            schedule(500);
        } catch (e) {
            const status = (e as { statusCode?: number }).statusCode;
            const data = (e as { data?: {
                error?: string;
                issues?: ConstraintIssue[];
                runId?: string;
                parsedError?: ResolvedSolverError | null;
            } }).data;

            /**
             * 409 means the one-active-run index rejected this because a run
             * started between the click and the request. That is not an error
             * state (the thing the user wanted is already happening), so adopt
             * the winner and say so.
             */
            if (status === 409) {
                // Remembered BEFORE adopting, because adopt() replaces `run`
                // with the winner: the message has to compare what was asked
                // for against what was joined.
                requestedMode.value = options.mode ?? 'rebuild';
                await adopt();
                adopted.value = true;
            } else if (data?.error === 'SOLVER_PRECONDITION_FAILED' && data.issues) {
                /**
                 * The button should have been disabled already (`preflightIssues`
                 * is checked on mount and refreshed after every dismiss), so
                 * reaching this is a RACE: something changed between that check
                 * and this click. Refreshed rather than merely stashed in
                 * `error`, so the idle view's issue list (the thing a person can
                 * actually act on) is exactly what blocked THIS click.
                 */
                preflightIssues.value = data.issues;
            } else if (data?.runId) {
                /**
                 * A `solver_run` row WAS created and then marked FAILED
                 * (`SolverRejectedError`, or a transport failure): fetch it and
                 * render the FAILED state, with its parsed reason and raw
                 * detail, rather than leaving `run` null and showing nothing
                 * but a floating error string with no run to look at.
                 */
                try {
                    const fetched = await $fetch<{ run: SolverRunRow }>(`/api/solver/runs/${data.runId}`);

                    run.value = fetched.run;
                } catch {
                    error.value = serverErrorMessage(e) ?? t('schedule.solver.startFailed');
                }
            } else {
                error.value = serverErrorMessage(e) ?? t('schedule.solver.startFailed');
            }
        } finally {
            starting.value = false;
        }
    }

    async function cancel() {
        if (!run.value) {
            return;
        }

        // Cancellation is acknowledged by the solver but only OBSERVED by a
        // poll, so there is a real gap where the run is still RUNNING. Without
        // this state the button looks broken and gets pressed again.
        cancelling.value = true;

        try {
            await $fetch(`/api/solver/runs/${run.value.id}/cancel`, { method: 'POST' });
            schedule(500);
        } catch (e) {
            cancelling.value = false;
            error.value = serverErrorMessage(e) ?? t('schedule.solver.cancelFailed');
        }
    }

    /** Back to idle after a terminal run, so the control offers a fresh start. */
    function dismiss() {
        run.value = null;
        series.value = [];
        watchedRunId.value = null;
        error.value = null;
        adopted.value = false;
        // The tenant may have just fixed the constraint the FAILED run named;
        // re-check rather than leaving the button disabled on stale news.
        void checkPreflight();
    }

    /**
     * Client-only, deliberately. An `immediate: true` watcher would run during
     * SSR, where a bare `$fetch` carries no cookie and 401s, and the catch in
     * `adopt()` would render "no run in progress", which is indistinguishable
     * from the truth. Live run state is not first-render state: idle is the
     * correct thing to show until the browser has actually asked.
     */
    onMounted(() => {
        void adopt();
        void checkPreflight();
    });
    watch(termId, () => {
        void adopt();
        void checkPreflight();
    });

    onBeforeUnmount(() => {
        stopped = true;
        clearTimeout(timer);
    });

    /**
     * What to say when a start lost the one-active-run race.
     *
     * `null` when nothing was adopted. The two modes are named separately
     * because joining a REBUILD after asking for a repair is the one case where
     * "a run was already in progress" is actively misleading: the user asked to
     * fix three clashes and is now watching something that will replace the
     * whole term.
     */
    const adoptedNotice = computed(() => {
        if (!adopted.value) {
            return null;
        }

        const joined = modeOf(run.value);

        if (joined === requestedMode.value) {
            return joined === 'repair'
                ? t('schedule.solver.adoptedRepair')
                : t('schedule.solver.adoptedRebuild');
        }

        return joined === 'rebuild'
            ? t('schedule.solver.adoptedRebuildInsteadOfRepair')
            : t('schedule.solver.adoptedRepairInsteadOfRebuild');
    });

    return {
        run, state, trend, error, adopted, adoptedNotice, isActive, preflightIssues,
        start, cancel, dismiss,
    };
}
