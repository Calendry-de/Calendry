<template>
    <!--
        THE OPENER MARKS A CHANGE OF MODE. Arriving here is deliberate and
        infrequent, and what follows is the only screen that can replace a whole
        term's timetable. Faster than the landing page's — a work surface, not an
        entrance — and it collapses under `prefers-reduced-motion`.
    -->
    <CommonPageOpener
        v-model="opening"
        :mark-size="140"
        :speed="1.6"
    >
        <div class="review">
        <header class="review_head">
            <div class="review_identity">
                <NuxtLink
                    to="/schedule/proposals"
                    class="review_back"
                >
                    <Icon
                        name="material-symbols:arrow-back"
                        aria-hidden="true"
                    />
                    All proposals
                </NuxtLink>

                <!--
                    "Review proposal v" with nothing after it is what this
                    rendered on a failed load: the heading asserted a proposal
                    that had not been read. The failure panel below names the
                    real state.
                -->
                <h1>
                    <template v-if="preview">Review proposal v{{ preview.generation.version }}</template>
                    <template v-else>Proposal</template>
                    <!--
                        The term was never named on this screen, though the
                        composable has resolved it all along. A department head
                        sent a link had no way to know which timetable they were
                        being asked to replace.
                    -->
                    <span
                        v-if="term"
                        class="review_term"
                    >for {{ term.name }}</span>
                </h1>

                <p
                    v-if="preview"
                    class="review_sub"
                >
                    {{ preview.generation.source === 'SOLVER' ? 'Solver proposal' : preview.generation.source }}
                    <span v-if="computedAgo">· computed {{ computedAgo }}</span>
                    <button
                        type="button"
                        class="review_refresh"
                        @click="refresh"
                    >
                        <Icon
                            name="material-symbols:refresh"
                            aria-hidden="true"
                        />
                        Refresh
                    </button>
                </p>
            </div>

            <!-- Only a READY proposal is awaiting a decision. -->
            <div
                v-if="isDecidable"
                class="review_actions"
            >
                <template v-if="canApply">
                    <!--
                        THE COMMIT. Apply used to be an unconfirmed primary button
                        identical to the "Review" one that navigated here, while
                        the only confirmation guarded Discard — which deletes
                        nothing. The friction was on the reversible action.
                        `secondary-black` so the affirmative control in the confirm
                        strip is the only primary-weight button in the flow.
                    -->
                    <CommonButton
                        type="secondary-black"
                        :disabled="busy || confirmApply"
                        @click="openConfirm('apply')"
                    >
                        <Icon
                            name="material-symbols:published-with-changes"
                            aria-hidden="true"
                        />
                        Apply…
                    </CommonButton>
                    <CommonButton
                        type="link"
                        :disabled="busy || confirmDiscard"
                        @click="openConfirm('discard')"
                    >Discard</CommonButton>
                </template>
                <!-- Static text, not disabled buttons: a disabled control reads
                     as "unavailable right now" rather than "not yours". -->
                <p
                    v-else
                    class="review_readonly"
                >You can review this proposal but not apply it.</p>
            </div>

            <p
                v-else-if="preview"
                class="review_state"
            >{{ terminalMessage }}</p>
        </header>

        <!--
            THE OUTCOME.

            `apply()` used to end in a silent `navigateTo('/schedule')`: the
            highest-stakes action in the product finishing as a screen change
            with no confirmation that it had worked and no statement of what it
            did. It now stays put and says so, and the proposal's own status —
            already rendered by `terminalMessage` above — corroborates it.
        -->
        <Transition name="review-outcome">
        <div
            v-if="outcome"
            class="review_outcome"
            :class="`review_outcome--${outcome.action}`"
            role="status"
        >
            <Icon
                :name="outcome.action === 'applied'
                    ? 'material-symbols:check-circle-outline'
                    : 'material-symbols:do-not-disturb-on-outline'"
                aria-hidden="true"
            />
            <span>
                <strong v-if="outcome.action === 'applied'">Applied.</strong>
                <strong v-else>Discarded.</strong>
                {{ outcome.action === 'applied'
                    ? `v${outcome.version} is now this term's schedule.`
                    : `v${outcome.version} stays on record and can no longer be applied.` }}
            </span>
            <CommonButton
                type="secondary"
                to="/schedule"
            >Open the schedule</CommonButton>
        </div>
        </Transition>

        <p
            v-if="applying"
            class="review_note"
            role="status"
        >
            <CommonLoader class="review_spinner" />
            Writing placements — a large proposal takes a few seconds.
        </p>

        <p
            v-if="discarding"
            class="review_note"
            role="status"
        >Discarding…</p>

        <p
            v-if="actionError"
            class="review_error"
            role="alert"
        >
            <Icon
                name="material-symbols:error"
                aria-hidden="true"
            />
            {{ actionError }}
        </p>

        <!--
            THE CONFIRM STRIP.

            Inline rather than a modal: nothing here needs protected focus, and
            the plan it restates is on the same screen — a modal would cover the
            evidence the reviewer is deciding from. Focus moves into it on open
            (which is what announces it), Escape backs out.
        -->
        <Transition name="review-commit">
        <div
            v-if="confirmApply && preview"
            class="review_confirm review_confirm--apply"
            @keydown.esc="closeConfirm"
        >
            <p class="review_confirm-title">Replace this term's timetable?</p>
            <p class="review_confirm-detail">{{ consequence }}</p>
            <p class="review_confirm-detail">
                Every locked session is left alone, and v{{ preview.generation.version }} stays on
                record — the schedule it replaces remains as an earlier version.
            </p>
            <div class="review_confirm-actions">
                <CommonButton
                    ref="confirmFocusEl"
                    type="primary"
                    :disabled="busy"
                    :aria-busy="applying"
                    @click="doApply"
                >{{ applying ? 'Applying…' : 'Apply this proposal' }}</CommonButton>
                <CommonButton
                    type="link"
                    :disabled="busy"
                    @click="closeConfirm"
                >Keep reviewing</CommonButton>
            </div>
        </div>
        </Transition>

        <Transition name="review-commit">
        <div
            v-if="confirmDiscard"
            class="review_confirm"
            @keydown.esc="closeConfirm"
        >
            <p class="review_confirm-title">Discard this proposal?</p>
            <p class="review_confirm-detail">
                It stays on record but can no longer be applied. Nothing on the
                current schedule changes.
            </p>
            <div class="review_confirm-actions">
                <CommonButton
                    ref="confirmFocusEl"
                    type="secondary-black"
                    :disabled="busy"
                    :aria-busy="discarding"
                    @click="doDiscard"
                >{{ discarding ? 'Discarding…' : 'Discard it' }}</CommonButton>
                <CommonButton
                    type="link"
                    :disabled="busy"
                    @click="closeConfirm"
                >Keep it</CommonButton>
            </div>
        </div>
        </Transition>

        <!--
            WHY THE LOAD ERROR IS TESTED FIRST.

            "Nothing to review" is a claim about the proposal, and may only be
            made once the proposal has been read. Below this branch the page used
            to state it on any failure — a 403 rendered "This proposal is
            undefined and is not awaiting a decision.", with `undefined` in the
            user-facing copy.
        -->
        <div
            v-if="loadError"
            class="review_failure"
            role="alert"
        >
            <Icon
                :name="loadError.kind === 'forbidden'
                    ? 'material-symbols:lock-outline'
                    : 'material-symbols:error-outline'"
                aria-hidden="true"
            />
            <h2>{{ loadError.title }}</h2>
            <p>{{ loadError.detail }}</p>
            <div class="review_failure-actions">
                <CommonButton
                    v-if="loadError.retryable"
                    type="secondary"
                    @click="refresh"
                >Try again</CommonButton>
                <CommonButton
                    type="link"
                    to="/schedule"
                >Back to the schedule</CommonButton>
            </div>
        </div>

        <!-- A Generation with no run proposes nothing; an empty grid would
             suggest it proposed an empty timetable. -->
        <p
            v-else-if="!preview?.run"
            class="review_empty"
        >
            Nothing to review — this Generation was not produced by a solver run.
        </p>

        <template v-else>
            <ScheduleReviewSummary
                :plan="preview.plan"
                :violations="preview.violations"
                :deleted-by-offering="preview.deletedByOffering"
                :run="preview.run"
            />

            <section
                class="review_grid-section"
                :aria-busy="weekPending"
            >
                <h2 class="review_grid-title">Where the sessions land</h2>

                <div class="review_controls">
                    <label class="review_field">
                        <span>Week</span>
                        <select
                            v-model.number="termWeek"
                            class="review_select"
                        >
                            <option
                                v-for="week in weekOptions"
                                :key="week.termWeek"
                                :value="week.termWeek"
                                :selected="week.termWeek === termWeek"
                            >Week {{ week.termWeek }}{{ week.label }}</option>
                        </select>
                    </label>

                    <label class="review_field">
                        <span>Group</span>
                        <select
                            v-model="groupId"
                            class="review_select"
                        >
                            <option
                                value=""
                                :selected="groupId === ''"
                            >All groups</option>
                            <option
                                v-for="group in groups"
                                :key="group.id"
                                :value="group.id"
                                :selected="group.id === groupId"
                            >{{ group.name }}</option>
                        </select>
                    </label>

                    <label class="review_field">
                        <span>Room</span>
                        <select
                            v-model="roomId"
                            class="review_select"
                        >
                            <option
                                value=""
                                :selected="roomId === ''"
                            >All rooms</option>
                            <option
                                v-for="room in rooms"
                                :key="room.id"
                                :value="room.id"
                                :selected="room.id === roomId"
                            >{{ room.name }}</option>
                        </select>
                    </label>

                    <!--
                        The person filter was implemented in three places — a ref
                        here, a watched query param, and a branch in the preview
                        route's `filterPlacements()` — and rendered nowhere, so
                        "what does this do to Dr. X?" was unanswerable.
                    -->
                    <label class="review_field">
                        <span>Person</span>
                        <select
                            v-model="personId"
                            class="review_select"
                        >
                            <option
                                value=""
                                :selected="personId === ''"
                            >Anyone</option>
                            <option
                                v-for="person in people"
                                :key="person.id"
                                :value="person.id"
                                :selected="person.id === personId"
                            >{{ person.name }}</option>
                        </select>
                    </label>

                    <!--
                        Density, the same three steps the schedule toolbar
                        offers. DESIGN.md makes row height a user-adjustable
                        property and this screen opted out of it with a
                        hardcoded 60 — on a proposal that touches a crowded week
                        there is a lot to read in one block.
                    -->
                    <label class="review_field">
                        <span>Density</span>
                        <select
                            v-model.number="rowHeight"
                            class="review_select review_select--narrow"
                        >
                            <option
                                v-for="option in DENSITIES"
                                :key="option.value"
                                :value="option.value"
                                :selected="option.value === rowHeight"
                            >{{ option.label }}</option>
                        </select>
                    </label>

                    <label class="review_check">
                        <input
                            v-model="changesOnly"
                            type="checkbox"
                        >
                        <span>Changes only</span>
                    </label>
                </div>

                <p
                    v-if="weekPending"
                    class="review_note"
                    role="status"
                >Loading week {{ termWeek }}…</p>

                <template v-if="grid">
                    <ScheduleReviewGrid
                        class="review_week-grid"
                        :grid="grid"
                        :placements="placements"
                        :row-height="rowHeight"
                        :lookup="lookup"
                        :empty-message="emptyMessage"
                    />

                    <ScheduleReviewAgenda
                        class="review_week-agenda"
                        :grid="grid"
                        :placements="placements"
                        :lookup="lookup"
                        :empty-message="emptyMessage"
                    />
                </template>
            </section>
        </template>
        </div>
    </CommonPageOpener>
