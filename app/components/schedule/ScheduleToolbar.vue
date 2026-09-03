<template>
    <section
        class="bar"
        :aria-label="t('schedule.toolbar.regionLabel')"
    >
        <div class="bar_group">
            <!--
                THE SCOPE, SAID OUT LOUD. With `session.read_own` this bar
                frames one person's timetable, not a sparse version of the
                institution's, and until now the only thing that said so was
                the page's visually-hidden `<h1>`: a sighted lecturer got the
                institution's frame and three chips, which reads as a tenant
                with almost nothing in it. That was the exact misreading the
                heading's own comment was written to prevent, solved for one
                audience only.

                Renders ONLY for 'own'. On the institution's schedule the
                statement is what everybody already assumes, and this bar's
                height is measured (DECISIONS.md § "The schedule toolbar"):
                a permanent chip would spend that budget saying nothing.

                Reuses the heading's key rather than a second string, so the
                two cannot drift, and is `aria-hidden` for the same reason the
                page's outcome strip is: the heading already says it, and one
                sentence should be announced once.
            -->
            <p
                v-if="scope === 'own'"
                class="bar_scope"
                aria-hidden="true"
            >
                <Icon
                    name="material-symbols:person-outline"
                    aria-hidden="true"
                />
                {{ t('schedule.page.headingOwn') }}
            </p>

            <!--
                Term lives HERE, not in `ScheduleFilterPanel` with Group/Room/
                Person: it is not a filter; it does not narrow what a caller
                who can already see the data sees, it decides WHICH schedule
                (whole term of data) is being looked at at all, the same kind
                of choice `resolveTermId()`/`patchScheduleSettings()` persist
                across visits. Burying it inside a togglable drawer made
                switching terms a two-click, easy-to-miss action for the one
                control most likely to be reached for on every visit.
            -->
            <label class="bar_field">
                <span>{{ t('schedule.toolbar.term') }}</span>
                <select
                    v-model="termIdModel"
                    class="bar_select"
                    :title="selectedTermName"
                >
                    <option
                        v-for="term in terms"
                        :key="term.id"
                        :value="term.id"
                        :selected="term.id === (termIdModel || terms[0]?.id)"
                    >{{ term.name }}</option>
                </select>
            </label>

            <!--
                Group/Room/Person moved to `ScheduleFilterPanel`, a
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
                {{ t('schedule.toolbar.filters') }}
                <span
                    v-if="activeFilterCount"
                    class="bar_filters-count"
                >{{ activeFilterCount }}</span>
            </button>
        </div>

        <!--
            VIEW STATE: nothing here changes the schedule. Second in the DOM as
            well as on screen; when the bar was a wrapping flex row the two
            disagreed at some widths.
        -->
        <div class="bar_group bar_group--view">
            <!-- Hidden without violation.read: no affordance for data the API
                 would refuse anyway. -->
            <!--
                TWO NUMBERS, NOT A TOTAL. This reported `violations.length`,
                which is a quantity nobody can act on: the only action the page
                offers against a violation is the panel's Repair, and that is
                gated on the HARD count alone, because a repair exists to make
                the timetable legal and offering one against a soft preference
                breach would promise something it does not do
                (`ScheduleViolationsPanel`). So the deciding number was
                reachable only by opening the panel, while the one on permanent
                display merged an illegal placement with a weighted wish.

                Both halves render whenever either is non-zero, including a
                zero: the position of each figure has to be stable, or reading
                the bar means reading it word by word. Only "none at all"
                collapses to a sentence.
            -->
            <button
                v-if="canReadViolations"
                type="button"
                class="bar_violations-toggle"
                :class="{ 'bar_violations-toggle--active': showViolationsModel }"
                :aria-pressed="showViolationsModel"
                :aria-label="violationsLabel"
                @click="showViolationsModel = !showViolationsModel"
            >
                <Icon
                    name="material-symbols:error-outline"
                    aria-hidden="true"
                />
                <span v-if="!hardViolationCount && !softViolationCount">
                    {{ t('schedule.toolbar.violationsNone') }}
                </span>
                <template v-else>
                    <span
                        class="bar_violations-hard"
                        :class="{ 'is-zero': !hardViolationCount }"
                    >{{ t('schedule.toolbar.violationsHard', { count: hardViolationCount }) }}</span>
                    <span class="bar_violations-soft">{{
                        t('schedule.toolbar.violationsSoft', { count: softViolationCount })
                    }}</span>
                </template>
            </button>
        </div>
        <!-- ACTIONS: the only controls here that change anything, which is why
             they hold the right edge on their own. -->
        <div class="bar_group bar_group--end">
            <!-- Hidden without `session.create`, not disabled: there is no
                 read-only version of "add an event", and disabled reads as
                 "unavailable right now" rather than "not yours". -->
            <CommonButton
                v-if="canCreateSession && solverTermId"
                data-create-toggle
                :icon="creating ? 'material-symbols:close' : 'material-symbols:add'"
                :type="creating ? 'secondary' : 'transparent'"
                @click="$emit('toggle-create')"
            >{{ creating ? t('schedule.toolbar.cancelEvent') : t('schedule.toolbar.addEvent') }}</CommonButton>

            <!--
                THE DURABLE WAY TO A PROPOSAL. The solver's own "Review" button
                lives in a transient state a reload destroys, so a proposal was
                reachable for minutes by one person. Gated on `generation.read`,
                not `solver.trigger`: whoever reviews a schedule is usually not
                whoever may generate one, and not everybody who may READ one may
                see proposals either.
            -->
            <CommonButton
                v-if="canReviewProposals"
                icon="material-symbols:fact-check-outline"
                type="transparent"
                to="/schedule/proposals"
            >{{ t('schedule.toolbar.proposals') }}</CommonButton>

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
                above; see the component's own comment. Last in the group,
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
import type { Term } from '~/composables/schedule';
import ScheduleSolverControl from '~/components/schedule/ScheduleSolverControl.vue';
import ScheduleBlockedDayButton from '~/components/schedule/ScheduleBlockedDayButton.vue';
import { useT } from '~/composables/i18n';

