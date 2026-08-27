<!--
    THESIS: the schedule is a place, not a list of records — one week held still
    so a timetabler can see where a session sits and put it somewhere better. It
    refuses the admin-CRUD-table arrangement this category defaults to.
    OWN-WORLD: a restrained neutral ground (surface0-5) with the violet primary
    reserved almost entirely for one thing — where a session may land. Density
    and rhythm carry the design; colour is spent on state, not decoration. Built
    against a near-black ground, rebased to light in Step 11 for a data reason
    (see DESIGN.md); the composition is ground-agnostic and both themes render it.
    STORY: the visitor sees the week, spots what is wrong by its shape and icon
    rather than its hue, selects it, and moves it knowing the consequence.
    FIRST VIEWPORT: filter bar across the top; time column left; the week filling
    the remaining width; inspector docked right, empty until something is chosen.
    The primary action lives in the inspector, next to the thing it acts on.
    FORM: week grid with docked inspector — composition A of three offered; the
    dice script that would have dealt these produced no output (see CLAUDE.md),
    so the choice was made explicitly with the user instead.
    FINISH: unreviewed and undocumented is unfinished; this build ends with the
    finish review, the verdict, and DESIGN.md.
-->
<template>
    <main class="schedule">
        <!--
            The served document had no heading of any level and no `main`.
            Visually hidden because the week itself is the title — a rendered
            "Schedule" above a screen whose nav already says Schedule is noise
            for the sighted reader and the only orientation there is for anyone
            navigating by heading.
        -->
        <h1 class="schedule_sr">Schedule</h1>

        <ScheduleToolbar
            v-model:term-id="filters.termId.value"
            v-model:group-id="filters.groupId.value"
            v-model:room-id="filters.roomId.value"
            v-model:person-id="filters.personId.value"
            v-model:include-nested="filters.includeNested.value"
            v-model:row-height="rowHeight"
            v-model:show-violations="showViolations"
            :terms="data.terms.value"
            :groups="data.groups.value"
            :rooms="data.rooms.value"
            :people="data.people.value"
            :violation-count="data.violations.value.length"
            :can-read-violations="data.canReadViolations.value"
            :can-trigger-solver="canTriggerSolver"
            :can-review-proposals="canReviewProposals"
            :can-create-session="canCreateSession"
            :creating="editing.creating.value"
            :solver-term-id="data.resolvedTermId.value"
            @toggle-create="editing.toggleCreating"
        />

        <p
            v-if="editing.placing.value"
            class="schedule_placing"
            role="status"
        >
            <Icon
                name="material-symbols:touch-app-outline"
                aria-hidden="true"
            />
            Pick a slot for <strong>{{ sessionLabel(editing.selected.value) }}</strong>. Press Escape to cancel.
        </p>

        <p
            v-if="editing.creating.value && !pendingSlot"
            class="schedule_placing"
            role="status"
        >
            <Icon
                name="material-symbols:add-circle-outline"
                aria-hidden="true"
            />
            Pick a slot for the new event. Press Escape to cancel.
        </p>

        <p
            v-if="editing.error.value"
            class="schedule_error"
            role="alert"
        >{{ editing.error.value }}</p>

        <ScheduleEmptyState
            v-if="!data.pending.value && !data.grid.value"
            title="No time grid configured"
        >
            A schedule needs a TimeGrid — how long a block is, how many run per day,
            and which days this institution teaches on. Nothing is assumed on your behalf.
        </ScheduleEmptyState>

        <ScheduleEmptyState
            v-else-if="!data.pending.value && !data.terms.value.length"
            title="No terms yet"
        >
            Create a term to place sessions into.
        </ScheduleEmptyState>

        <div
            v-else-if="data.pending.value"
            class="schedule_loading"
        >
            <common-loader/>
        </div>

        <div
            v-else-if="data.grid.value"
            class="schedule_body"
        >
            <div class="schedule_main">
                <ScheduleWeekNav
                    v-model="filters.week.value"
                    class="schedule_week"
                    :total-weeks="data.totalWeeks.value"
                    :range-label="weekRangeLabel"
                />

                <!--
                    A flick of the wheel steps a week — bound HERE and on the
                    agenda and the week stepper, never on the page. Over the
                    off-grid tray or the violations panel a wheel is an ordinary
                    scroll, because those lists have their own content to move.
                -->
                <ScheduleGrid
                    class="schedule_grid"
                    :grid="data.grid.value"
                    :sessions="data.onGridSessions.value"
                    :violations="data.violationsBySessionId.value"
                    :selected-id="editing.selectedId.value"
                    :placing="editing.placing.value || editing.creating.value"
                    :swapping="editing.swapping.value"
                    :row-height="rowHeight"
                    :room-name="data.lookup.room"
                    :virtual-room-ids="data.virtualRoomIds.value"
                    :display="data.displaySettings.value"
                    :group-name="data.lookup.group"
                    :person-name="data.lookup.person"
                    :show-group="!filters.groupId.value"
                    :show-person="!filters.personId.value"
                    :term-week="filters.week.value"
                    :slot-date-of="data.slotDateOf"
                    :target-verb="editing.creating.value ? 'Add event at' : 'Move to'"
                    @select="editing.select"
                    @place="placeAt"
                    @wheel="stepWeekOnWheel"
                />

                <ScheduleEventForm
                    v-if="pendingSlot && data.resolvedTermId.value"
                    :grid="data.grid.value"
                    :term-id="data.resolvedTermId.value"
                    :week="filters.week.value"
                    :target="pendingSlot"
                    :rooms="data.rooms.value"
                    :groups="data.groups.value"
                    @cancel="cancelCreate"
                    @created="onEventCreated"
                />

                <ScheduleAgenda
                    class="schedule_agenda"
                    :grid="data.grid.value"
                    :sessions="data.onGridSessions.value"
                    :violations="data.violationsBySessionId.value"
                    :selected-id="editing.selectedId.value"
                    :placing="editing.placing.value || editing.creating.value"
                    :room-name="data.lookup.room"
                    :virtual-room-ids="data.virtualRoomIds.value"
                    :display="data.displaySettings.value"
                    :group-name="data.lookup.group"
                    :person-name="data.lookup.person"
                    :show-group="!filters.groupId.value"
                    :show-person="!filters.personId.value"
                    :target-verb="editing.creating.value ? 'Add event at' : 'Move to'"
                    @wheel="stepWeekOnWheel"
                    @select="editing.select"
                    @place="placeAt"
                />

                <ScheduleOffGridTray
                    v-if="data.offGridSessions.value.length"
                    :sessions="data.offGridSessions.value"
                    :grid="data.grid.value"
                    @select="editing.select"
                />

                <ScheduleViolationsPanel
                    v-if="showViolations && data.canReadViolations.value"
                    :violations="data.violations.value"
                    :lookup="data.lookup"
                    :session-title="data.sessionTitle"
                    @select="editing.select"
                />
            </div>

            <ScheduleInspector
                :session="editing.selected.value"
                :grid="data.grid.value"
                :violations="editing.selected.value
                    ? (data.violationsBySessionId.value.get(editing.selected.value.id) ?? [])
                    : []"
                :can-move="canMove"
                :can-lock="canLock"
                :placing="editing.placing.value"
                :swapping="editing.swapping.value"
                :can-swap="canSwap"
                :can-delete="canDeleteSession"
                :can-update="canUpdateSession"
                :kinds="data.kinds.value"
                :people="data.people.value"
                :groups="data.groups.value"
                :session-date="editing.selected.value
                    ? data.slotDateOf(editing.selected.value.termWeek, editing.selected.value.dayOfWeek)
                    : null"
                :rooms="data.rooms.value"
                :busy="editing.busy.value"
                :lookup="data.lookup"
                @close="editing.clearSelection"
                @toggle-place="editing.togglePlacing"
                @toggle-swap="editing.toggleSwapping"
                @set-rooms="editing.setRooms"
                @toggle-lock="editing.toggleLock"
                @delete="deleteSelectedEvent"
                @set-details="saveEventDetails"
            />
        </div>
    </main>
