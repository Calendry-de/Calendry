<!--
    The schedule is a place, not a list of records: one week held still so a
    timetabler can see where a session sits and put it somewhere better. Design
    intent and the palette rationale live in DESIGN.md.
-->
<template>
    <main class="schedule">
        <!--
            Visually hidden: the week itself is the title, but a document with no
            heading and no `main` leaves nothing to navigate by.

            It NAMES THE SCOPE, because the two pages are genuinely different and
            a screen reader gets no other signal: with `session.read_own` this is
            one person's timetable, not a sparse version of the institution's, and
            "Schedule" over three chips reads as a tenant with almost nothing in
            it. Taken from the server's answer, never from the permission.
        -->
        <h1 class="schedule_sr">{{ data.scope.value === 'own' ? 'Your schedule' : 'Schedule' }}</h1>

        <ScheduleToolbar
            ref="toolbar"
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
            :week="filters.week.value"
            :active-days="data.grid.value?.activeDays ?? []"
            :slot-date-of="data.slotDateOf"
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

        <!--
            THE FAILURE BRANCH COMES FIRST. "No time grid configured" is a claim
            about the TENANT and may only be made once the tenant has been read;
            below this, a dropped connection told the reader to create a TimeGrid
            they already have.
        -->
        <div
            v-if="data.loadError.value"
            class="schedule_failure"
            role="alert"
        >
            <Icon
                name="material-symbols:cloud-off-outline"
                aria-hidden="true"
            />
            <h2>{{ data.loadError.value.title }}</h2>
            <p>{{ data.loadError.value.detail }}</p>
            <CommonButton
                v-if="data.loadError.value.retryable"
                type="secondary"
                @click="data.refreshAll"
            >Try again</CommonButton>
        </div>

        <ScheduleEmptyState
            v-else-if="!data.pending.value && !data.grid.value"
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

        <!--
            PENDING IS A STATE ON THE GRID, NOT A BRANCH THAT REPLACES THE BODY.
            `week` is a member of `filters.query`, this page's fetch watch source,
            so as a sibling branch it destroyed the whole frame on every week step
            — losing focus to `<body>` and killing the label's transition with its
            parent. Only the chips change with the query, so the frame stays
            mounted and reports its own staleness.

            The empty states below stay branches: genuinely different screens,
            unreachable by stepping a week.
        -->
        <div
            v-else-if="data.grid.value"
            class="schedule_body"
            :aria-busy="data.pending.value"
        >
            <div
                class="schedule_main"
                :class="{ 'schedule_main--pending': data.pending.value }"
            >
                <ScheduleWeekNav
                    v-model="filters.week.value"
                    class="schedule_week"
                    :total-weeks="data.totalWeeks.value"
                    :range-label="weekRangeLabel"
                    :loading="data.pending.value"
                />

                <!-- Wheel-to-step is bound here, on the agenda and on the week
                     stepper, never on the page: over the tray or the violations
                     panel a wheel is an ordinary scroll. -->
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
                    :kinds="data.kinds.value"
                    :kinds-readable="canReadSessionKinds"
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

            </div>

            <!--
                THE SIDE COLUMN IS THE SELECTION'S COLUMN. The tray and the
                violations panel were below a 600–810px grid, so the toggle that
                opens the panel sat top-right and its effect appeared ~700px
                down: pressing it looked like nothing happened. Every row in both
                lists feeds the inspector, so they belong in its column.
            -->
            <aside class="schedule_side">
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
                    :can-assign-lecturer="canAssignLecturer"
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
                    @set-lecturers="saveLecturers"
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
                    :can-repair="canTriggerSolver"
                    @select="editing.select"
                    @repair="toolbar?.startRepair()"
                />
            </aside>
        </div>
    </main>
</template>

<script setup lang="ts">
import ScheduleAgenda from '~/components/schedule/ScheduleAgenda.vue';
import CommonButton from '~/components/common/CommonButton.vue';
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
 * Gated on every permission the reference wave needs, not just `session.read`
 * (`app/utils/schedulePermissions.ts`): without all six the page used to render
 * nothing at all.
 */
