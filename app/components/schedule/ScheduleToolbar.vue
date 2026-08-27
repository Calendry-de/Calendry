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
                >
                    <!--
                        `:selected` explicitly, and not for symmetry.

                        `filters.termId` is `ref('')` seeded by a watchEffect
                        that Vue never flushes during SSR, so this select emitted
                        no `selected` attribute at all and the browser fell back
                        to option 1. That is the right term TODAY only because
                        `resolvedTermId` also falls back to `terms[0]` — the
                        displayed term and the fetched term agree by coincidence
                        of ordering rather than by binding.
                    -->
                    <option
                        v-for="term in terms"
                        :key="term.id"
                        :value="term.id"
                        :selected="term.id === (termIdModel || terms[0]?.id)"
                    >{{ term.name }}</option>
                </select>
            </label>

            <!--
                The week stepper carries the wheel gesture too — it is the
                control the arrows are on, so it is the one place a reader would
                try it first. Same composable as the grid, so the two cannot
                drift apart.
            -->
            <div
                class="bar_week"
                role="group"
                aria-label="Week"
                @wheel="stepWeekOnWheel"
            >
                <button
                    type="button"
                    :disabled="weekModel <= 1"
                    aria-label="Previous week"
                    @click="weekModel = Math.max(1, weekModel - 1)"
                >
                    <Icon
                        name="material-symbols:chevron-left"
                        aria-hidden="true"
                    />
                </button>
                <span class="bar_week-label">Week {{ weekModel }}<span class="bar_muted"> / {{ totalWeeks }}</span></span>
                <button
                    type="button"
                    :disabled="weekModel >= totalWeeks"
                    aria-label="Next week"
                    @click="weekModel = Math.min(totalWeeks, weekModel + 1)"
                >
                    <Icon
                        name="material-symbols:chevron-right"
                        aria-hidden="true"
                    />
                </button>
            </div>
        </div>

        <div class="bar_group">
            <label class="bar_field">
                <span>Group</span>
                <select
                    v-model="groupIdModel"
                    class="bar_select"
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

        <div class="bar_group bar_group--end">
            <!-- Same rule as the solver control below: hidden entirely without
                 `session.create`, not disabled. There is no read-only version
                 of "add an event" to show, and a disabled control reads as
                 "unavailable right now" rather than "not yours". -->
            <common-button
                v-if="canCreateSession && solverTermId"
                :icon="creating ? 'material-symbols:close' : 'material-symbols:add'"
                :type="creating ? 'secondary' : 'transparent'"
                @click="$emit('toggle-create')"
            >{{ creating ? 'Cancel event' : 'Add event' }}</common-button>

            <!-- Hidden entirely without solver.trigger, not disabled: every
                 solver route requires that permission, so there is no read-only
                 version of this control to show. -->
            <ScheduleSolverControl
                v-if="canTriggerSolver && solverTermId"
                :term-id="solverTermId"
            />

            <!--
                THE DURABLE WAY TO A PROPOSAL.
                The solver control's own "Review" button is a HANDOFF for the
                person who just started a run: it lives in a transient `finished`
                state that a page reload destroys, and `adopt()` only re-adopts
                runs that are still ACTIVE. So a proposal was reachable for
                minutes, by one person. This link does not expire, and it is
                gated on `session.read` rather than `solver.trigger` — the
                department head who reviews a schedule is usually not the person
                allowed to generate one.
            -->
            <common-button
                v-if="canReviewProposals"
                icon="material-symbols:fact-check-outline"
                type="transparent"
                to="/schedule/proposals"
            >Proposals</common-button>

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

            <!-- Permission-gated: a caller without violation.read gets no
                 affordance for data the API would refuse them anyway. -->
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
    </section>
</template>

<script setup lang="ts">
import ScheduleSolverControl from '~/components/schedule/ScheduleSolverControl.vue';
import type { NamedRow, Term } from '~/composables/schedule';
import { useWheelStep } from '~/composables/wheelStep';

const props = defineProps<{
    terms: Term[];
    groups: NamedRow[];
    rooms: NamedRow[];
    people: NamedRow[];
    totalWeeks: number;
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

// Filter values are owned by useScheduleFilters() and reach this component as
// models — the toolbar renders and edits them, it does not own them.
const termIdModel = defineModel<string>('termId', { required: true });
const weekModel = defineModel<number>('week', { required: true });

const stepWeekOnWheel = useWheelStep({
    canStep: (direction) => {
        const next = weekModel.value + direction;

        return next >= 1 && next <= props.totalWeeks;
    },
    step: (direction) => {
        weekModel.value += direction;
    },
});
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
    display: flex;
    flex-wrap: wrap;
    gap: 10px 20px;
    align-items: flex-end;

    padding: 14px 16px;
    border-radius: var(--radius-xl);

    background: $surface1;

    &_group {
        display: flex;
        flex-wrap: wrap;
        gap: 10px 14px;
        align-items: flex-end;

        &--end { margin-left: auto; }
    }

    &_field {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);

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

        min-width: 120px;
        padding: var(--space-3) var(--space-4);
        border: 1px solid $surface5;
        border-radius: var(--radius-md);

        font-family: inherit;
        font-size: var(--font-size-md);
        color: $content5;

        background: $surface0;

        &:focus-visible { outline: 2px solid $primary400; outline-offset: 1px; }
    }

    &_check {
        display: flex;
        gap: var(--space-3);
        align-items: center;

        padding-bottom: 7px;

        font-size: var(--font-size-sm);
        color: $content6;

        input { accent-color: $primary500; }
    }

    &_week {
        display: flex;
        gap: var(--space-1);
        align-items: center;

        padding: var(--space-1);
        border: 1px solid $surface5;
        border-radius: var(--radius-md);

        background: $surface0;

        button {
            cursor: pointer;

            display: flex;
            // Centred, and it has to be said: the target is 44px while the icon
            // is 16px, so without this the glyph sits in the top-left corner of
            // its own button. Raising a target without centring what is in it
            // moves the mark off the middle of the thing it marks.
            align-items: center;
            justify-content: center;

            // 44px: the week stepper is the most-repeated control on the screen.
            min-width: 44px;
            min-height: 44px;
            padding: var(--space-2);
            border: 0;
            border-radius: var(--radius-sm);

            color: $content6;

            background: none;

            &:disabled { cursor: default; color: $surface6; }

            @include hover() {
                &:not(:disabled):hover { background: $surface3; }
            }

            &:focus-visible { outline: 2px solid $primary400; }
        }

        &-label {
            padding: 0 var(--space-3);
            font-size: var(--font-size-md);
            font-variant-numeric: tabular-nums;
            color: $content5;
        }
    }

    &_muted { color: $content7; }

    &_violations-toggle {
        cursor: pointer;

        display: flex;
        gap: var(--space-3);
        align-items: center;

        padding: 7px var(--space-5);
        border: 1px solid $surface5;
        border-radius: var(--radius-md);

        font-family: inherit;
        font-size: var(--font-size-sm);
        color: $content6;

        background: $surface0;

        svg { width: 15px; height: 15px; }

        @include hover() {
            &:hover { border-color: $surface6; color: $content4; }
        }

        &:focus-visible { outline: 2px solid $primary400; outline-offset: 1px; }

        &--active {
            border-color: $primary500;
            color: $content2;
            background: varToRgba('primary500', 0.16);
        }
    }
}
</style>
