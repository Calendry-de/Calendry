<template>
    <section
        class="bar"
        aria-label="Filters and schedule actions"
    >
        <div class="bar_group">
            <label class="bar_field">
                <span>Term</span>
                <select
                    v-model="termIdModel"
                    class="bar_select"
                    :title="selectedName(terms, termIdModel || (terms[0]?.id ?? ''), '')"
                >
                    <!--
                        `:selected` explicitly: `filters.termId` is seeded by a
                        watchEffect Vue never flushes during SSR, so without it
                        no `selected` attribute is emitted and the browser falls
                        back to option 1 — right today only because
                        `resolvedTermId` also falls back to `terms[0]`.
                    -->
                    <option
                        v-for="term in terms"
                        :key="term.id"
                        :value="term.id"
                        :selected="term.id === (termIdModel || terms[0]?.id)"
                    >{{ term.name }}</option>
                </select>
            </label>


            <label class="bar_field">
                <span>Group</span>
                <select
                    v-model="groupIdModel"
                    class="bar_select"
                    :title="selectedName(groups, groupIdModel, 'All groups')"
                >
                    <option value="">All groups</option>
                    <option
                        v-for="group in groups"
                        :key="group.id"
                        :value="group.id"
                    >{{ group.name }}</option>
                </select>
            </label>

            <label
                v-if="groupIdModel"
                class="bar_check"
            >
                <input
                    v-model="includeNestedModel"
                    type="checkbox"
                >
                <span>Include nested</span>
            </label>

            <label class="bar_field">
                <span>Room</span>
                <select
                    v-model="roomIdModel"
                    class="bar_select"
                    :title="selectedName(rooms, roomIdModel, 'All rooms')"
                >
                    <option value="">All rooms</option>
                    <option
                        v-for="room in rooms"
                        :key="room.id"
                        :value="room.id"
                    >{{ room.name }}</option>
                </select>
            </label>

            <label class="bar_field">
                <span>Person</span>
                <select
                    v-model="personIdModel"
                    class="bar_select"
                    :title="selectedName(people, personIdModel, 'Anyone')"
                >
                    <option value="">Anyone</option>
                    <option
                        v-for="person in people"
                        :key="person.id"
                        :value="person.id"
                    >{{ person.name }}</option>
                </select>
            </label>
        </div>

        <!--
            VIEW STATE — nothing here changes the schedule. Second in the DOM as
            well as on screen; when the bar was a wrapping flex row the two
            disagreed at some widths.
        -->
        <div class="bar_group bar_group--view">
            <label class="bar_field">
                <span>Density</span>
                <select
                    v-model.number="rowHeightModel"
                    class="bar_select"
                >
                    <option :value="44">Compact</option>
                    <option :value="60">Comfortable</option>
                    <option :value="84">Spacious</option>
                </select>
            </label>

            <!-- Hidden without violation.read: no affordance for data the API
                 would refuse anyway. -->
            <button
                v-if="canReadViolations"
                type="button"
                class="bar_violations-toggle"
                :class="{ 'bar_violations-toggle--active': showViolationsModel }"
                :aria-pressed="showViolationsModel"
                @click="showViolationsModel = !showViolationsModel"
            >
                <Icon
                    name="material-symbols:error-outline"
                    aria-hidden="true"
                />
                {{ violationCount }} violation{{ violationCount === 1 ? '' : 's' }}
            </button>
        </div>
        <!-- ACTIONS — the only controls here that change anything, which is why
             they hold the right edge on their own. -->
        <div class="bar_group bar_group--end">
            <!-- Hidden without `session.create`, not disabled: there is no
                 read-only version of "add an event", and disabled reads as
                 "unavailable right now" rather than "not yours". -->
            <common-button
                v-if="canCreateSession && solverTermId"
                :icon="creating ? 'material-symbols:close' : 'material-symbols:add'"
                :type="creating ? 'secondary' : 'transparent'"
                @click="$emit('toggle-create')"
            >{{ creating ? 'Cancel event' : 'Add event' }}</common-button>

            <!--
                THE DURABLE WAY TO A PROPOSAL. The solver's own "Review" button
                lives in a transient state a reload destroys, so a proposal was
                reachable for minutes by one person. Gated on `session.read`, not
                `solver.trigger` — whoever reviews a schedule is usually not
                whoever may generate one.
            -->
            <common-button
                v-if="canReviewProposals"
                icon="material-symbols:fact-check-outline"
                type="transparent"
                to="/schedule/proposals"
            >Proposals</common-button>

            <!--
                Last in the group so its status line and the panel it summarises
                (anchored at the bar's right edge) are adjacent. Hidden without
                `solver.trigger`: every solver route requires it.
            -->
            <ScheduleSolverControl
                v-if="canTriggerSolver && solverTermId"
                :term-id="solverTermId"
            />
        </div>

    </section>
</template>

<script setup lang="ts">
import ScheduleSolverControl from '~/components/schedule/ScheduleSolverControl.vue';
import type { NamedRow, Term } from '~/composables/schedule';

defineProps<{
    terms: Term[];
    groups: NamedRow[];
    rooms: NamedRow[];
    people: NamedRow[];
    violationCount: number;
    canReadViolations: boolean;
    canTriggerSolver: boolean;
    /** `session.read` — deliberately not `solver.trigger`; see the link's note. */
    canReviewProposals: boolean;
    canCreateSession: boolean;
    creating: boolean;
    /** Correct at first render, unlike the term-id model, which a
        watchEffect seeds and SSR never flushes. */
    solverTermId: string;
}>();

defineEmits<{ 'toggle-create': [] }>();

/**
 * The full text of what a select shows. The selects truncate with an ellipsis,
 * so the visible value can be a prefix; the open list and screen readers already
 * have the whole name, this adds it for the mouse.
 */
function selectedName(rows: readonly { id: string; name: string }[], id: string, fallback: string): string {
    return rows.find((row) => row.id === id)?.name ?? fallback;
}

// Filter values are owned by useScheduleFilters() and reach this component as
// models — the toolbar renders and edits them, it does not own them.
const termIdModel = defineModel<string>('termId', { required: true });
const groupIdModel = defineModel<string>('groupId', { required: true });
const roomIdModel = defineModel<string>('roomId', { required: true });
const personIdModel = defineModel<string>('personId', { required: true });
const includeNestedModel = defineModel<boolean>('includeNested', { required: true });

// View state, owned by the page: neither affects the API query.
const rowHeightModel = defineModel<number>('rowHeight', { required: true });
const showViolationsModel = defineModel<boolean>('showViolations', { required: true });
</script>

<style scoped lang="scss">
.bar {
    /*
     * TWO NAMED ROWS, NOT A WRAPPING FLEX ROW. One row per group, so each row is
     * sized by one group and the bar's height is a constant 146px through every
     * solver state and every length of tenant name.
     *
     * One row does not fit: scope 621 + view 231 + actions 507 + gaps is 1407px
     * of a 1408px row at 1440, so every variable in it decided the bar's height
     * — a longer tenant name re-wrapped the filters, and so did the solver
     * (254px idle against 112px running).
     *
     * `--space-7` (24px) between areas against `--space-5` (12px) within one.
     */
    position: relative;

    /* Above `.schedule_body` so the solver's anchored panels overlay the grid
       instead of displacing it; `.schedule_side` is sticky and later in the DOM. */
    z-index: 2;

    display: grid;

    /*
     * `end` puts the buttons on the selects' optical line rather than the
     * labels' 16px above. It was `flex-start` because a tall in-flow solver
     * dragged every select down to meet it; safe again ONLY while the solver's
     * tall states stay out of flow (see `ScheduleSolverControl`).
     */
    align-items: end;
    gap: var(--space-6) var(--space-7);
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas:
        'scope scope'
        'view actions';

    padding: var(--space-5) var(--space-6);
    border-radius: var(--radius-xl);

    background: $surface1;

    @include mobileOnly() {
        /* Tighter rows than the desktop's 16px: on a phone the toolbar already
           costs 303px before any schedule appears. */
        gap: var(--space-5) var(--space-7);
        grid-template-columns: minmax(0, 1fr);
        grid-template-areas:
            'scope'
            'view'
            'actions';

        /*
         * On a phone the cap is the container, not 220px — more than half the
         * row, so two fields could no longer share one and the filters went from
         * two rows to four (303px against 468px with German names).
         */
        #{&}_field { flex: 1 1 140px; }

        #{&}_select {
            width: 100%;
            max-width: 100%;
        }
    }

    &_group {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-end;
        gap: var(--space-4) var(--space-5);

        grid-area: scope;

        /* So a long tenant name shrinks the group rather than the bar. */
        min-width: 0;

        &--view { grid-area: view; }

        /* No auto margin: it made the group's position depend on which wrap
           line it landed on. */
        &--end { grid-area: actions; }
    }

    &_field {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);

        // Lets the select's `max-width` bind: a flex item's default
        // `min-width: auto` is its content, i.e. the widest option.
        min-width: 0;

        > span {
            color: $content7;
            font-size: var(--font-size-xs);
            font-weight: 600;
            letter-spacing: 0.05em;
            text-transform: uppercase;
        }
    }

    &_select {

        min-width: 120px;
        max-width: 220px;
        padding: var(--space-3) var(--space-4);

        /*
         * A `<select>` sizes itself to its widest option and every option here
         * is tenant free text, so uncapped the tenant's data decided the bar's
         * structure (Term 132px → 367px with realistic German names). The
         * ellipsis is what makes the cap readable rather than a crop.
         */
        overflow: hidden;
        border: 1px solid $surface5;
        border-radius: var(--radius-md);

        background: $surface0;
        color: $content5;

        font-family: inherit;
        font-size: var(--font-size-md);
        text-overflow: ellipsis;
        cursor: pointer;

        &:focus-visible { outline: 2px solid $primary400; outline-offset: 1px; }
    }

    &_check {
        display: flex;
        align-items: center;
        gap: var(--space-3);

        /*
         * OPTICAL, not rhythmic — the one off-scale value left on this screen
         * and deliberately so. It sits the checkbox's centre on the same line as
         * the selects' text, compensating for the label those carry above them;
         * snapping it to 6 or 8 would visibly misalign the row. A spacing scale
         * governs intervals between things, not corrections inside one.
         */
        padding-bottom: 7px;
        color: $content6;

        font-size: var(--font-size-sm);

        input { accent-color: $primary500; }
    }

    &_muted { color: $content7; }

    &_violations-toggle {

        display: flex;
        align-items: center;
        gap: var(--space-3);

        padding: var(--space-4) var(--space-5);
        border: 1px solid $surface5;
        border-radius: var(--radius-md);

        background: $surface0;
        color: $content6;

        font-family: inherit;
        font-size: var(--font-size-sm);
        cursor: pointer;

        svg { width: 15px; height: 15px; }

        @include hover() {
            &:hover { border-color: $surface6; color: $content4; }
        }

        &:focus-visible { outline: 2px solid $primary400; outline-offset: 1px; }

        &--active {
            border-color: $primary500;
            background: varToRgba('primary500', 0.16);
            color: $content2;
        }
    }
}
</style>
