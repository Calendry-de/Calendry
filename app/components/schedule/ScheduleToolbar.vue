<template>
    <section
        class="bar"
        aria-label="Filters and schedule actions"
    >
        <div class="bar_group">
            <!--
                Term/Group/Room/Person moved to `ScheduleFilterPanel` — a
                toggleable drawer rather than a permanent reservation, for the
                same reason `.schedule_side` in `schedule/index.vue` gave up its
                fixed width. This button is the only trace of them left here.
            -->
            <button
                type="button"
                class="bar_filters-toggle"
                :class="{ 'bar_filters-toggle--active': filtersOpenModel }"
                :aria-expanded="filtersOpenModel"
                aria-controls="schedule-filters-panel"
                @click="filtersOpenModel = !filtersOpenModel"
            >
                <Icon
                    name="material-symbols:filter-alt-outline"
                    aria-hidden="true"
                />
                Filters
                <span
                    v-if="activeFilterCount"
                    class="bar_filters-count"
                >{{ activeFilterCount }}</span>
            </button>
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
            <!--
                NO PERMISSION PROP HERE, deliberately: this page's own route
                middleware (`SCHEDULE_PERMISSIONS`) already requires
                `session.read` or `session.read_own` to be standing here at
                all, which is exactly what `GET /api/me/schedule.ics` itself
                re-checks — the same gate, not a second one to keep in sync.
                A plain `href`, not a click handler: the request must carry the
                browser's own session cookie, and CommonButton's `href` prop
                renders a real `<a>` rather than a NuxtLink, so the browser
                does a real (if invisible) navigation and treats the response's
                `content-disposition: attachment` as a download instead of
                routing it through the SPA. No `from`/`to` — the endpoint's own
                default, the whole current Term, is exactly the "sensible
                default range" this button wants.
            -->
            <CommonButton
                v-if="solverTermId"
                icon="material-symbols:download"
                type="transparent"
                :href="`/api/me/schedule.ics?termId=${encodeURIComponent(solverTermId)}`"
            >Download .ics</CommonButton>

            <!-- Hidden without `session.create`, not disabled: there is no
                 read-only version of "add an event", and disabled reads as
                 "unavailable right now" rather than "not yours". -->
            <CommonButton
                v-if="canCreateSession && solverTermId"
                data-create-toggle
                :icon="creating ? 'material-symbols:close' : 'material-symbols:add'"
                :type="creating ? 'secondary' : 'transparent'"
                @click="$emit('toggle-create')"
            >{{ creating ? 'Cancel event' : 'Add event' }}</CommonButton>

            <!--
                THE DURABLE WAY TO A PROPOSAL. The solver's own "Review" button
                lives in a transient state a reload destroys, so a proposal was
                reachable for minutes by one person. Gated on `generation.read`,
                not `solver.trigger` — whoever reviews a schedule is usually not
                whoever may generate one, and not everybody who may READ one may
                see proposals either.
            -->
            <CommonButton
                v-if="canReviewProposals"
                icon="material-symbols:fact-check-outline"
                type="transparent"
                to="/schedule/proposals"
            >Proposals</CommonButton>

            <!--
                Last in the group so its status line and the panel it summarises
                (anchored at the bar's right edge) are adjacent. Hidden without
                `solver.trigger`: every solver route requires it.
            -->
            <ScheduleSolverControl
                v-if="canTriggerSolver && solverTermId"
                ref="solverControl"
                :term-id="solverTermId"
            />

            <!--
                ITS OWN GATE (availability.manage_own), unrelated to any of the
                above — see the component's own comment. Last in the group,
                matching the solver control's own reasoning: its anchored panel
                opens toward the bar's right edge.
            -->
            <ScheduleBlockedDayButton
                v-if="week && activeDays?.length && slotDateOf"
                :week="week"
                :active-days="activeDays"
                :slot-date-of="slotDateOf"
            />
        </div>

    </section>
</template>

<script setup lang="ts">
import ScheduleSolverControl from '~/components/schedule/ScheduleSolverControl.vue';
import ScheduleBlockedDayButton from '~/components/schedule/ScheduleBlockedDayButton.vue';

defineProps<{
    /** The visible week and its real dates, for "I can't teach this week". */
    week?: number;
    activeDays?: number[];
    slotDateOf?: (week: number, dayOfWeek: number) => Date | null;
    /** How many of Group/Room/Person are currently narrowing the view. */
    activeFilterCount: number;
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

// Owned by the page, toggling `ScheduleFilterPanel` — not a data filter itself.
const filtersOpenModel = defineModel<boolean>('filtersOpen', { required: true });

// View state, owned by the page: neither affects the API query.
const rowHeightModel = defineModel<number>('rowHeight', { required: true });
const showViolationsModel = defineModel<boolean>('showViolations', { required: true });

/**
 * A pass-through to the solver control, so the violations panel can start a
 * repair without owning a second `useSolverRun`.
 *
 * Forwarded rather than lifted: one poller and one state machine per Term is
 * the invariant, and the run has to render in this bar wherever it was started
 * from. `null` when the control is not mounted — no `solver.trigger`, or no
 * resolved Term — and the caller is gated on the same permission, so this is a
 * belt-and-braces guard rather than the boundary.
 */
const solverControl = useTemplateRef<{ startRepair: () => Promise<void> }>('solverControl');

defineExpose({ startRepair: () => solverControl.value?.startRepair() });
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

    /*
     * Above `.schedule_body` so the solver's and blocked-day panels overlay the
     * grid instead of displacing it; `.schedule_side` is sticky and later in the
     * DOM. Must also outrank `ScheduleGrid`'s own sticky corner (z-index: 3) —
     * that cell creates its own stacking context with nothing in between to
     * contain it, so it compared directly against this one and painted over
     * both anchored panels regardless of their own (locally-scoped) z-index.
     */
    z-index: 4;

    display: grid;
    grid-template-areas:
        'scope scope'
        'view actions';
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--space-6) var(--space-7);

    /*
     * `end` puts the buttons on the selects' optical line rather than the
     * labels' 16px above. It was `flex-start` because a tall in-flow solver
     * dragged every select down to meet it; safe again ONLY while the solver's
     * tall states stay out of flow (see `ScheduleSolverControl`).
     */
    align-items: end;

    padding: var(--space-5) var(--space-6);
    border-radius: var(--radius-xl);

    background: $surface1;

    /*
     * 44px ON A PHONE ONLY. The 35px toggle and ~34px selects match each other on
     * the desktop row and are comfortable mouse targets; forcing 44px there would
     * make the toggle taller than the select beside it for no one's benefit. Below
     * 700px the same controls are thumb-reached, which is the condition
     * `ScheduleAgenda` and `ScheduleWeekNav` already apply it under.
     */
    @include mobileOnly() {
        grid-template-areas:
            'scope'
            'view'
            'actions';
        grid-template-columns: minmax(0, 1fr);

        /* Tighter rows than the desktop's 16px: on a phone the toolbar already
           costs 303px before any schedule appears. */
        gap: var(--space-5) var(--space-7);
        #{&}_select,
        #{&}_filters-toggle,
        #{&}_violations-toggle {
            min-height: 44px;
        }

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
        grid-area: scope;
        flex-wrap: wrap;
        gap: var(--space-4) var(--space-5);
        align-items: flex-end;

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
            font-size: var(--font-size-xs);
            font-weight: 600;
            color: $content7;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }
    }

    &_select {
        cursor: pointer;

        /*
         * A `<select>` sizes itself to its widest option and every option here
         * is tenant free text, so uncapped the tenant's data decided the bar's
         * structure (Term 132px → 367px with realistic German names). The
         * ellipsis is what makes the cap readable rather than a crop.
         */
        overflow: hidden;

        min-width: 120px;
        max-width: 220px;
        padding: var(--space-3) var(--space-4);
        border: 1px solid $surface5;
        border-radius: var(--radius-md);

        font-family: inherit;
        font-size: var(--font-size-md);
        color: $content5;
        text-overflow: ellipsis;

        background: $surface0;

        &:focus-visible {
            outline: 2px solid $primary600;
            outline-offset: 1px;
        }
    }

    &_muted { color: $content7; }

    &_filters-toggle,
    &_violations-toggle {
        cursor: pointer;

        display: flex;
        gap: var(--space-3);
        align-items: center;

        padding: var(--space-4) var(--space-5);
        border: 1px solid $surface5;
        border-radius: var(--radius-md);

        font-family: inherit;
        font-size: var(--font-size-sm);
        color: $content6;

        background: $surface0;

        svg {
            width: 15px;
            height: 15px;
        }

        @include hover() {
            &:hover {
                border-color: $surface6;
                color: $content4;
            }
        }

        &:focus-visible {
            outline: 2px solid $primary600;
            outline-offset: 1px;
        }

        &--active {
            border-color: $primary500;
            color: $content2;
            background: varToRgba('primary500', 0.16);
        }
    }

    // Same treatment as `ManageList.vue`'s `.list_badge` — a small filled count,
    // not a new badge language.
    &_filters-count {
        padding: var(--space-1) var(--space-3);
        border-radius: var(--radius-sm);

        font-size: var(--font-size-xs);
        font-weight: 650;
        color: $primary700;

        background: varToRgba('primary500', 0.16);
    }
}
</style>