</template>

<script setup lang="ts">
import CommonButton from '~/components/common/CommonButton.vue';
import CommonLoader from '~/components/common/CommonLoader.vue';
import CommonPageOpener from '~/components/common/CommonPageOpener.vue';
import ScheduleReviewAgenda from '~/components/schedule/ScheduleReviewAgenda.vue';
import ScheduleReviewGrid from '~/components/schedule/ScheduleReviewGrid.vue';
import ScheduleReviewSummary from '~/components/schedule/ScheduleReviewSummary.vue';
import { applyConsequence, useGenerationReview } from '~/composables/generationReview';
import { useHasPermission } from '~/composables/session';

/**
 * Gated on `generation.read` — the one permission everything this page reads
 * sits behind. Deliberately NOT the six-permission `schedule` middleware: every
 * reference fetch here is tolerant, so a caller who may read proposals but not
 * rooms gets ids instead of names rather than a refusal. Without any guard, a
 * caller lacking it reached this page and was told the proposal was "undefined".
 */
definePageMeta({ middleware: 'review' });

const route = useRoute();
const generationId = String(route.params.id);

const {
    preview, grid, groups, rooms, people, lookup, term, loadError, weekCount,
    termWeek, groupId, roomId, personId, changesOnly, placements, weekPending,
    applying, discarding, busy, outcome, actionError, apply, discard, refresh, ready,
} = useGenerationReview(generationId);