const props = defineProps<{
    terms: Term[];
    /** The visible week and its real dates, for "I can't teach this week". */
    week?: number;
    activeDays?: number[];
    slotDateOf?: (week: number, dayOfWeek: number) => Date | null;
    /** How many of Group/Room/Person are currently narrowing the view. */
    activeFilterCount: number;
    /** Split, not totalled: only the hard count has an action behind it. */
    hardViolationCount: number;
    softViolationCount: number;
    /** Whose schedule this is, from the server's answer, never from a
        permission: `'own'` is one person's timetable. */
    scope: 'any' | 'own';
    canReadViolations: boolean;
    canTriggerSolver: boolean;
    /** `session.read`, deliberately not `solver.trigger`; see the link's note. */
    canReviewProposals: boolean;
    canCreateSession: boolean;
    creating: boolean;
    /** Correct at first render, unlike the term-id model, which a
        watchEffect seeds and SSR never flushes. */
    solverTermId: string;
}>();

defineEmits<{ 'toggle-create': [] }>();

const { t } = useT();

const termIdModel = defineModel<string>('termId', { required: true });

/*
 * THE COMPACT LABELS ARE FOR THE EYE ONLY. "3 hart · 12 weich" is legible in a
 * bar whose width is already spoken for, and unintelligible read aloud, so the
 * accessible name is the whole sentence instead of the sum of the parts.
 */
const violationsLabel = computed(() => (
    !props.hardViolationCount && !props.softViolationCount
        ? t('schedule.toolbar.violationsNone')
        : t('schedule.toolbar.violationsLabel', {
            hard: props.hardViolationCount,
            soft: props.softViolationCount,
        })
));

const selectedTermName = computed(
    () => props.terms.find((term) => term.id === (termIdModel.value || props.terms[0]?.id))?.name ?? '',
);

// Owned by the page, toggling `ScheduleFilterPanel`, not a data filter itself.
const filtersOpenModel = defineModel<boolean>('filtersOpen', { required: true });

// View state, owned by the page: does not affect the API query. Row height
// used to live here too, a manual density preset; it is now derived
// automatically from the TimeGrid's block length (see `autoRowHeight`), so
// there is nothing left for this bar to offer a choice over.
const showViolationsModel = defineModel<boolean>('showViolations', { required: true });

