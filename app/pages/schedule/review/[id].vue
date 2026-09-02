<template>
    <CommonPageOpener
        v-model="opening"
        :mark-size="140"
        :speed="1.6"
    >
        <!--
            THE OPENER MARKS A CHANGE OF MODE. Arriving here is deliberate and
            infrequent, and what follows is the only screen that can replace a
            whole term's timetable. Faster than the landing page's: a work
            surface, not an entrance. It collapses under
            `prefers-reduced-motion`.

            Inside the root rather than above it: a comment beside the single
            root element counts as a second root to `vue/no-multiple-template-root`,
            which failed `bun run lint` for the whole repo.
        -->
        <div
            class="review"
            :class="{ 'review--committing': confirmApply || confirmDiscard }"
        >
        <!--
            DIRECTION CONTRACT: surface redesign, seed key calendry-review-01.

            THESIS: A proposal is reviewed by Offering, not by slot. Refuses the
            dashboard arrangement of counters over a week grid, which answers
            "what is in week 4" and never "what does this do".

            OWN-WORLD: Inherited, not replaced, using Noto Sans, the surface/content
            ramps and the chip and grid vocabulary shared with /schedule. One
            correction: raised surfaces are $surface2, because $surface1 panels on
            a $surface1 body were invisible in both themes.

            STORY: The reviewer learns what state this proposal is in, sees what
            it does to each Offering, drills into the grid for one of them, and
            decides.

            FIRST VIEWPORT: Identity, then a full-width state band, then the risk
            line, then the change list. Apply sits top-right with the identity.

            FORM: The Change List, candidate 5 of 7, chosen over the roll's lead.

            FINISH: unreviewed and undocumented is unfinished; this build ends
            with the finish review, the verdict, and DESIGN.md.
        -->
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
                    <!--
                        THE IMPERATIVE IS WITHDRAWN when there is nothing to
                        decide. "Review proposal v2" at 24px above a band saying
                        "Nothing here is awaiting a decision" is the contradiction
                        the band was added to resolve, and adding the band did not
                        resolve it: the largest type on the page still ordered a
                        review of something already settled.
                    -->
                    <template v-if="preview">{{ isDecidable ? 'Review proposal' : 'Proposal' }}
                        v{{ preview.generation.version }}</template>
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
                    <!--
                        The staleness notice beside this button tells the reviewer
                        to press it; for two sequential round trips it then
                        reported nothing at all.
                    -->
                    <button
                        type="button"
                        class="review_refresh"
                        :disabled="refreshing"
                        :aria-busy="refreshing"
                        @click="refresh"
                    >
                        <Icon
                            :name="refreshing
                                ? 'material-symbols:progress-activity'
                                : 'material-symbols:refresh'"
                            :class="{ 'review_refresh-spin': refreshing }"
                            aria-hidden="true"
                        />
                        {{ refreshing ? 'Refreshing…' : 'Refresh' }}
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
                        the only confirmation guarded Discard, which deletes
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

        </header>

        <!--
            THE STATE BAND is the fix for the complaint that opened this redesign:
            "one doesn't know what to do on this page".

            A proposal that is not READY is not asking for anything, and the page
            never said so with any weight. It said "Review proposal v2" at 24px,
            an imperative to review something already decided, and put
            "Applied: this is the current schedule." in 12px `$content6`,
            floated to the far right by `justify-content: space-between`, roughly
            1500px from the heading at 1920. Two of the three most valuable facts
            on the screen ("this is already live", "this changes nothing") were
            the two stated least loudly or, in the second case, nowhere at all.

            Full width, at reading weight, directly under the identity, and it
            carries the action that IS available, opening the schedule, so the
            page has something to do even when there is nothing to decide.

            Suppressed while the outcome banner is up: that banner states the
            same fact better, and it is the authored end of the apply movement.
        -->
        <div
            v-if="!isDecidable && preview && !outcome"
            class="review_band"
            :class="`review_band--${terminal.kind}`"
        >
            <Icon
                :name="terminal.icon"
                aria-hidden="true"
            />
            <div class="review_band-text">
                <p class="review_band-title">{{ terminal.title }}</p>
                <p class="review_band-detail">{{ terminal.detail }}</p>
            </div>
            <CommonButton
                type="secondary"
                :to="scheduleUrl"
            >Open the schedule</CommonButton>
        </div>

        <!--
            THE OUTCOME.

            `apply()` used to end in a silent `navigateTo('/schedule')`: the
            highest-stakes action in the product finishing as a screen change
            with no confirmation that it had worked and no statement of what it
            did. It now stays put and says so, and the proposal's own status,
            already rendered by `terminalMessage` above, corroborates it.
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
                :to="scheduleUrl"
            >Open the schedule</CommonButton>
        </div>
        </Transition>

        <p
            v-if="applying"
            class="review_note"
            role="status"
        >
            <CommonLoader class="review_spinner" />
            Writing placements. A large proposal takes a few seconds.
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
            the plan it restates is on the same screen; a modal would cover the
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
                record; the schedule it replaces remains as an earlier version.
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
            to state it on any failure: a 403 rendered "This proposal is
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
                    :to="scheduleUrl"
                >Back to the schedule</CommonButton>
            </div>
        </div>

        <!-- A Generation with no run proposes nothing; an empty grid would
             suggest it proposed an empty timetable. -->
        <p
            v-else-if="!preview?.run"
            class="review_empty"
        >
            Nothing to review: this Generation was not produced by a solver run.
        </p>

        <template v-else>
            <ScheduleReviewSummary
                :plan="preview.plan"
                :violations="preview.violations"
                :run="preview.run"
                :demand="preview.demand"
                :decidable="isDecidable"
            />

            <section
                class="review_evidence"
                :aria-busy="weekPending"
            >
                <div class="review_evidence-head">
                    <h2 class="review_grid-title">{{ view === 'list'
                        ? 'What this proposal changes'
                        : 'Where the sessions land' }}</h2>

                    <!--
                        THE VIEW SWITCH, and the default is the redesign.

                        `list` leads because the week grid answers "what is in
                        week 4" and never "what does this proposal do": a run
                        moving 187 of 260 sessions spreads them over a nineteen-
                        week term, so auditing it through the week picker was
                        thirteen `<select>` interactions: a search, not a review.
                        The grid is now where you go once you know which Offering
                        you are checking, which is what `Show in the grid` does.
                    -->
                    <div
                        class="review_views"
                        role="group"
                        aria-label="Evidence view"
                    >
                        <button
                            type="button"
                            class="review_view"
                            :class="{ 'review_view--on': view === 'list' }"
                            :aria-pressed="view === 'list'"
                            @click="view = 'list'"
                        >By offering</button>
                        <button
                            type="button"
                            class="review_view"
                            :class="{ 'review_view--on': view === 'grid' }"
                            :aria-pressed="view === 'grid'"
                            @click="view = 'grid'"
                        >Week grid</button>
                    </div>
                </div>

                <!--
                    The term-level totals, in one line, stating only what is
                    non-zero. A per-Offering list cannot carry a term total, and
                    dropping the old facts row took it with it.
                -->
                <p
                    v-if="totals.length"
                    class="review_totals"
                >
                    <span
                        v-for="part in totals"
                        :key="part.label"
                        :class="`review_total--${part.kind}`"
                    ><strong>{{ part.value }}</strong> {{ part.label }}</span>
                </p>

                <!--
                    Removals get their consequence stated once, next to the list
                    that names them, rather than in a second block of their own.
                -->
                <p
                    v-if="preview.plan.deleted > 0"
                    class="review_destructive"
                >
                    <Icon
                        name="material-symbols:delete-outline"
                        aria-hidden="true"
                    />
                    {{ preview.plan.deleted }}
                    session{{ preview.plan.deleted === 1 ? '' : 's' }} will be removed. The
                    solver could not place these; applying deletes them rather than leaving
                    them where it rejected them.
                </p>

                <ScheduleReviewChanges
                    v-if="view === 'list'"
                    :rows="preview.changesByOffering.rows"
                    :untouched-offerings="preview.changesByOffering.untouchedOfferings"
                    @show="showInGrid"
                />

                <template v-else>
                <!--
                    The filters belong to the GRID, not to the page, and now
                    render only with it. In list view they narrowed nothing a
                    reviewer could see: six controls above a term-wide list that
                    ignores five of them, which is most of the "wall of options"
                    the filter row had become.
                -->
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
                        The person filter was implemented in three places: a ref
                        here, a watched query param, and a branch in the preview
                        route's `filterPlacements()`. It rendered nowhere, so
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
                        hardcoded 60, because on a proposal that touches a crowded week
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

                <!--
                    THE DRILL-IN, made visible and reversible.

                    Arriving from "Show in the grid" narrows the grid to one
                    Offering. An active narrowing that says nothing is how a
                    filtered grid and an empty week become the same picture, the
                    exact failure this codebase already recorded once. It renders
                    whenever it is active and carries its own clear.
                -->
                <p
                    v-if="offeringId"
                    class="review_drill"
                >
                    <span>Showing {{ lookup.offering(offeringId) }} only</span>
                    <button
                        type="button"
                        class="review_drill-clear"
                        @click="offeringId = ''"
                    >
                        Show the whole week
                        <Icon
                            name="material-symbols:close"
                            aria-hidden="true"
                        />
                    </button>
                </p>

                <p
                    v-if="weekPending"
                    class="review_note"
                    role="status"
                >Loading week {{ termWeek }}…</p>

                <template v-if="grid">
                    <!--
                        AN EMPTY WEEK REPLACES THE GRID; it used to trail it.

                        The message lived inside `ScheduleReviewGrid` as the last
                        child of the grid element with `grid-column: 1 / -1` and
                        no `grid-row`. Every row being explicitly assigned, it
                        auto-placed into a NEW row after all of them: measured,
                        869.75px of empty cells and hatched break bands, then the
                        sentence 762.75px below the grid's top edge. The reviewer
                        scrolled a full screen of nothing to be told there was
                        nothing, and on a proposal that changes one week of
                        thirteen, that is the common case, not the edge.

                        Deciding it here rather than in either presentation also
                        means one answer for both: the grid's condition was
                        week-level while the agenda's is day-level, and only the
                        week-level one belongs to the page.
                    -->
                    <p
                        v-if="!placements.length"
                        class="review_week-empty"
                    >{{ emptyMessage }}</p>

                    <!--
                        THE GRID STOPS ASSERTING A WEEK IT IS NO LONGER SHOWING.

                        `weekData.data` keeps its last value across a refetch, so
                        changing the week rendered "Loading week 5…" above week
                        4's placements, at full strength, for the length of the
                        request: two contradictory truths on screen, and the
                        more legible one was the wrong one. `aria-busy` on the
                        section already said so; nothing visual did.
                    -->
                    <template v-else>
                        <ScheduleReviewGrid
                            class="review_week-grid"
                            :class="{ 'review_week--stale': weekPending }"
                            :grid="grid"
                            :placements="placements"
                            :row-height="rowHeight"
                            :lookup="lookup"
                        />

                        <ScheduleReviewAgenda
                            class="review_week-agenda"
                            :class="{ 'review_week--stale': weekPending }"
                            :grid="grid"
                            :placements="placements"
                            :lookup="lookup"
                            :empty-message="dayEmptyMessage"
                        />
                    </template>
                </template>
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
import ScheduleReviewChanges from '~/components/schedule/ScheduleReviewChanges.vue';
import ScheduleReviewGrid from '~/components/schedule/ScheduleReviewGrid.vue';
import ScheduleReviewSummary from '~/components/schedule/ScheduleReviewSummary.vue';
import { applyConsequence, useGenerationReview } from '~/composables/generationReview';
import { scheduleLinkForTerm } from '~/composables/scheduleFilters';
import { useHasPermission } from '~/composables/session';