const canApply = useHasPermission('generation.apply');

/**
 * Plays on arrival, every time — deliberately unlike the landing page, which
 * gates its opener on a first-visit cookie.
 *
 * The reasoning differs because the visit does: the landing page is entered
 * repeatedly by the same person and a replayed intro there is friction, while
 * this screen is opened once per proposal to make one decision. Suppressing it
 * after the first would mean the beat is missing exactly when the reviewer is
 * least used to being here.
 */
const opening = ref(true);

const confirmApply = ref(false);
const confirmDiscard = ref(false);
const confirmFocusEl = ref<{ $el?: HTMLElement } | null>(null);

/**
 * Density, from the same three-step scale the schedule uses.
 *
 * Defaults to the ROOMIEST step rather than the middle one, which is the
 * opposite of the live schedule's default and deliberate: a timetabler scanning
 * their own week wants to see as much of it at once as possible, while a
 * reviewer is reading four lines per chip — action, offering, room, and where it
 * moved from — and deciding whether to accept them.
 */
const DENSITIES = [
    { value: 60, label: 'Compact' },
    { value: 84, label: 'Comfortable' },
    { value: 112, label: 'Spacious' },
];

const rowHeight = ref(84);

// The single top-level await, per the composable convention.
await ready;

useHead({
    title: computed(() => (preview.value
        ? `Proposal v${preview.value.generation.version}`
        : 'Proposal')),
});