/**
 * A pass-through to the solver control, so the violations panel can start a
 * repair without owning a second `useSolverRun`.
 *
 * Forwarded rather than lifted: one poller and one state machine per Term is
 * the invariant, and the run has to render in this bar wherever it was started
 * from. `null` when the control is not mounted (no `solver.trigger`, or no
 * resolved Term), and the caller is gated on the same permission, so this is a
 * belt-and-braces guard rather than the boundary.
 */
const solverControl = useTemplateRef<{ startRepair: () => Promise<void> }>('solverControl');

defineExpose({ startRepair: () => solverControl.value?.startRepair() });
</script>

<style scoped lang="scss">
.bar {
    /*
     * ONE ROW OF ONE CONTROL LANGUAGE. Three named areas: what is being looked
     * at (scope), how it is being read (view), and the only things that change
     * anything (actions), which alone hold the right edge. The actions area is
     * the one allowed to grow, and it WRAPS inside itself, right-aligned, so a
     * long tenant label or the German copy costs the bar a second line of
     * actions and never collides with the view toggle beside it. (That
     * collision was real: at 1024px the violations toggle rendered under the
     * blocked-day button, because the view column was the `1fr` track and the
     * content-sized actions column left it 130px.)
     *
     * NO CARD. The bar carried `$surface1` at `--radius-xl` on a `$surface1`
     * page: an invisible frame whose only visible effect was 24px of padding
     * and a 150px-tall region for four controls. A hairline underneath
     * separates chrome from schedule instead, the way an occupied cell is told
     * from an empty one: by an edge, not a fill.
     */
    position: relative;

    /*
     * Above `.schedule_body` so the solver's and blocked-day panels overlay the
     * grid instead of displacing it; must also outrank `ScheduleGrid`'s sticky
     * corner (z-index: 3), which compares directly against this one.
     */
    z-index: 4;

    display: grid;
    grid-template-areas: 'scope view actions';
    grid-template-columns: auto auto minmax(0, 1fr);
    gap: var(--space-5) var(--space-7);
    align-items: center;

    padding: 0 0 var(--space-5);
    border-bottom: 1px solid $surface5;

    @include mobile() {
        grid-template-areas:
            'scope view'
            'actions actions';
        grid-template-columns: auto minmax(0, 1fr);
    }

    /*
     * 44px ON A PHONE ONLY: the same controls are thumb-reached there, the
     * condition `ScheduleAgenda` and `ScheduleWeekNav` already apply it under.
     */
    @include mobileOnly() {
        grid-template-areas:
            'scope'
            'view'
            'actions';
        grid-template-columns: minmax(0, 1fr);

        #{&}_select,
        #{&}_filters-toggle,
        #{&}_violations-toggle {
            min-height: 44px;
        }

        #{&}_field { flex: 1 1 140px; }

        #{&}_select {
            width: 100%;
            max-width: 100%;
        }

        #{&}_group--end :deep(.button) { min-height: 44px; }
    }

    &_group {
        display: flex;
        grid-area: scope;
        flex-wrap: wrap;
        gap: var(--space-4) var(--space-5);
        align-items: center;

        /* So a long tenant name shrinks the group rather than the bar. */
        min-width: 0;

        &--view { grid-area: view; }

        &--end {
            grid-area: actions;
            justify-content: flex-end;
        }
    }

    /*
     * A STATEMENT, NOT A CONTROL. No fill, no border, no hover: it names what
     * the bar is looking at, and anything that looks pressable here is.
     */
    &_scope {
        display: flex;
        gap: var(--space-3);
        align-items: center;

        margin: 0;

        font-size: var(--font-size-sm);
        font-weight: 600;
        color: $content6;

        svg {
            flex: none;
            width: 15px;
            height: 15px;
            color: $content7;
        }
    }

    /*
     * LABEL BESIDE THE VALUE, not stacked over it. Stacked, the 12px caption
     * added a whole text line to the bar's height for a word that reads just as
     * well as a prefix; and the bar's height is what everything under it waits
     * behind.
     */
    &_field {
        display: flex;
        gap: var(--space-4);
        align-items: center;

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
        min-height: 36px;
        padding: var(--space-3) var(--space-4);
        border: 1px solid $surface5;
        border-radius: var(--radius-md);

        font-family: inherit;
        font-size: var(--font-size-sm);
        font-weight: 600;
        color: $content3;
        text-overflow: ellipsis;

        background: $surface0;

        &:focus-visible {
            outline: 2px solid $primary600;
            outline-offset: 1px;
        }
    }

    &_muted { color: $content7; }

    /*
     * THE BAR'S ONE BUTTON SHAPE: 36px, hairline, `--radius-md`, 14px. The two
     * toggles below draw it directly; the action buttons (`CommonButton`s
     * owned by this bar, the solver control and the blocked-day control) are
     * given the same shape through `:deep` further down, so a reader meets one
     * kind of control across the row instead of bordered toggles beside bare
     * text runs that happened to be buttons.
     */
    &_filters-toggle,
    &_violations-toggle {
        cursor: pointer;

        display: flex;
        gap: var(--space-3);
        align-items: center;

        min-height: 36px;
        padding: var(--space-3) var(--space-5);
        border: 1px solid $surface5;
        border-radius: var(--radius-md);

        font-family: inherit;
        font-size: var(--font-size-sm);
        color: $content6;

        background: $surface0;

        transition: border-color 140ms cubic-bezier(0.16, 1, 0.3, 1),
            color 140ms cubic-bezier(0.16, 1, 0.3, 1);

        svg {
            width: 15px;
            height: 15px;
        }

        @include hover() {
            &:hover {
                border-color: $surface6;
                color: $content3;
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

    /*
     * The action buttons, in the bar's shape. Scoped to the TRANSPARENT and
     * SECONDARY variants that sit directly in this row (Add event / Cancel
     * event, Proposals, the blocked-day trigger) and to nothing inside the
     * solver's or blocked-day's anchored panels, which have their own button
     * roles. The solver's idle trigger is the row's one PRIMARY: it is the only
     * action here that produces a schedule, and it keeps `CommonButton`'s
     * primary fill untouched.
     */
    &_group--end {
        > :deep(.button--type-transparent),
        > :deep(.button--type-secondary),
        :deep(.blockday > .button--type-transparent) {
            gap: var(--space-3);

            min-height: 36px;
            padding: var(--space-3) var(--space-5);
            border: 1px solid $surface5;
            border-radius: var(--radius-md);

            font-size: var(--font-size-sm);
            color: $content5;

            background: $surface0;

            transition: border-color 140ms cubic-bezier(0.16, 1, 0.3, 1),
                color 140ms cubic-bezier(0.16, 1, 0.3, 1);

            @include hover() {
                &:hover {
                    border-color: $surface6;
                    color: $content2;
                    background: $surface0;
                }
            }

            &:active,
            &:focus {
                background: $surface2;
            }

            .button_icon {
                width: 15px;
                min-width: 15px;
                color: $content6;
            }
        }

        /* The active "Cancel event" state: the same shape, pressed. */
        > :deep(.button--type-secondary) {
            border-color: $primary500;
            color: $content2;
            background: varToRgba('primary500', 0.16);
        }

        :deep(.solver > .button--type-primary) {
            gap: var(--space-3);

            min-height: 36px;
            padding: var(--space-3) var(--space-6);

            font-size: var(--font-size-sm);
            font-weight: 600;

            svg {
                width: 16px;
                height: 16px;
            }
        }
    }

    &_violations-hard {
        font-weight: 650;
        color: $error700;

        /*
         * A ZERO IS DRAWN, AND QUIETLY. The figure's position is what makes
         * the pair readable without being read, so it may not disappear; a red
         * 0 would claim a problem that is not there.
         */
        &.is-zero {
            font-weight: inherit;
            color: $content7;
        }
    }

    &_violations-soft {
        color: $content7;

        /* Decoration, so it is drawn rather than written into the message:
           the accessible name is built from `violationsLabel` and never
           inherits a punctuation mark from the visible label. */
        &::before {
            content: '·';
            margin-right: var(--space-3);
            color: $surface6;
        }
    }

    // Same treatment as `ManageList.vue`'s `.list_badge`: a small filled count,
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