/**
 * Gated on `generation.read`, the one permission everything this page reads
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
    termWeek, groupId, roomId, personId, changesOnly, offeringId, view, showInGrid,
    placements, weekPending,
    applying, discarding, busy, refreshing, outcome, actionError, apply, discard,
    refresh, ready,
} = useGenerationReview(generationId);

const canApply = useHasPermission('generation.apply');

/**
 * #75: the run's own `termId`, not the resolved `term` above: that one is
 * null whenever `/api/terms` came back empty or forbidden, even though the id
 * itself was in the preview all along. Both "Open the schedule" links use
 * this so the schedule opens on the Term just reviewed, not whichever Term
 * `startDate: 'desc'` sorts first.
 */
const scheduleUrl = computed(() => scheduleLinkForTerm(preview.value?.run?.termId ?? null));

/**
 * Plays on arrival, every time, deliberately unlike the landing page, which
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
 * reviewer is reading four lines per chip (action, offering, room, and where it
 * moved from) and deciding whether to accept them.
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
 * The proposal's state as a headline, a detail, and an icon.
 *
 * Was one 12px sentence. A sentence is the right amount of text and was the
 * wrong amount of emphasis: the state decides whether this page is a decision
 * surface or a record, and it was the quietest thing on it.
 *
 * `changesNothing` is the fact the old screen never stated ANYWHERE. The
 * consequence string in `applyConsequence()` can say "no placement changes",
 * but it renders only inside the confirm strip, which a non-READY proposal never
 * shows, so a proposal that reproduced 142 sessions exactly reported
 * "0 added · 0 moved · 142 unchanged · 0 removed" and left the reader to
 * subtract. It is said here instead, in words.
 *
 * The fallback still guards a status it does not know: this is a user-facing
 * template literal over a value from the wire, and the failure mode was a
 * confident falsehood ("This proposal is undefined and is not awaiting a
 * decision.") rather than a blank.
 */