const isDecidable = computed(() => preview.value?.generation.status === 'READY');

/**
 * The proposal's status as a sentence — for a status that EXISTS.
 *
 * The fallback used to interpolate the raw value, so a null preview rendered
 * "This proposal is undefined and is not awaiting a decision." Nothing reaches
 * the template now without a status, but the guard stays: this is a
 * user-facing template literal over a value from the wire, and the failure mode
 * was a confident falsehood rather than a blank.
 */
const terminalMessage = computed(() => {
    const status = preview.value?.generation.status;

    if (!status) {
        return '';
    }

    if (status === 'APPLIED') {
        return preview.value?.generation.isCurrent
            ? 'Applied — this is the current schedule.'
            : 'Applied, and since superseded.';
    }

    if (status === 'SUPERSEDED') {
        return 'Discarded or superseded — no longer applicable.';
    }

    return `This proposal is ${status.toLowerCase()} and is not awaiting a decision.`;
});

const consequence = computed(() => (preview.value
    ? applyConsequence(preview.value.plan, preview.value.violations.proposed.hard)
    : ''));

const emptyMessage = computed(() => (changesOnly.value
    ? 'Nothing changes in this week.'
    : 'No placements in this week.'));

/**
 * EVERY week of the term, annotated with what happens in it.
 *
 * Built from the term's own length, not from `weekSummary` — that only contains
 * weeks which RECEIVE placements, so a proposal pulling 258 sessions into weeks
 * 1–5 of 13 made weeks 6–13 unselectable. Those are exactly the weeks being
 * emptied, and the reviewer could not look at one. Falls back to the summary's
 * own weeks when the term could not be read.
 */
