<template>
    <div class="solver">
        <!-- IDLE -->
        <template v-if="state === 'idle'">
            <CommonButton
                type="secondary"
                @click="startRun"
            >
                <Icon
                    name="material-symbols:auto-awesome-outline"
                    aria-hidden="true"
                />
                Generate schedule
            </CommonButton>

            <button
                type="button"
                class="solver_advanced-toggle"
                :aria-expanded="showAdvanced"
                @click="showAdvanced = !showAdvanced"
            >{{ showAdvanced ? 'Hide' : 'Advanced' }}</button>

            <!-- Exposed rather than defaulted because the feedback loop needs
                 it: a run ending on `move_budget` is saying it had more to do. -->
            <div
                v-if="showAdvanced"
                class="solver_advanced"
            >
                <label class="solver_field">
                    <span>Move budget</span>
                    <input
                        v-model.number="maxMoves"
                        type="number"
                        min="1"
                        max="100000000"
                        step="500000"
                    >
                </label>
                <label class="solver_field">
                    <span>Time budget (s)</span>
                    <input
                        v-model.number="maxWallSeconds"
                        type="number"
                        min="1"
                        max="600"
                    >
                </label>
                <p class="solver_hint">Whichever is reached first ends the run.</p>
            </div>
        </template>

        <!-- STARTING: nothing is known yet, so nothing is claimed. -->
        <p
            v-else-if="state === 'starting'"
            class="solver_status"
        >
            <Icon
                name="material-symbols:progress-activity"
                aria-hidden="true"
            />
            Starting…
        </p>

        <!-- RUNNING / CANCELLING -->
        <div
            v-else-if="state === 'running' || state === 'cancelling'"
            class="solver_live"
        >
            <div class="solver_live-head">
                <span class="solver_status">
                    <Icon
                        name="material-symbols:progress-activity"
                        aria-hidden="true"
                    />
                    {{ state === 'cancelling' ? 'Cancelling…' : 'Solving' }}
                </span>

                <CommonButton
                    v-if="state === 'running'"
                    type="secondary-black"
                    @click="confirmCancel = true"
                >Cancel</CommonButton>
            </div>

            <!--
                THE DETAIL IS AN ANCHORED PANEL, NOT A BAR MEMBER. In flow it took
                the toolbar from 142px to 321px and moved "Add event"/"Proposals"
                190px down the page for the duration of a run. Only the one-line
                head above stays in the bar; `.bar`'s `align-items: end` depends
                on that.
            -->
            <div class="solver_panel">
                <p
                    v-if="adoptedNotice"
                    class="solver_hint"
                >{{ adoptedNotice }}</p>

                <!-- The headline number: whether waiting longer buys anything. -->
                <p class="solver_objective">
                    <span class="solver_objective-value">{{ objectiveLabel }}</span>
                    <span
                        v-if="trendLabel"
                        class="solver_trend"
                        :class="{ 'solver_trend--stalled': trend && !trend.improving }"
                    >{{ trendLabel }}</span>
                </p>

                <p class="solver_counters">{{ movesLabel }} · {{ elapsedLabel }}</p>

                <!-- "move budget", NOT "complete": `progress` is
                     movesEvaluated / maxMoves — budget consumed, not closeness to
                     an answer. A converged run finishes at 3%. -->
                <div
                    class="solver_budget"
                    role="progressbar"
                    :aria-valuenow="Math.round(budgetFraction * 100)"
                    aria-valuemin="0"
                    aria-valuemax="100"
                    aria-label="Move budget used"
                >
                    <span
                        class="solver_budget-fill"
                        :style="{ width: '100%', transform: `scaleX(${Math.min(1, budgetFraction)})` }"
                    />
                </div>
                <p class="solver_hint">move budget {{ Math.round(budgetFraction * 100) }}% used — {{ budgetCaption }}</p>

                <div
                    v-if="confirmCancel"
                    class="solver_confirm"
                >
                    <span>Cancel this run? Its work is discarded and no proposal is produced.</span>
                    <CommonButton
                        type="destructive"
                        @click="doCancel"
                    >Cancel run</CommonButton>
                    <CommonButton
                        type="link"
                        @click="confirmCancel = false"
                    >Keep solving</CommonButton>
                </div>
            </div>
        </div>

        <!-- FINISHED: a handoff, not a completion notice. -->
        <div
            v-else-if="state === 'finished'"
            class="solver_done"
        >
            <p class="solver_status solver_status--done">
                <Icon
                    name="material-symbols:check-circle-outline"
                    aria-hidden="true"
                />
                {{ doneSummary }}
            </p>

            <CommonButton
                v-if="canReadGenerations && generationStatus === 'READY'"
                type="primary"
                @click="openReview"
            >Review</CommonButton>
            <!--
                Every other case says WHICH case it is. This branch used to read
                "Discarded." for anything that was not APPLIED — including a
                status that never arrived, which is what a missing
                `generation.read` now produces: a run that finished, a proposal
                that exists, and a sentence claiming somebody threw it away.
            -->
            <span
                v-else
                class="solver_hint"
            >{{ doneHint }}</span>

            <CommonButton
                type="link"
                @click="dismiss"
            >Dismiss</CommonButton>
        </div>

        <!-- FAILED / CANCELLED -->
        <div
            v-else
            class="solver_done"
        >
            <p class="solver_status solver_status--failed">
                <Icon
                    name="material-symbols:error-outline"
                    aria-hidden="true"
                />
                {{ failedSummary }}
            </p>
            <CommonButton
                type="secondary"
                @click="dismiss"
            >Try again</CommonButton>
        </div>

        <p
            v-if="error"
            class="solver_error"
        >{{ error }}</p>
    </div>