const terminal = computed(() => {
    const generation = preview.value?.generation;
    const status = generation?.status;

    /*
     * WHY THERE IS NO "it changes nothing" CLAUSE HERE.
     *
     * The band said "It changes nothing: every session stays exactly where it
     * is." and then, three hundred pixels lower, the change section said "This
     * proposal changes nothing." One fact twice in one viewport, at two weights.
     * The division is now clean: the band owns STATE ("this is the current
     * schedule"), the change section owns CHANGE. `changesNothing` survives
     * because the band still needs it to stay quiet.
     */

    if (!status) {
        return { kind: 'neutral', icon: 'material-symbols:info-outline', title: '', detail: '' };
    }

    if (status === 'APPLIED' && generation?.isCurrent) {
        return {
            kind: 'current',
            icon: 'material-symbols:check-circle-outline',
            title: 'This is the current schedule',
            detail: `v${generation.version} was applied and is what this term runs on.`
                + ' Nothing here is awaiting a decision.',
        };
    }

    if (status === 'APPLIED') {
        return {
            kind: 'neutral',
            icon: 'material-symbols:history',
            title: 'Applied, and since replaced',
            detail: `v${generation.version} was applied, then a later proposal took over.`
                + ' It is a record now.',
        };
    }

    if (status === 'SUPERSEDED') {
        return {
            kind: 'neutral',
            icon: 'material-symbols:do-not-disturb-on-outline',
            title: 'No longer applicable',
            detail: 'This proposal was discarded or superseded. It stays on record'
                + ' and can no longer be applied.',
        };
    }

    return {
        kind: 'neutral',
        icon: 'material-symbols:info-outline',
        title: `This proposal is ${status.toLowerCase()}`,
        detail: 'It is not awaiting a decision.',
    };
});