const weekOptions = computed(() => {
    const summary = preview.value?.weekSummary ?? [];
    const byWeek = new Map(summary.map((week) => [week.termWeek, week]));
    const total = weekCount.value;

    const weeks = total && total > 0
        ? Array.from({ length: total }, (_, index) => index + 1)
        : summary.map((week) => week.termWeek);

    if (!weeks.length) {
        return [{ termWeek: 1, label: '' }];
    }

    return weeks.map((termWeek) => {
        const week = byWeek.get(termWeek);
        const changed = week ? week.created + week.moved + week.deleted : 0;

        if (!week) {
            return { termWeek, label: ' — untouched' };
        }

        return {
            termWeek,
            label: changed
                ? ` — ${changed} change${changed === 1 ? '' : 's'}`
                : ' — no changes',
        };
    });
});

/**
 * How stale the snapshot is — and it must be allowed to say.
 *
 * Two bugs lived here. The value was a `computed` over `Date.now()`, whose only
 * reactive dependency was the fetch, so it read "just now" for as long as the
 * tab stayed open; and a MISSING timestamp also returned "just now", which is a
 * staleness signal that fails open. It now ticks, and says nothing rather than
 * something reassuring when it does not know.
 */
const now = ref(Date.now());

onMounted(() => {
    const timer = setInterval(() => {
        now.value = Date.now();
    }, 30_000);

    onUnmounted(() => clearInterval(timer));
});

const computedAgo = computed(() => {
    const at = preview.value?.computedAt;

    if (!at) {
        return '';
    }

    const minutes = Math.floor((now.value - new Date(at).getTime()) / 60_000);

    if (minutes < 1) {
        return 'just now';
    }

    return minutes < 60
        ? `${minutes} minute${minutes === 1 ? '' : 's'} ago`
        : `over ${Math.floor(minutes / 60)}h ago — refresh before applying`;
});

/**
 * A confirm strip must not outlive the question it asks.
 *
 * If the proposal stops being READY while the strip is open — someone else
 * applied it, or a re-read landed — the strip would go on asking "replace this
 * term's timetable?" about something that can no longer be applied, and its
 * button would fail on a decision the reviewer had every reason to think was
 * live. Closing it puts the terminal state in its place, which is the answer.
 */
watch(isDecidable, (decidable) => {
    if (!decidable) {
        closeConfirm();
    }
});

/** One confirm at a time, and focus follows it — that is what announces it. */
async function openConfirm(action: 'apply' | 'discard') {
    confirmApply.value = action === 'apply';
    confirmDiscard.value = action === 'discard';

    await nextTick();
    confirmFocusEl.value?.$el?.focus();
}

function closeConfirm() {
    confirmApply.value = false;
    confirmDiscard.value = false;
}

async function doApply() {
    await apply();

    if (!actionError.value) {
        closeConfirm();
    }
}

async function doDiscard() {
    await discard();

    if (!actionError.value) {
        closeConfirm();
    }
}

/**
 * Land on the first week that actually changed, rather than week 1 by default.
 *
 * Created AFTER `await ready`, so the `immediate` callback sees a populated
 * preview — the SSR trap this codebase has hit three times is a watcher that
 * seeds first-render state before its data exists.
 */
watch(preview, (value) => {
    const first = value?.weekSummary?.find((w) => w.created + w.moved + w.deleted > 0);

    if (first) {
        termWeek.value = first.termWeek;
    }
}, { immediate: true });
</script>