</template>

<script setup lang="ts">
import ScheduleAgenda from '~/components/schedule/ScheduleAgenda.vue';
import ScheduleEmptyState from '~/components/schedule/ScheduleEmptyState.vue';
import ScheduleEventForm from '~/components/schedule/ScheduleEventForm.vue';
import { formatSlotDate, sessionLabel } from '~/composables/schedule';
import { useViewerLocale } from '~/composables/locale';
import ScheduleGrid from '~/components/schedule/ScheduleGrid.vue';
import ScheduleInspector from '~/components/schedule/ScheduleInspector.vue';
import ScheduleOffGridTray from '~/components/schedule/ScheduleOffGridTray.vue';
import ScheduleToolbar from '~/components/schedule/ScheduleToolbar.vue';
import ScheduleWeekNav from '~/components/schedule/ScheduleWeekNav.vue';
import ScheduleViolationsPanel from '~/components/schedule/ScheduleViolationsPanel.vue';
import { useScheduleData } from '~/composables/scheduleData';
import { useScheduleEditing } from '~/composables/scheduleEditing';
import { useScheduleFilters } from '~/composables/scheduleFilters';
import { useHasPermission } from '~/composables/session';
import { useWheelStep } from '~/composables/wheelStep';

/**
 * Composition only. Three composables own the state, seven components own the
 * rendering; this file decides what sits next to what.
 *
 *   useScheduleFilters  — what changes the API query
 *   useScheduleData     — server state and everything derived from it
 *   useScheduleEditing  — selection, placement mode, mutations
 */