const consequence = computed(() => (preview.value
    ? applyConsequence(preview.value.plan, preview.value.violations.proposed.hard)
    : ''));

const emptyMessage = computed(() => (changesOnly.value
    ? 'Nothing changes in this week.'
    : 'No placements in this week.'));

/**
 * The DAY-level counterpart, for the agenda only.
 *
 * Both presentations were handed `emptyMessage`, but their conditions are not
 * the same question: the grid's fired when the whole WEEK was empty, the
 * agenda's fires when the selected DAY is. Sharing one string meant a Tuesday
 * with nothing on it, inside a week with plenty, said "Nothing changes in this
 * week." The week-level claim now belongs to the page, which is the only place
 * that can replace the grid rather than sit inside it.
 */
const dayEmptyMessage = computed(() => (changesOnly.value
    ? 'Nothing changes on this day.'
    : 'No placements on this day.'));

/**
 * The term-level totals, and only the non-zero ones.
 *
 * `unchanged` is deliberately absent: it is the count that made the old facts
 * row unreadable ("0 added · 0 moved · 142 unchanged · 0 removed" on a proposal
 * that does nothing), and the change list already states the reproduced set as
 * a sentence. Empty when nothing changes at all, because the state band says so
 * in words and a row of zeroes says it worse.
 */