<style scoped lang="scss">
.review {
    display: flex;
    flex-direction: column;

    /*
     * A DELIBERATELY LOOSER RHYTHM than the rest of the app.
     *
     * Every other surface here is dense because its job is to show a lot at
     * once. This one asks for a decision, and it was presenting the summary,
     * five filters, a violation breakdown, the run facts, the deletions list and
     * a week grid in one uninterrupted column at the app's standard 16px gap.
     * The sections are now separated more than their contents are, so the eye
     * can find where one argument ends and the next begins.
     */
    gap: var(--space-9);
    padding: var(--space-8);

    &_head {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-5);
        align-items: flex-start;
        justify-content: space-between;

        h1 {
            display: flex;
            flex-wrap: wrap;
            gap: var(--space-4);
            align-items: baseline;

            font-size: var(--font-size-xl);
            color: $content1;
        }
    }

    &_identity {
        display: flex;
        flex-direction: column;
        gap: var(--space-3);
    }

    &_term {
        font-size: var(--font-size-md);
        font-weight: 400;
        color: $content6;
    }

    &_back,
    &_refresh {
        display: inline-flex;
        gap: var(--space-3);
        align-items: center;

        // 44px of vertical target on a control that reads as inline text: the
        // padding is negative-margined back out so the rhythm is unchanged.
        min-height: 44px;
        margin: calc(var(--space-5) * -1) 0;
        padding: var(--space-5) 0;
        border: 0;

        font-family: inherit;
        color: $content6;

        background: none;

        svg {
            width: 15px;
            height: 15px;
        }
    }

    &_back {
        font-size: var(--font-size-sm);
        text-decoration: none;

        @include hover() {
            &:hover {
                color: $content2;
                text-decoration: underline;
            }
        }
    }

    &_refresh {
        cursor: pointer;
        font-size: var(--font-size-xs);
        text-decoration: underline;
        text-underline-offset: 2px;
    }

    &_sub {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-4);
        align-items: center;

        font-size: var(--font-size-sm);
        font-variant-numeric: tabular-nums;
        color: $content6;
    }

    &_actions {
        display: flex;
        gap: var(--space-4);
        align-items: center;
    }

    &_readonly,
    &_state,
    &_note,
    &_empty {
        font-size: var(--font-size-sm);
        color: $content6;
    }

    &_note {
        display: flex;
        gap: var(--space-4);
        align-items: center;
    }

    &_spinner {
        width: 15px;
        height: 15px;
    }

    &_empty {
        padding: var(--space-8);
        border-radius: var(--radius-lg);
        text-align: center;
        background: $surface1;
    }

    &_outcome {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-5);
        align-items: center;

        padding: var(--space-5) var(--space-6);
        border-left: var(--space-1) solid $content5;
        border-radius: var(--radius-lg);

        font-size: var(--font-size-md);
        color: $content2;

        background: $surface1;

        svg {
            flex: none;
            width: 20px;
            height: 20px;
        }

        span { flex: 1 1 20ch; }

        &--applied {
            border-left-color: $success600;
            background: varToRgba('success600', 0.1);

            svg { color: $success700; }
        }
    }

    &_error {
        display: flex;
        gap: var(--space-4);
        align-items: center;

        font-size: var(--font-size-sm);
        color: $error700;

        svg {
            flex: none;
            width: 16px;
            height: 16px;
        }
    }

    // A load failure is a page state, not a line of text: it replaces the
    // content rather than sitting above an empty version of it.
    &_failure {
        display: flex;
        flex-direction: column;
        gap: var(--space-4);
        align-items: center;

        padding: var(--space-9) var(--space-6);
        border-radius: var(--radius-lg);

        text-align: center;

        background: $surface1;

        svg {
            width: 28px;
            height: 28px;
            color: $content6;
        }

        h2 {
            font-size: var(--font-size-lg);
            color: $content1;
        }

        p {
            max-width: 52ch;
            font-size: var(--font-size-md);
            color: $content6;
        }
    }

    &_failure-actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-4);
        align-items: center;

        margin-top: var(--space-3);
    }

    /*
     * THE AUTHORED MOMENT ON THIS SCREEN — DESIGN.md allows one per surface. The
     * strip arrives with weight (240ms, rising out of a slight compression) because
     * it asks the one irreversible-feeling question the product has, and leaves in
     * 140ms so backing out feels like nothing happened.
     */
    &_confirm {
        display: flex;
        flex-direction: column;
        gap: var(--space-3);

        padding: var(--space-6);
        border-left: var(--space-1) solid $surface5;
        border-radius: var(--radius-lg);

        color: $content2;

        background: $surface1;

        // The one place on this screen where the weight matches the stakes.
        &--apply {
            border-left-color: $error600;
            background: varToRgba('error600', 0.08);
        }
    }

    &_confirm-title {
        font-size: var(--font-size-lg);
        font-weight: 600;
        color: $content1;
    }

    &_confirm-detail {
        max-width: 68ch;
        font-size: var(--font-size-md);
        font-variant-numeric: tabular-nums;
        color: $content6;
    }

    &_confirm-actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-4);
        align-items: center;

        margin-top: var(--space-3);
    }

    &_grid-section {
        display: flex;
        flex-direction: column;
        gap: var(--space-6);
    }

    &_grid-title {
        font-size: var(--font-size-lg);
        color: $content2;
    }

    &_controls {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-5) var(--space-6);
        align-items: flex-end;

        padding: var(--space-5) var(--space-6);
        border-radius: var(--radius-lg);

        background: $surface1;
    }

    &_field {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);

        > span {
            font-size: var(--font-size-xs);
            font-weight: 600;
            color: $content6;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }
    }

    &_select {
        cursor: pointer;

        min-width: 150px;
        // 44px: a filter row is the most-touched thing on the mobile
        // presentation, and these were ~30px.
        min-height: 44px;
        padding: var(--space-3) var(--space-4);
        border: 1px solid $content7;
        border-radius: var(--radius-md);

        font-family: inherit;
        font-size: var(--font-size-md);
        color: $content2;

        background: $surface0;

        &--narrow { min-width: 128px; }
    }

    &_check {
        display: flex;
        gap: var(--space-3);
        align-items: center;

        min-height: 44px;

        font-size: var(--font-size-sm);
        color: $content6;

        input {
            width: 18px;
            height: 18px;
            accent-color: $primary600;
        }
    }

    /*
     * THE PRESENTATION SWAP, the same one `/schedule` makes at the same
     * breakpoint: below 1365px the week grid is REPLACED, not scaled. Six
     * unbreakable columns of 11px text is not a mobile view of anything.
     */
    &_week-agenda { display: none; }

    @include mobile() {
        gap: var(--space-7);
        padding: var(--space-5);

        &_week-grid { display: none; }
        &_week-agenda { display: flex; }

        &_head {
            flex-direction: column;
            align-items: stretch;
        }

        &_actions {
            flex-wrap: wrap;
            justify-content: flex-start;
        }

        &_field { flex: 1 1 140px; }
        &_select { width: 100%; }
    }
}

.review-commit-enter-active {
    transition:
        opacity 240ms cubic-bezier(0.16, 1, 0.3, 1),
        transform 240ms cubic-bezier(0.16, 1, 0.3, 1);
}

.review-commit-leave-active {
    transition:
        opacity 140ms cubic-bezier(0.16, 1, 0.3, 1),
        transform 140ms cubic-bezier(0.16, 1, 0.3, 1);
}

.review-commit-enter-from {
    transform: translateY(10px) scale(0.985);
    opacity: 0;
}

.review-commit-leave-to {
    transform: translateY(-4px);
    opacity: 0;
}

/*
 * The outcome SETTLES rather than arrives: it is the end of the movement the
 * confirm strip started, and the one thing on the screen the reviewer waited
 * for. Slightly longer, and it comes up rather than down — the decision is
 * behind them now.
 */
.review-outcome-enter-active {
    transition:
        opacity 280ms cubic-bezier(0.16, 1, 0.3, 1),
        transform 280ms cubic-bezier(0.16, 1, 0.3, 1);
}

.review-outcome-enter-from {
    transform: translateY(-8px) scale(0.99);
    opacity: 0;
}
</style>