useHead({ title: 'Schedule' });

// UX only. Every one of these is re-checked server-side; a client that forges
// them reaches an endpoint that returns 403.
// Every solver route requires this one, so it gates the whole control.
/**
 * Gated on every permission the reference wave needs, not just `session.read`.
 * See `app/utils/schedulePermissions.ts` — the page renders nothing useful
 * without all six, and used to render nothing AT ALL.
 */
definePageMeta({ middleware: 'schedule' });

const locale = useViewerLocale();

const canTriggerSolver = useHasPermission('solver.trigger');
/**
 * The proposals list, not the solver. Reviewing what the solver produced needs
 * `session.read`; producing it needs `solver.trigger`. A department head
 * typically holds the first and not the second, and used to have no route to a
 * proposal at all.
 */
const canReviewProposals = useHasPermission('session.read');
const canCreateSession = useHasPermission('session.create');
const canDeleteSession = useHasPermission('session.delete');
const canUpdateSession = useHasPermission('session.update');
/**
 * A placement carries the week currently on screen.
 *
 * The grid shows one week and has no idea which, so the page — which owns
 * `filters.week` — supplies it. That is what makes a cross-week move possible:
 * enter placement mode, step to another week, click a slot.
 */
/**
 * ONE grid click, routed by the mode that made the cells targets.
 *
 * `create` opens the form seeded with the slot rather than issuing a request:
 * a new Session needs a kind, which no click can supply. `place` still moves
 * the selection immediately, because everything a move needs is already known.
 */
/**
 * The dates this week covers — "13–17 Oct".
 *
 * A week NUMBER is an abstraction over the term; the dates are what someone
 * checks against a calendar, an email or a room booking. Resolved from the
 * grid's own active days, so a Saturday-teaching institution gets a span that
 * ends on Saturday rather than an assumed Friday.
 *
 * Empty until a term resolves, rather than guessed: `slotDateOf` returns null
 * before then, and a date range invented from today would be wrong in exactly
 * the way this codebase keeps refusing to be.
 */
const weekRangeLabel = computed(() => {
    const days = data.grid.value?.activeDays ?? [];
    const first = days[0];
    const last = days[days.length - 1];

    if (first === undefined || last === undefined) {
        return '';
    }

    const from = data.slotDateOf(filters.week.value, first);
    const to = data.slotDateOf(filters.week.value, last);

    if (!from || !to) {
        return '';
    }

    return `${formatSlotDate(from, locale.value)} – ${formatSlotDate(to, locale.value)}`;
});

/**
 * A wheel over the WEEK GRID or the DAY AGENDA steps the week.
 *
 * The week stepper in the toolbar carries the same gesture, through the same
 * composable, so the cooldown and the give-the-gesture-back-at-the-ends rule
 * cannot drift between the two places that offer it.
 */
const stepWeekOnWheel = useWheelStep({
    canStep: (direction) => {
        const next = filters.week.value + direction;

        return next >= 1 && next <= data.totalWeeks.value;
    },
    step: (direction) => {
        filters.week.value += direction;
    },
});

function placeAt(target: { dayOfWeek: number; blockIndex: number }) {
    if (editing.creating.value) {
        pendingSlot.value = target;

        return;
    }

    return editing.move({ ...target, termWeek: filters.week.value });
}