const totals = computed(() => {
    const plan = preview.value?.plan;

    if (!plan) {
        return [];
    }

    const parts: { kind: string; value: number; label: string }[] = [];

    if (plan.deleted > 0) {
        parts.push({ kind: 'deleted', value: plan.deleted, label: 'removed' });
    }

    if (plan.created > 0) {
        parts.push({ kind: 'created', value: plan.created, label: 'added' });
    }

    if (plan.moved > 0) {
        parts.push({ kind: 'moved', value: plan.moved, label: 'moved' });
    }

    /**
     * The collateral count rides WITH the moves it qualifies, never as its own
     * statistic: "12 of them outside what you asked for" is only meaningful next
     * to the number it is a subset of. The rows that make it up carry the same
     * fact individually.
     *
     * `?? 0` because the field is optional by design, not by accident: a
     * Generation captured before the counter existed has no value, and those runs
     * were all hard locked, so "the same as none" is the honest reading. The
     * type's own comment prescribes exactly this.
     */
    const collateral = plan.movedCollateral ?? 0;

    if (collateral > 0) {
        parts.push({
            kind: 'collateral',
            value: collateral,
            label: 'of those moves were not asked for',
        });
    }

    return parts;
});

/**
 * EVERY week of the term, annotated with what happens in it.
 *
 * Built from the term's own length, not from `weekSummary`, which only contains
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
            return { termWeek, label: ': untouched' };
        }

        return {
            termWeek,
            label: changed
                ? `: ${changed} change${changed === 1 ? '' : 's'}`
                : ': no changes',
        };
    });
});

/**
 * How stale the snapshot is, and it must be allowed to say so.
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
        : `over ${Math.floor(minutes / 60)}h ago, refresh before applying`;
});

/**
 * A confirm strip must not outlive the question it asks.
 *
 * If the proposal stops being READY while the strip is open (someone else
 * applied it, or a re-read landed), the strip would go on asking "replace this
 * term's timetable?" about something that can no longer be applied, and its
 * button would fail on a decision the reviewer had every reason to think was
 * live. Closing it puts the terminal state in its place, which is the answer.
 */
watch(isDecidable, (decidable) => {
    if (!decidable) {
        closeConfirm();
    }
});