definePageMeta({ middleware: 'schedule' });

const locale = useViewerLocale();

const canTriggerSolver = useHasPermission('solver.trigger');

/*
 * The toolbar owns the solver control, and therefore the single `useSolverRun`
 * for this Term. The violations panel starts a repair through it rather than
 * holding its own, so one run has one poller and renders in one place wherever
 * it was started from.
 */
const toolbar = useTemplateRef<{ startRepair: () => void }>('toolbar');
/**
 * The proposals list, not the solver: reviewing needs `session.read`, producing
 * needs `solver.trigger`, and a department head typically holds only the first.
 */
/*
 * `generation.read`, matching the route and the nav entry. It was `session.read`,
 * which offered the Proposals button to everybody who could see the grid.
 */
const canReviewProposals = useHasPermission('generation.read');
const canCreateSession = useHasPermission('session.create');
const canDeleteSession = useHasPermission('session.delete');
const canUpdateSession = useHasPermission('session.update');
const canAssignLecturer = useHasPermission('session.assign_lecturer');
/**
 * A placement carries the week on screen — the grid does not know which week it
 * shows, so the page supplies it. That is what makes a cross-week move possible.
 */
/**
 * ONE grid click, routed by the mode that made the cells targets. `create` opens
 * the form seeded with the slot rather than issuing a request: a new Session
 * needs a kind, which no click can supply.
 */
/**
 * The dates this week covers — "13–17 Oct". A week number is an abstraction over
 * the term; the dates are what someone checks against a calendar. Resolved from
 * the grid's own active days, and empty until a term does rather than guessed.
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
 * A wheel over the grid or the agenda steps the week, through the same composable
 * as the toolbar's stepper so the cooldown cannot drift between them.
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

/**
 * Focus goes back to the control that started the flow.
 *
 * Closing the event form left `document.activeElement` as `<body>` (verified over
 * CDP), so a keyboard user's next Tab restarted at the top of the document. The
 * form cannot fix this itself: the element it was opened from is a grid cell that
 * becomes `disabled` when create mode ends, so it is connected and unfocusable.
 *
 * Found by attribute rather than threaded as a ref through two components: what
 * matters is that a control still exists to receive focus, and the toolbar's
 * create toggle is the one thing guaranteed to, since its own permission gate is
 * what put us here.
 */
function restoreCreateFocus() {
    nextTick(() => {
        document.querySelector<HTMLElement>('[data-create-toggle]')?.focus();
    });
}

function cancelCreate() {
    pendingSlot.value = null;
    editing.endCreating();
    restoreCreateFocus();
}

/**
 * Routed through the page rather than `useScheduleEditing` because deletion is
 * not a grid MODE — it changes nothing about what a click on the grid means.
 */
/**
 * One request per control, matching how rooms already save. Not a form with a
 * Save button: a single button over four independent fields could half-succeed
 * with one error message covering all of them.
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

/**
 * A locked Session's lecturer, or an Event's — the two cases `lecturers.post.ts`
 * accepts. No `offeringId !== null` bail-out here, unlike `saveEventDetails`:
 * that guard exists because `details.post.ts` refuses every Offering-linked
 * Session outright, and this route does not.
 */