</template>

<script setup lang="ts">
import CommonButton from '~/components/common/CommonButton.vue';
import { useSolverRun } from '~/composables/solverRun';
import { useHasPermission } from '~/composables/session';
import { DEFAULT_MAX_MOVES, DEFAULT_MAX_WALL_MILLIS } from '~~/shared/solverBudget';

const props = defineProps<{ termId: string }>();

const termId = computed(() => props.termId);
const { run, state, trend, error, adoptedNotice, start, cancel, dismiss } = useSolverRun(termId);

const showAdvanced = ref(false);
const confirmCancel = ref(false);

// Seeded from the route's own defaults so the disclosure shows what a plain
// click would have done, rather than blank inputs. Imported rather than
// retyped: two literals that merely happened to match let the route's default
// be raised while every run started from here kept sending the old one.
const maxMoves = ref(DEFAULT_MAX_MOVES);
const maxWallSeconds = ref(DEFAULT_MAX_WALL_MILLIS / 1000);

/** The Generation's CURRENT status — an applied proposal must stop inviting a decision. */
const generationStatus = ref<string | null>(null);
const doneMeta = ref<{ placements?: number; hardViolations?: number } | null>(null);

/**
 * Whether this caller may read the proposal this run produced.
 *
 * `solver.trigger` and `generation.read` are separate keys and neither implies
 * the other, so "may start a run, may not look at its output" is a role a tenant
 * can compose. Checked here rather than left to the fetch's `catch`, because a
 * 403 and a dropped request are the same `null` and must not read the same.
 */
const canReadGenerations = useHasPermission('generation.read');

/**
 * What to say when there is no Review button.
 *
 * Four distinguishable facts, deliberately not collapsed: the caller may not
 * look, somebody applied it, somebody discarded it, or the status did not come
 * back. The last one is why this exists — it was previously indistinguishable
 * from the third.
 */
const doneHint = computed(() => {
    if (!canReadGenerations.value) {
        return 'A proposal was produced. Reviewing it needs the generation.read permission.';
    }

    if (generationStatus.value === 'APPLIED') {
        return 'Applied.';
    }

    if (generationStatus.value === 'SUPERSEDED') {
        return 'Discarded.';
    }

    if (generationStatus.value === null) {
        return 'Could not read the proposal\u2019s status.';
    }

    // Mirrors the discard route's own 409 wording, so the two agree.
    return `The proposal is ${generationStatus.value.toLowerCase()} and is not awaiting a decision.`;
});

async function startRun() {
    confirmCancel.value = false;
    await start({ maxMoves: maxMoves.value, maxWallMillis: maxWallSeconds.value * 1000 });
}