/** One confirm at a time, and focus follows it: that is what announces it. */
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
 * preview. The SSR trap this codebase has hit three times is a watcher that
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
    /*
     * THE PAGE HAS A MEASURE, and it did not.
     *
     * `max-width` was `none`, so at 1920 the column rendered 1920px wide:
     * measured, the facts rows held ~300px of text in an 1850px band, the
     * confirm strip's own 68ch paragraph sat inside an 1850px red field (reading
     * as a banner rather than a decision), and Apply landed ~1700px from the
     * `h1` it belongs to. The 48px/16px rhythm below was doing its work
     * vertically and being undone horizontally at the width timetablers
     * actually use.
     *
     * The cap is generous rather than prose-narrow because ONE child genuinely
     * wants width (the six-column week grid) and it keeps its left edge shared
     * with the controls above it, which a full-bleed breakout would break. The
     * argument sections carry their own tighter measures from this property.
     */
    --review-measure: 78ch;

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

    max-width: 1440px;
    margin-inline: auto;
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

        /*
         * `.iconify`, not `svg`: `Icon` renders an Iconify SPAN, so the
         * `svg` rule this replaces matched nothing and the glyph sat at its
         * inherited 1em in the surrounding text colour. Same trap already
         * recorded in ViewMenu.vue, my/preferences.vue and my/availability.vue;
         * this surface had seven more of them.
         */
        .iconify {
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

        &:disabled {
            cursor: progress;
            color: $surface7;
            text-decoration: none;
        }
    }

    // The only spin in the product, and it is load-bearing rather than
    // decorative: the two round trips behind this control have no other signal.
    &_refresh-spin {
        animation: review-spin 900ms linear infinite;

        @media (prefers-reduced-motion: reduce) {
            animation: none;
        }
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
        background: $surface2;
    }

    &_outcome {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-5);
        align-items: center;

        // Held to the same measure as the confirm strip: these are the two ends
        // of one movement, and a decision that spans the full grid width reads
        // as a page banner instead of an answer.
        max-width: var(--review-measure);
        // A 1px edge, not the diff vocabulary's 2px coloured gutter.
        // See the note in ScheduleReviewSummary's `_risk`.
        padding: var(--space-5) var(--space-6);
        border: 1px solid $surface5;
        border-radius: var(--radius-lg);

        font-size: var(--font-size-md);
        color: $content2;

        background: $surface2;

        .iconify {
            flex: none;
            width: 20px;
            height: 20px;
        }

        span { flex: 1 1 20ch; }

        /*
         * THE TWO OUTCOMES ARE DELIBERATELY UNEQUAL, and only one of them said
         * so. Applying replaced a term's timetable; discarding changed nothing
         * on the schedule at all, so applied carries state colour and
         * discarded stays neutral. That asymmetry is right.
         *
         * What was wrong is that discarded reached it by FALLING THROUGH to the
         * base rule with no selector of its own, so it read as unstyled rather
         * than as quiet, and its icon inherited body colour while the other's
         * was deliberate. Both are now written out.
         */
        &--applied {
            border-color: $success600;
            background: varToRgba('success600', 0.1);

            .iconify { color: $success700; }
        }

        &--discarded {
            border-color: $surface5;

            .iconify { color: $content6; }
        }
    }

    &_error {
        display: flex;
        gap: var(--space-4);
        align-items: center;

        font-size: var(--font-size-sm);
        color: $error700;

        .iconify {
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

        background: $surface2;

        .iconify {
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
            line-height: var(--leading-prose);
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
     * THE AUTHORED MOMENT ON THIS SCREEN: DESIGN.md allows one per surface. The
     * strip arrives with weight (240ms, rising out of a slight compression) because
     * it asks the one irreversible-feeling question the product has, and leaves in
     * 140ms so backing out feels like nothing happened.
     */
    &_confirm {
        display: flex;
        flex-direction: column;
        gap: var(--space-3);

        max-width: var(--review-measure);
        // A 1px edge, not the diff vocabulary's 2px coloured gutter.
        // See the note in ScheduleReviewSummary's `_risk`.
        padding: var(--space-6);
        border: 1px solid $surface5;
        border-radius: var(--radius-lg);

        color: $content2;

        background: $surface2;

        // The one place on this screen where the weight matches the stakes.
        &--apply {
            border-color: $error600;
            background: varToRgba('error600', 0.08);
        }
    }

    &_confirm-title {
        font-size: var(--font-size-lg);
        font-weight: 600;
        color: $content1;
    }

    /* The apply confirmation: the highest-stakes paragraph in the product, and
       the one most worth reading without effort. */
    &_confirm-detail {
        max-width: 68ch;

        font-size: var(--font-size-md);
        font-variant-numeric: tabular-nums;
        line-height: var(--leading-prose);
        color: $content6;
    }

    &_confirm-actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-4);
        align-items: center;

        margin-top: var(--space-3);
    }

    /*
     * THE STATE BAND. Full width deliberately: it is the one thing on the page
     * that reframes everything below it, so it is the one thing allowed to
     * ignore `--review-measure`.
     *
     * `$surface2`, not `$surface1`: panels here were `$surface1` on a `$surface1`
     * body, the same value in both themes, so every card rendered at zero
     * contrast. A band nobody can see is not a band.
     */
    &_band {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-5) var(--space-6);
        align-items: center;
        justify-content: space-between;

        /*
         * CAPPED, because a 1376px field holding 480px of content is the
         * emptiness this redesign was called in to remove, relocated into the
         * page's frame-setting element. Full width was the wrong reading of
         * "this reframes the page": the band earns its emphasis from tint,
         * edge and type, not from running 900px past its own content.
         */
        max-width: calc(var(--review-measure) + var(--space-10));

        // A 1px edge, not the diff vocabulary's 2px coloured gutter.
        // See the note in ScheduleReviewSummary's `_risk`.
        padding: var(--space-6);
        border: 1px solid $surface5;
        border-radius: var(--radius-lg);

        background: $surface2;

        > .iconify {
            flex: none;
            align-self: flex-start;

            width: 22px;
            height: 22px;

            color: $content6;
        }

        // The applied-and-live case is the only one carrying state colour: it is
        // the only one making a claim about the schedule people are teaching to.
        &--current {
            border-color: $success600;
            background:
                linear-gradient(varToRgba('success600', 0.07), varToRgba('success600', 0.07)),
                $surface2;

            > .iconify { color: $success700; }
        }
    }

    /*
     * `flex: 0 1`, NOT `1 1`: that one digit was the whole defect.
     *
     * A growing text block pushed "Open the schedule" to the far right edge of a
     * 1376px band, roughly 700px from the sentence it belongs to. That is the
     * same stranding this redesign was called in to fix on the comparison aside,
     * reproduced by me one section higher. The band stays full width, because it
     * is the page's frame-setter; its CONTENTS cluster, so the action sits
     * beside the state it acts on.
     */
    &_band-text {
        display: flex;
        flex: 0 1 62ch;
        flex-direction: column;
        gap: var(--space-2);
    }

    &_band-title {
        font-size: var(--font-size-lg);
        font-weight: 600;
        color: $content1;
    }

    &_band-detail {
        max-width: 62ch;

        font-size: var(--font-size-md);
        font-variant-numeric: tabular-nums;
        line-height: var(--leading-prose);
        color: $content6;
    }

    &_evidence {
        display: flex;
        flex-direction: column;
        gap: var(--space-6);
    }

    /*
     * The headline totals, which the change list alone cannot state.
     *
     * Removing the old `Changes` facts row was right ("0 added · 0 moved · 142
     * unchanged · 0 removed" makes a reader subtract to learn nothing happened),
     * but it took the term-level total with it, and a per-Offering list has no
     * place to put one. It belongs to the section, not to a row.
     */
    &_totals {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-3) var(--space-6);

        font-size: var(--font-size-md);
        font-variant-numeric: tabular-nums;
        color: $content6;

        strong {
            font-weight: 600;
            color: $content2;
        }
    }

    &_total--deleted strong { color: $error700; }
    &_total--created strong { color: $success700; }

    &_evidence-head {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-4) var(--space-6);
        align-items: baseline;
        justify-content: space-between;
    }

    /*
     * A two-state segmented control rather than two links or a `<select>`: the
     * choice is between two views of the same evidence, and both need to be
     * visible at once for the switch to teach that the other one exists.
     */
    &_views {
        display: flex;
        gap: var(--space-1);

        padding: var(--space-1);
        border-radius: var(--radius-lg);

        background: $surface2;
    }

    &_view {
        cursor: pointer;

        min-height: 36px;
        padding: var(--space-3) var(--space-5);
        border: 0;
        border-radius: var(--radius-md);

        font-family: inherit;
        font-size: var(--font-size-sm);
        color: $content6;

        background: none;

        @include hover() {
            &:hover { color: $content2; }
        }

        // The accent stays spent on "the system is offering you something",
        // which an active view is not: this is a raised surface, not an offer.
        &--on {
            color: $content1;
            background: $surface4;
        }
    }

    &_destructive {
        display: flex;
        gap: var(--space-4);
        align-items: flex-start;

        max-width: var(--review-measure);
        // A 1px edge, not the diff vocabulary's 2px coloured gutter.
        // See the note in ScheduleReviewSummary's `_risk`.
        padding: var(--space-5) var(--space-6);
        border: 1px solid $surface5;
        border-radius: var(--radius-lg);

        font-size: var(--font-size-md);
        font-variant-numeric: tabular-nums;
        line-height: var(--leading-prose);
        color: $content2;

        background:
            linear-gradient(varToRgba('error600', 0.08), varToRgba('error600', 0.08)),
            $surface2;

        .iconify {
            flex: none;
            width: 18px;
            height: 18px;
            color: $error700;
        }
    }

    // An active narrowing always renders and always carries its own clear:
    // a filtered grid and an empty week must never be the same picture.
    &_drill {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-4) var(--space-5);
        align-items: center;

        font-size: var(--font-size-sm);
        color: $content6;
    }

    &_drill-clear {
        cursor: pointer;

        display: inline-flex;
        gap: var(--space-3);
        align-items: center;

        min-height: 44px;
        margin: calc(var(--space-5) * -1) 0;
        padding: var(--space-5) 0;
        border: 0;

        font-family: inherit;
        font-size: var(--font-size-sm);
        color: $primary700;

        background: none;

        .iconify {
            flex: none;
            width: 14px;
            height: 14px;
        }

        @include hover() {
            &:hover {
                text-decoration: underline;
                text-underline-offset: 2px;
            }
        }
    }

    &_grid-section {
        display: flex;
        flex-direction: column;
        gap: var(--space-6);
    }

    /*
     * The week-level empty state, at the size of the claim it makes.
     *
     * Not the full-height treatment `&_failure` gets, since nothing has gone wrong
     * and there is nothing to recover from, and not a bare line either, or it
     * reads as a caption for a grid that is not there. One quiet band, aligned
     * with the controls above it, so the eye lands where the grid would have
     * been and reads the sentence instead of hunting for it.
     */
    &_week-empty {
        padding: var(--space-8) var(--space-6);
        border-radius: var(--radius-lg);

        font-size: var(--font-size-md);
        color: $content6;
        text-align: center;

        background: $surface2;
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

        background: $surface2;
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
     * STALE WEEK, and this is the one place on the review surface where dimming
     * by opacity is the right answer rather than the trap.
     *
     * `ScheduleReviewGrid` deliberately does NOT use opacity for its `unchanged`
     * chips: it measured 4.19:1 there, because opacity flattens a chip's own
     * background into its text and the result is a persistent reading state
     * nobody can predict from the token ramp. This is the opposite case: the
     * content is transient, it is being replaced within one request, and it is
     * explicitly NOT for reading: `aria-busy` on the section says exactly that
     * to anyone not looking at it. Dimming here means "do not trust this yet",
     * which is the honest thing to say about a week that has already changed in
     * the picker.
     *
     * `pointer-events: none` because a chip belonging to the previous week must
     * not be clickable while the next one is in flight.
     */
    &_week--stale {
        pointer-events: none;
        opacity: 0.4;
        transition: opacity 140ms cubic-bezier(0.16, 1, 0.3, 1);
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

        /*
         * The week picker's ANNOTATION is the reason it is the best control on
         * this page: "Week 4: 37 changes" is the only place the reviewer learns
         * which weeks are worth opening. At `flex: 1 1 140px` it shared a row and
         * truncated to "Week 4: 37 chan…", cutting exactly that.
         *
         * So the week gets its own full-width row and the other four pair up.
         * Ordering is presentational only: the DOM order is unchanged, so tab
         * order still follows the visual one.
         */
        &_controls { align-items: stretch; }

        &_field {
            flex: 1 1 140px;

            &:first-child { flex: 1 1 100%; }
        }

        &_select { width: 100%; }

        /*
         * THE CONFIRM STRIP BECOMES A COMMIT BAR, and this is the structural
         * adaptation the page was missing rather than a cosmetic one.
         *
         * The strip is DOM-above the summary, which is right on desktop: it
         * appears next to the Apply button that opened it. At 390×844 that same
         * position pushed 100% of the evidence below the fold: the reviewer was
         * asked "Replace this term's timetable?" with nothing on screen to
         * decide from. The comment above `&_confirm` rejects a modal precisely
         * because "a modal would cover the evidence the reviewer is deciding
         * from", and this layout was doing that by another mechanism.
         *
         * Anchored to the bottom instead, the argument scrolls behind it and the
         * decision sits in the thumb zone, which is also the sticky commit bar
         * this presentation never had. Below the header's z-index 100: they never
         * overlap, but the header is the only way out of here.
         */
        &_confirm {
            position: fixed;
            z-index: 90;
            inset: auto 0 0;

            max-width: none;
            padding: var(--space-6) var(--space-5)
                calc(var(--space-6) + env(safe-area-inset-bottom));
            border-top: var(--space-1) solid $surface5;
            border-left: 0;
            border-radius: var(--radius-lg) var(--radius-lg) 0 0;

            // The tint is 8% and the bar now floats over scrolling content, so
            // it is layered over an OPAQUE surface rather than replacing it:
            // a translucent background here renders chips through the sentence.
            background: $surface2;
            box-shadow: 0 -6px 20px varToRgba('surface7', 0.16);

            &--apply {
                border-top-color: $error600;
                background:
                    linear-gradient(
                        varToRgba('error600', 0.08),
                        varToRgba('error600', 0.08)
                    ),
                    $surface1;
            }
        }

        // Clears the bar, so the last thing the reviewer scrolls to is readable
        // rather than sitting underneath the question about it.
        &--committing { padding-bottom: 200px; }
    }
}

@keyframes review-spin {
    to { transform: rotate(360deg); }
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
 * for. Slightly longer, and it comes up rather than down, since the decision is
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