async function saveLecturers(personIds: string[]) {
    const target = editing.selected.value;

    if (!target) {
        return;
    }

    try {
        await $fetch(`/api/sessions/${target.id}/lecturers`, { method: 'POST', body: { personIds } });
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
    restoreCreateFocus();
    await data.refreshAll();
}

/**
 * Whether an empty `data.kinds` means "none configured" or "not readable" — the
 * reference wave degrades to `[]` on a 403 so one missing permission cannot blank
 * the page, which makes the two indistinguishable at the point of use.
 */
const canReadSessionKinds = useHasPermission('session_kind.read');

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

/** Page-local: neither value reaches the API query. */
const rowHeight = ref(60);
const showViolations = ref(false);
</script>

<style scoped lang="scss">
.schedule {
    /*
     * THREE INTERVALS, NOT ONE. Every region was separated by the same 14px, so
     * the screen had two levels of hierarchy: the grid, and everything else.
     * `--space-7` between REGIONS, `--space-5` between members of a region,
     * `--space-3/4` inside a group — all steps on the documented scale, which
     * 14 / 20 / 10 / 18 were not.
     */
    display: flex;
    flex-direction: column;
    gap: var(--space-7);
    padding: var(--space-7) var(--space-7) var(--space-8);

    @include mobile() { padding: var(--space-5); }

    /* The week belongs to the GRID, so the interval goes above it and none
       below: proximity assigns ownership, and `margin-bottom` assigned it to the
       toolbar. */
    &_week {
        align-self: center;
        margin-top: calc(var(--space-5) - var(--space-7));
    }

    &_sr {
        position: absolute;

        overflow: hidden;

        width: 1px;
        height: 1px;

        white-space: nowrap;

        clip-path: inset(50%);
    }

    /* A load failure is a PAGE state, not a line above an empty grid, so nobody
       reads an absent grid as the answer. */
    &_failure {
        display: flex;
        flex-direction: column;
        gap: var(--space-4);
        align-items: center;

        padding: var(--space-10) var(--space-6);
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

    &_placing {
        display: flex;
        gap: var(--space-4);
        align-items: center;

        margin: 0;
        padding: var(--space-5) var(--space-6);
        border-radius: var(--radius-lg);

        font-size: var(--font-size-md);
        color: $content4;

        background: varToRgba('primary500', 0.16);

        svg {
            flex: none;
            width: var(--space-6);
            height: var(--space-6);
        }

        strong { font-weight: 650; }
    }

    &_error {
        margin: 0;
        padding: var(--space-4) var(--space-6);
        border-radius: var(--radius-lg);

        font-size: var(--font-size-md);
        color: $error700;

        background: rgb(169, 45, 70, 0.16);
    }

    &_body {
        display: flex;
        gap: var(--space-7);
        align-items: flex-start;

        @include mobile() { flex-direction: column; }
    }

    &_main {
        display: flex;
        flex: 1;
        flex-direction: column;
        gap: var(--space-5);

        min-width: 0;

        /*
         * STALE, NOT GONE — the frame stays mounted while the week refetches, so
         * the grid says it is out of date instead of being replaced. Pointer
         * events go with it: a click on a chip about to be replaced would select
         * a session the next render may not contain.
         */
        &--pending {
            pointer-events: none;

            .schedule_grid,
            .schedule_agenda {
                opacity: 0.45;
                transition: opacity 180ms cubic-bezier(0.16, 1, 0.3, 1);
            }
        }
    }

    /*
     * THE SIDE COLUMN EARNS ITS WIDTH OR GIVES IT BACK. A permanent 320px
     * reservation left ~199px per day column at 1440px, and `FAN_LIMIT = 3` is
     * calibrated on that number — so a third of the width was held for a panel
     * that is usually empty. It now sizes to its content and takes none when
     * there is none.
     *
     * STICKY, because the action must stay with the selection: at Spacious the
     * grid alone is ~810px.
     */
    &_side {

        // Thin, because this column is often taller than the viewport and the
        // scrollbar should not read as a second border.
        scrollbar-width: thin;

        position: sticky;
        top: var(--space-5);

        overflow-y: auto;
        display: flex;
        flex: 0 0 auto;
        flex-direction: column;
        gap: var(--space-5);

        max-height: calc(100vh - var(--space-9));

        @include mobile() {
            position: static;
            overflow: visible;
            max-height: none;
        }
    }

    &_grid {
        @include mobile() { display: none; }
    }

    &_agenda {
        display: none;

        @include mobile() { display: flex; }
    }

}
</style>