/**
 * Start a REPAIR, from wherever the problem is being looked at.
 *
 * Exposed rather than duplicated as a second button here. The one-active-run
 * index means a repair and a rebuild can never run together, so they are not
 * peers in a toolbar — and one `useSolverRun` per Term is the whole point: a
 * second instance would be a second poller and a second state machine over one
 * run. The violations panel calls this; the run then renders here exactly as a
 * rebuild does.
 */
async function startRepair() {
    confirmCancel.value = false;
    await start({
        mode: 'repair',
        maxMoves: maxMoves.value,
        maxWallMillis: maxWallSeconds.value * 1000,
    });
}

defineExpose({ startRepair });

async function doCancel() {
    confirmCancel.value = false;
    await cancel();
}

function openReview() {
    if (run.value?.generationId) {
        navigateTo(`/schedule/review/${run.value.generationId}`);
    }
}

/**
 * "Review" on a Generation somebody already applied would invite a decision that
 * no longer exists, so the status is re-read whenever it changes.
 */
watch(() => run.value?.generationId, async (generationId) => {
    generationStatus.value = null;
    doneMeta.value = null;

    // No id, or no authority to ask. Skipped rather than attempted-and-caught, so
    // the hint above can say which of the two it is.
    if (!generationId || !canReadGenerations.value) {
        return;
    }

    try {
        const generation = await $fetch<{
            status: string;
            solverMeta: { placements?: number; hardViolations?: number } | null;
        }>(`/api/generations/${generationId}`);

        generationStatus.value = generation.status;
        doneMeta.value = generation.solverMeta;
    } catch {
        generationStatus.value = null;
    }
});

const objectiveLabel = computed(() => (
    run.value?.bestObjective === null || run.value?.bestObjective === undefined
        ? 'objective —'
        : `objective ${run.value.bestObjective.toLocaleString()}`
));

const trendLabel = computed(() => {
    if (!trend.value) {
        return '';
    }

    return trend.value.improving
        ? '↓ improving'
        : `no improvement for ${Math.round(trend.value.flatForMs / 1000)}s`;
});

function compact(n: number): string {
    if (n >= 1_000_000) {
        return `${(n / 1_000_000).toFixed(1)}M`;
    }

    if (n >= 1_000) {
        return `${(n / 1_000).toFixed(0)}k`;
    }

    return String(n);
}

const movesLabel = computed(() => `${compact(Number(run.value?.movesEvaluated ?? 0))} moves`);

const elapsedLabel = computed(() => `${Math.round((run.value?.elapsedMillis ?? 0) / 1000)}s`);

const budgetFraction = computed(() => run.value?.progress ?? 0);

/** Names BOTH budgets, because either one can be what ends the run. */
const budgetCaption = computed(() => {
    const moves = run.value?.maxMoves ? compact(Number(run.value.maxMoves)) : '—';
    const seconds = run.value?.maxWallMillis ? Math.round(run.value.maxWallMillis / 1000) : '—';

    return `ends at ${moves} moves or ${seconds}s, whichever first`;
});

const doneSummary = computed(() => {
    const parts = ['Proposal ready'];

    if (doneMeta.value?.placements !== undefined) {
        parts.push(`${doneMeta.value.placements} placements`);
    }

    if (doneMeta.value?.hardViolations !== undefined) {
        const n = doneMeta.value.hardViolations;

        parts.push(`${n} issue${n === 1 ? '' : 's'}`);
    }

    return parts.join(' · ');
});

const failedSummary = computed(() => {
    if (run.value?.status === 'CANCELLED') {
        return 'Run cancelled — no proposal was produced.';
    }

    /**
     * A lost result is NOT a failed run: the solver succeeded and this app could
     * not retrieve the answer. The fix is to run it again, not to look for what
     * went wrong with the search.
     */
    if (run.value?.status === 'SUCCEEDED') {
        return 'The run succeeded, but its result could not be retrieved from the solver. '
            + 'Nothing was lost from the schedule — run it again to get a proposal.';
    }

    return run.value?.errorDetail || 'The run failed.';
});
</script>