const pendingSlot = ref<{ dayOfWeek: number; blockIndex: number } | null>(null);

function cancelCreate() {
    pendingSlot.value = null;
    editing.endCreating();
}

/**
 * Deletes the selected EVENT.
 *
 * Routed through the page rather than `useScheduleEditing` because deletion is
 * not a grid MODE — it changes nothing about what a click on the grid means,
 * which is the composable's own stated test for what belongs there.
 */
/**
 * One request per control, matching how rooms already save.
 *
 * Not a form with a Save button: the inspector edits a live row, and a single
 * button spanning four independent fields could half-succeed with one error
 * message covering all of them — the same objection the relations panel records
 * for PUT-set sub-resources.
 */
async function saveEventDetails(patch: Record<string, unknown>) {
    const target = editing.selected.value;

    if (!target || target.offeringId !== null) {
        return;
    }

    try {
        await $fetch(`/api/sessions/${target.id}/details`, { method: 'POST', body: patch });
        await data.refreshAll();
    } catch (caught: unknown) {
        const detail = (caught as { data?: { statusMessage?: string } }).data;

        editing.error.value = detail?.statusMessage ?? 'Could not save that change.';
    }
}

async function deleteSelectedEvent() {
    const target = editing.selected.value;

    if (!target || target.offeringId !== null) {
        return;
    }

    try {
        await $fetch(`/api/sessions/${target.id}`, { method: 'DELETE' });
        editing.clearSelection();
        await data.refreshAll();
    } catch (caught: unknown) {
        const detail = (caught as { data?: { statusMessage?: string } }).data;

        // Surfaced in the same place every other editing failure is, rather
        // than as a toast that outlives the screen it refers to.
        editing.error.value = detail?.statusMessage ?? 'Could not delete that event.';
    }
}

async function onEventCreated() {
    pendingSlot.value = null;
    editing.endCreating();
    await data.refreshAll();
}

const canMove = useHasPermission('session.move');
const canSwap = useHasPermission('session.swap');
const canLock = useHasPermission('session.lock');

const filters = useScheduleFilters();

// The composable is synchronous by design; this is the single await, at setup
// top level where Nuxt keeps its instance context. SSR must resolve before the
// first render — a page that hydrates from an empty render is indistinguishable
// from a tenant with no schedule.
const data = useScheduleData(filters);

await data.ready;

const editing = useScheduleEditing({
    sessions: data.allSessions,
    onMutated: data.refreshAll,
});

/**
 * View state, deliberately page-local: neither value reaches the API query, so
 * neither belongs in useScheduleFilters.
 */
const rowHeight = ref(60);
const showViolations = ref(false);
</script>

<style scoped lang="scss">
.schedule {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: var(--space-7) 24px var(--space-8);

    @include mobile() { padding: 14px; }

    // Centred over the thing it governs, and given room above the grid so the
    // pairing reads as "this week" rather than as another toolbar row.
    &_week {
        align-self: center;
        margin-bottom: var(--space-2);
    }

    &_sr {
        position: absolute;

        overflow: hidden;

        width: 1px;
        height: 1px;

        white-space: nowrap;

        clip-path: inset(50%);
    }

    &_placing {
        display: flex;
        gap: var(--space-4);
        align-items: center;

        margin: 0;
        padding: 10px 14px;
        border-radius: var(--radius-lg);

        font-size: var(--font-size-md);
        color: $content4;

        background: varToRgba('primary500', 0.16);

        svg { flex: none; width: var(--space-6); height: var(--space-6); }

        strong { font-weight: 650; }
    }

    &_error {
        margin: 0;
        padding: 10px 14px;
        border-radius: var(--radius-lg);

        font-size: var(--font-size-md);
        color: $error700;

        background: rgb(169, 45, 70, 0.16);
    }

    &_body {
        display: flex;
        gap: 14px;
        align-items: flex-start;

        @include mobile() { flex-direction: column; }
    }

    &_main {
        display: flex;
        flex: 1;
        flex-direction: column;
        gap: 14px;

        min-width: 0;
    }

    &_grid {
        @include mobile() { display: none; }
    }

    &_agenda {
        display: none;

        @include mobile() { display: flex; }
    }

    &_loading {
        display: flex;
        justify-content: center;
        padding: 60px 0;
    }
}
</style>