<style scoped lang="scss">
.solver {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-5);
    align-items: center;

    &_advanced-toggle {
        cursor: pointer;

        border: 0;

        font-size: var(--font-size-xs);
        color: $content5;
        text-decoration: underline;

        background: none;
    }

    /*
     * THE TWO ANCHORED PANELS — the budget disclosure and the live report. In flow
     * they changed the toolbar's height (by ~120px and from 142px to 321px); a
     * control bar's height is page structure, a disclosure and a progress report
     * are transient content.
     *
     * Anchored to `.bar`, not `.solver`: nothing between is positioned, so
     * `top: 100%` is the bar's bottom edge. `.bar` carries the `z-index` that puts
     * these above the sticky side column.
     */
    &_advanced,
    &_panel {
        position: absolute;
        z-index: 1;
        top: calc(100% + var(--space-4));
        right: 0;

        /* Never wider than the viewport, never so narrow that the objective and
           its trend wrap. */
        width: min(360px, calc(100vw - var(--space-8)));
        padding: var(--space-6);
        border: 1px solid $surface3;
        border-radius: var(--radius-lg);

        background: $surface1;

        /* Offset and blur, so it reads as a layer above the grid. */
        box-shadow: 0 8px 24px rgb(0 0 0 / 32%);
    }

    &_advanced {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-5);
        align-items: flex-end;
    }

    &_panel {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
    }

    &_field {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);

        font-size: var(--font-size-xs);
        color: $content5;

        input {
            width: 130px;
            padding: var(--space-2) var(--space-3);
            border: 1px solid $surface4;
            border-radius: var(--radius-sm);

            font-size: var(--font-size-sm);
            color: $content1;

            background: $surface1;
        }
    }

    /*
     * The in-flow remainder of a live run: one line, the same height as the button
     * it replaces, so the actions area does not change size when a run starts.
     */
    &_live {
        display: flex;
        gap: var(--space-5);
        align-items: center;
    }

    &_live-head {
        display: flex;
        gap: var(--space-5);
        align-items: center;
    }

    &_status {
        display: flex;
        gap: var(--space-2);
        align-items: center;

        font-size: var(--font-size-sm);
        font-weight: 600;
        color: $content2;

        &--done {
            color: $content1;
        }

        &--failed {
            color: $content5;
        }
    }

    &_objective {
        display: flex;
        gap: var(--space-3);
        align-items: baseline;
    }

    &_objective-value {
        font-size: var(--font-size-md);
        font-weight: 600;
        color: $content1;
    }

    &_trend {
        font-size: var(--font-size-xs);
        color: $content5;

        &--stalled {
            font-weight: 600;
            color: $content2;
        }
    }

    &_counters {
        font-size: var(--font-size-xs);
        color: $content5;
    }

    &_budget {
        overflow: hidden;

        width: 100%;
        height: 6px;
        border-radius: var(--radius-sm);

        background: $surface4;
    }

    &_budget-fill {
        // `transform`, not `width`: this bar updates on every poll tick, and
        // animating a layout property re-lays the toolbar each time.
        transform-origin: left;

        display: block;

        height: 100%;

        background: $content5;

        transition: transform 0.4s ease;
    }

    &_hint {
        font-size: var(--font-size-xs);
        color: $content5;
    }

    &_confirm {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-3);
        align-items: center;

        margin-top: var(--space-2);

        font-size: var(--font-size-xs);
        color: $content2;
    }

    &_done {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-5);
        align-items: center;
    }

    /*
     * Server-supplied and unbounded: in flow, one long message wrapped to three
     * lines and took the bar with it. Stacks below the panels rather than beside
     * them — if both are visible, the error is the one that must not be hidden.
     */
    &_error {
        position: absolute;
        z-index: 2;
        top: calc(100% + var(--space-4));
        right: 0;

        width: min(360px, calc(100vw - var(--space-8)));
        padding: var(--space-5) var(--space-6);
        border: 1px solid $error500;
        border-radius: var(--radius-lg);

        font-size: var(--font-size-xs);
        color: $content2;

        background: $surface1;
        box-shadow: 0 8px 24px rgb(0 0 0 / 32%);
    }
}
</style>
