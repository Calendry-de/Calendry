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
        <h1 class="schedule_sr">{{ data.scope.value === 'own'
            ? t('schedule.page.headingOwn')
            : t('schedule.page.heading') }}</h1>

        <!--
            TWO ELEMENTS FOR ONE SENTENCE, and the split is load-bearing.

            This region is mounted for the life of the page and is never
            `display: none`, because a screen reader announces a CHANGE inside a
            region it was already observing: a region that appears with its text
            already in it, or that is hidden at the moment the text changes, is
            reliably announced by nothing. The visible strip below is ordinary
            content and carries `aria-hidden`, so the same sentence is not read
            twice.

            It sits above every branch on purpose: an edit's outcome must be
            announceable whichever state the body is in.
        -->
        <p
            class="schedule_sr"
            role="status"
            aria-live="polite"
        >{{ feedback }}</p>

        <ScheduleToolbar
            ref="toolbar"
            v-model:filters-open="filtersOpen"
            v-model:show-violations="showViolations"
            v-model:term-id="filters.termId.value"
            :terms="data.terms.value"
            :active-filter-count="activeFilterCount"
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

        <ScheduleFilterPanel
            v-model:open="filtersOpen"
            v-model:group-id="filters.groupId.value"
            v-model:room-id="filters.roomId.value"
            v-model:person-id="filters.personId.value"
            v-model:include-nested="filters.includeNested.value"
            v-model:week="filters.week.value"
            :groups="data.groups.value"
            :rooms="data.rooms.value"
            :people="data.people.value"
            :term="data.term.value"
            :total-weeks="data.totalWeeks.value"
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
            <!--
                `<i18n-t>` rather than text-strong-text: German moves the verb
                to the end of the clause, so the session's name has to be a
                placeholder the translator can position, not a fixed middle.
            -->
            <i18n-t
                keypath="schedule.page.placingHint"
                tag="span"
                scope="global"
            >
                <template #label>
                    <strong>{{ sessionLabel(editing.selected.value) }}</strong>
                </template>
            </i18n-t>
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
            {{ t('schedule.page.creatingHint') }}
        </p>

        <!--
            THE ACKNOWLEDGEMENT. A move, swap, lock or room change used to end in
            silence: the mode dropped, the grid refetched, and nothing said what
            had happened or what it cost. Same slot and same shape as the placing
            strip above, because it is the other half of that conversation: one
            line says what to do next, this one says what was done.

            Dismisses itself (see `feedbackTimer`) rather than carrying a close
            button: an outcome is transient by nature, and a control to
            acknowledge an acknowledgement is chrome.
        -->
        <p
            v-if="feedback"
            class="schedule_done"
            aria-hidden="true"
        >
            <Icon
                name="material-symbols:check-circle-outline"
                aria-hidden="true"
            />
            {{ feedback }}
        </p>

        <!--
            DISMISSIBLE, unlike before: `editing.error` is cleared only by the
            next mutation attempt, so a failed move's message sat above the grid
            indefinitely, including long after the reader had moved on to
            something unrelated, where it reads as a fresh failure of whatever
            they are doing now.
        -->
        <p
            v-if="editing.error.value"
            class="schedule_error"
            role="alert"
        >
            <span>{{ editing.error.value }}</span>
            <button
                type="button"
                class="schedule_error-dismiss"
                :aria-label="t('schedule.page.dismissError')"
                @click="editing.error.value = ''"
            >
                <Icon
                    name="material-symbols:close"
                    aria-hidden="true"
                />
            </button>
        </p>

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
            >{{ t('common.action.retry') }}</CommonButton>
        </div>

        <ScheduleEmptyState
            v-else-if="!data.pending.value && !data.grid.value"
            :title="t('schedule.page.noGridTitle')"
        >
            {{ t('schedule.page.noGridBody') }}
        </ScheduleEmptyState>

        <ScheduleEmptyState
            v-else-if="!data.pending.value && !data.terms.value.length"
            :title="t('schedule.page.noTermsTitle')"
        >
            {{ t('schedule.page.noTermsBody') }}
        </ScheduleEmptyState>

        <!--
            PENDING IS A STATE ON THE GRID, NOT A BRANCH THAT REPLACES THE BODY.
            `week` is a member of `filters.query`, this page's fetch watch source,
            so as a sibling branch it destroyed the whole frame on every week step,
            losing focus to `<body>` and killing the label's transition with its
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
                >
                    <!--
                        ISSUE #109. Was a full text button filed among Add
                        Event/Proposals/the solver control in the toolbar's
                        actions group, the most-clicked-but-least-costly action
                        sitting shoulder to shoulder with the most consequential
                        ones. Icon-only beside the arrows it steps the same
                        value as: what it does is legible from where it sits.
                        Gated on a resolved Term alone, same as the toolbar's
                        other term-scoped actions, not on today actually
                        falling inside the visible term/week, which
                        `jumpToToday` decides at CLICK time with a graceful
                        fallback (nearest boundary week) rather than by hiding
                        the control.
                    -->
                    <template
                        v-if="data.resolvedTermId.value"
                        #trailing
                    >
                        <button
                            type="button"
                            class="schedule_today"
                            :aria-label="t('schedule.weekNav.today')"
                            @click="jumpToToday"
                        >
                            <Icon
                                name="material-symbols:today-outline"
                                aria-hidden="true"
                            />
                        </button>
                    </template>
                </ScheduleWeekNav>

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
                    :term-start="data.term.value?.startDate ?? null"
                    :tenant-timezone="data.tenantTimezone.value"
                    :target-verb="editing.creating.value
                        ? t('schedule.page.targetVerbCreate')
                        : t('schedule.page.targetVerbMove')"
                    @select="onSelect"
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
                    ref="agenda"
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
                    :target-verb="editing.creating.value
                        ? t('schedule.page.targetVerbCreate')
                        : t('schedule.page.targetVerbMove')"
                    @wheel="stepWeekOnWheel"
                    @select="onSelect"
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
                    :can-bank="canBankSession"
                    :can-update="canUpdateSession"
                    :can-assign-lecturer="canAssignLecturer"
                    :can-substitute="canSubstitute"
                    :kinds="data.kinds.value"
                    :people="data.people.value"
                    :groups="data.groups.value"
                    :session-date="selectedPlacement
                    ? data.slotDateOf(selectedPlacement.termWeek, selectedPlacement.dayOfWeek)
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
                    @bank="editing.bankSelected"
                    @set-details="saveEventDetails"
                    @set-lecturers="saveLecturers"
                    @substitute="saveSubstitute"
                    @uncover="removeSubstitute"
                    />

                <ScheduleOffGridTray
                    v-if="data.offGridSessions.value.length"
                    :sessions="data.offGridSessions.value"
                    :grid="data.grid.value"
                    @select="onSelect"
                />

                <!--
                    THE SPARE BANK (issue #22). Read-only, like the off-grid
                    tray: selecting a row shows it in the Inspector, whose own
                    "Place…" action (relabelled from "Move…" for a banked
                    subject) is the whole restore path, so this list does not
                    duplicate that machinery.
                -->
                <ScheduleSpareBank
                    v-if="data.bankedSessions.value.length"
                    :sessions="data.bankedSessions.value"
                    @select="editing.select"
                />

                <ScheduleViolationsPanel
                    v-if="showViolations && data.canReadViolations.value"
                    :violations="data.violations.value"
                    :lookup="data.lookup"
                    :session-title="data.sessionTitle"
                    :can-repair="canTriggerSolver"
                    @select="onSelect"
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
import { blockTime, formatSlotDate, joinAnd, sessionLabel, weekdayName } from '~/composables/schedule';
import { autoRowHeight } from '~/composables/gridGeometry';
import { useT } from '~/composables/i18n';
import type { ScheduleAction } from '~/composables/scheduleEditing';
import { useViewerLocale } from '~/composables/locale';
import ScheduleGrid from '~/components/schedule/ScheduleGrid.vue';
import ScheduleInspector from '~/components/schedule/ScheduleInspector.vue';
import ScheduleOffGridTray from '~/components/schedule/ScheduleOffGridTray.vue';
import ScheduleSpareBank from '~/components/schedule/ScheduleSpareBank.vue';
import ScheduleFilterPanel from '~/components/schedule/ScheduleFilterPanel.vue';
import ScheduleToolbar from '~/components/schedule/ScheduleToolbar.vue';
import ScheduleWeekNav from '~/components/schedule/ScheduleWeekNav.vue';
import ScheduleViolationsPanel from '~/components/schedule/ScheduleViolationsPanel.vue';
import { isPlacedSession } from '#shared/sessionPlacement';
import { isoWeekday, localNow, weekIndexOf } from '#shared/academicCalendar';
import { useScheduleData } from '~/composables/scheduleData';
import { useScheduleEditing } from '~/composables/scheduleEditing';
import { resolveTermId, useScheduleFilters } from '~/composables/scheduleFilters';
import { useHasPermission } from '~/composables/session';
import { useWheelStep } from '~/composables/wheelStep';

/**
 * Composition only. Three composables own the state, seven components own the
 * rendering; this file decides what sits next to what.
 *
 *   useScheduleFilters:  what changes the API query
 *   useScheduleData:     server state and everything derived from it
 *   useScheduleEditing:  selection, placement mode, mutations
 */
const { t } = useT();

// A getter, not a plain string: `useHead` re-evaluates it, so the tab title
// follows a language change rather than freezing at whatever was active when
// this page first mounted.
useHead(() => ({ title: t('schedule.page.pageTitle') }));

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
/** Issue #109's Today button: sets the mobile agenda's day, once resolved. */
const agenda = useTemplateRef<{ showDay: (day: number) => void }>('agenda');
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
const canSubstitute = useHasPermission('session.substitute');
/**
 * A placement carries the week on screen: the grid does not know which week it
 * shows, so the page supplies it. That is what makes a cross-week move possible.
 */
/**
 * ONE grid click, routed by the mode that made the cells targets. `create` opens
 * the form seeded with the slot rather than issuing a request: a new Session
 * needs a kind, which no click can supply.
 */
/**
 * The dates this week covers, such as "13–17 Oct". A week number is an abstraction over
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

/**
 * A STALE LIST MUST NOT BE ACTIONABLE.
 *
 * `.schedule_main--pending` sets `pointer-events: none` while the week
 * refetches, which stops a MOUSE from reaching a chip that is one render from
 * being replaced, but does nothing at all about the keyboard, so a focused chip
 * could still be Entered against a list about to be discarded. That is the
 * precise hazard the rule's own comment says it exists to prevent.
 *
 * The guard lives here rather than in the two grids because every selection
 * path (grid, agenda, off-grid tray, violations panel) already funnels
 * through this page, and none of them needs to know why.
 */
function onSelect(id: string) {
    if (data.pending.value) {
        return;
    }

    editing.select(id);
}

function placeAt(target: { dayOfWeek: number; blockIndex: number }) {
    if (editing.creating.value) {
        pendingSlot.value = target;

        return;
    }

    if (data.pending.value) {
        return;
    }

    return editing.move({ ...target, termWeek: filters.week.value });
}

const pendingSlot = ref<{ dayOfWeek: number; blockIndex: number } | null>(null);

/**
 * Issue #109's Today button. A ONE-OFF read of `localNow` at click time
 * (unlike the grid's live now-indicator, a click has no need for a ticking
 * ref), resolved in the TENANT's zone (`data.tenantTimezone`), never the
 * browser's: CLAUDE.md, timezone is per-Person and display-only, and this is
 * exactly the "same day" logic that rule says must stay tenant-local.
 *
 * FALLS BACK RATHER THAN DOING NOTHING when today is outside the current
 * Term's range: clamped to the nearest boundary week, the same clamp
 * `reconcileFilters` already applies when a URL's `?week=` outruns the term.
 */
function jumpToToday() {
    const term = data.term.value;

    if (!term) {
        return;
    }

    const today = localNow(new Date(), data.tenantTimezone.value).date;
    const weekIndex = weekIndexOf(new Date(term.startDate), today);
    // `weekIndex` is 0-based; the term week shown on screen is 1-based.
    const clampedWeek = Math.min(Math.max(weekIndex + 1, 1), data.totalWeeks.value);

    filters.week.value = clampedWeek;

    // Only meaningful when today landed inside the week just selected AND is
    // a day this grid actually teaches; otherwise the mobile agenda is left
    // on whichever day it already showed, same as the desktop grid draws no
    // now-line for a day it does not teach.
    if (clampedWeek === weekIndex + 1) {
        const dayOfWeek = isoWeekday(today);

        if (data.grid.value?.activeDays.includes(dayOfWeek)) {
            agenda.value?.showDay(dayOfWeek);
        }
    }
}

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
 * not a grid MODE: it changes nothing about what a click on the grid means.
 */
/**
 * One request per control, matching how rooms already save. Not a form with a
 * Save button: a single button over four independent fields could half-succeed
 * with one error message covering all of them.
 *
 * BARE `$fetch` IS CORRECT HERE, and it is worth saying so next to
 * `scheduleData.ts`'s long argument for the opposite. That rule is about fetches
 * that run during SSR: on the server `$fetch` sends no browser cookie, so an
 * authenticated call 401s and the page renders its empty state. These three
 * handlers only ever run from a click, on the client, where `$fetch` carries
 * cookies natively, so `useRequestFetch()` would add a setup-scope binding and
 * change nothing. What would make them wrong is moving one into a setup path.
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
        const detail = serverErrorMessage(caught);

        editing.error.value = detail ?? t('schedule.page.saveFailed');
    }
}

/**
 * A locked Session's lecturer, or an Event's: the two cases `lecturers.post.ts`
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
        const detail = serverErrorMessage(caught);

        editing.error.value = detail ?? t('schedule.page.saveFailed');
    }
}

/**
 * Cover this Session's occurrence (issue #30). No `offeringId` bail-out and no
 * lock requirement, unlike `saveLecturers`: a substitution is an overlay the
 * solver never reads, so it is safe on any Session regardless of Offering or
 * lock state; needing neither guard is `substitute.post.ts`'s whole point.
 */
async function saveSubstitute(personId: string) {
    const target = editing.selected.value;

    if (!target) {
        return;
    }

    try {
        await $fetch(`/api/sessions/${target.id}/substitute`, { method: 'POST', body: { personId } });
        await data.refreshAll();
    } catch (caught: unknown) {
        const detail = serverErrorMessage(caught);

        editing.error.value = detail ?? t('schedule.page.coverFailed');
    }
}

/** Undoes a substitution: "wrong person picked", not "session cancelled". */
async function removeSubstitute() {
    const target = editing.selected.value;

    if (!target) {
        return;
    }

    try {
        await $fetch(`/api/sessions/${target.id}/substitute`, { method: 'DELETE', body: {} });
        await data.refreshAll();
    } catch (caught: unknown) {
        const detail = serverErrorMessage(caught);

        editing.error.value = detail ?? t('schedule.page.uncoverFailed');
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
        const detail = serverErrorMessage(caught);

        // Surfaced in the same place every other editing failure is, rather
        // than as a toast that outlives the screen it refers to.
        editing.error.value = detail ?? t('schedule.page.deleteFailed');
    }
}

async function onEventCreated() {
    pendingSlot.value = null;
    editing.endCreating();
    restoreCreateFocus();
    await data.refreshAll();
}

/**
 * Whether an empty `data.kinds` means "none configured" or "not readable": the
 * reference wave degrades to `[]` on a 403 so one missing permission cannot blank
 * the page, which makes the two indistinguishable at the point of use.
 */
const canReadSessionKinds = useHasPermission('session_kind.read');

const canMove = useHasPermission('session.move');
const canSwap = useHasPermission('session.swap');
const canLock = useHasPermission('session.lock');
/** Cancel to, or place from, the spare bank (issue #22). */
const canBankSession = useHasPermission('session.bank');

const filters = useScheduleFilters();

/**
 * The schedule page's own view/session settings, held as ONE JSON cookie
 * rather than one cookie per field (term (#73), violations panel).
 *
 * A cookie rather than `localStorage`, for the reason `useFirstVisit` sets
 * out: every one of these has to be legible on the SERVER, never swapped in
 * after hydration. `termId` decides WHICH term's data the awaited SSR fetch
 * below asks for, so reading it client-only would render the wrong term's
 * whole schedule and then replace it once hydration catches up. The
 * violations panel is the same story one step smaller: a timetabler keeps it
 * open all day, and it closed on every return from the proposals list.
 *
 * Row height used to live here too (`density`), a manual Compact/Comfortable/
 * Spacious choice. It no longer does: `autoRowHeight()` derives it from the
 * TimeGrid's own block length, so there is nothing left for a reader to
 * remember between visits.
 *
 * First-party, functional, and holding exactly these two fields: no
 * identifier, no timestamp, nothing that distinguishes one reader from
 * another.
 */
interface ScheduleSettings {
    violationsOpen: boolean;
    termId: string;
}

const COOKIE_YEAR = 60 * 60 * 24 * 365;

/**
 * A COOKIE IS USER INPUT TOO: hand-edited, written by an older build that
 * only knew one or two of these fields, or otherwise not shaped like
 * `ScheduleSettings`. Every read of the cookie goes through this, never
 * `settingsCookie.value` directly, so a garbled or partial cookie degrades
 * to defaults FIELD BY FIELD: a bad `termId` cannot throw out a valid
 * `violationsOpen`, and vice versa. An older cookie may still carry a
 * `density` field; it is simply not read any more.
 */
function coerceScheduleSettings(raw: unknown): ScheduleSettings {
    const value = (raw && typeof raw === 'object' ? raw : {}) as Partial<ScheduleSettings>;

    return {
        violationsOpen: value.violationsOpen === true,
        termId: typeof value.termId === 'string' ? value.termId : '',
    };
}

const settingsCookie = useCookie<ScheduleSettings>('calendry-schedule-settings', {
    default: () => ({ violationsOpen: false, termId: '' }),
    sameSite: 'lax',
    path: '/',
    maxAge: COOKIE_YEAR,
});

const scheduleSettings = computed(() => coerceScheduleSettings(settingsCookie.value));

function patchScheduleSettings(patch: Partial<ScheduleSettings>) {
    settingsCookie.value = { ...scheduleSettings.value, ...patch };
}

/*
 * #73's cookie fallback, layered on `useScheduleFilters()`'s own URL sync
 * rather than duplicating it: that composable already owns reading AND
 * writing every filter's query param (`term`/`week`/`group`/`room`/`person`/
 * `nested`), coalescing rapid writes so two sets in one tick cannot silently
 * lose one of them; a second, page-level write-back would just fight it for
 * the query string. The ONE thing it does not do is remember a Term across a
 * fresh navigation with no `?term=` at all, which is what #73 actually asked
 * for, so this seeds ONLY that gap, through the composable's own setter,
 * before the first fetch fires. `resolveTermId(undefined, …)` reads oddly
 * with a literal `undefined`, but it is the same precedence rule #73/#74
 * agreed on: empty here always means "the URL had nothing to say".
 */
if (!filters.termId.value) {
    const remembered = resolveTermId(undefined, scheduleSettings.value.termId);

    if (remembered) {
        filters.termId.value = remembered;
    }
}

// The composable is synchronous by design; this is the single await, at setup
// top level where Nuxt keeps its instance context. SSR must resolve before the
// first render, because a page that hydrates from an empty render is indistinguishable
// from a tenant with no schedule.
const data = useScheduleData(filters);

await data.ready;

/*
 * Whichever Term ends up selected (from the URL, the cookie, or the
 * server's own default once `useScheduleData`'s watchEffect resolves one)
 * becomes the cookie's remembered Term, so the NEXT navigation OR reload
 * (#73) can fall back to it.
 */
watch(filters.termId, (termId) => {
    if (termId) {
        patchScheduleSettings({ termId });
    }
}, { immediate: true });

const editing = useScheduleEditing({
    // Both buckets (issue #22): a selection made from `ScheduleSpareBank` must
    // resolve here too, or selecting a banked Session would show nothing in
    // the Inspector the moment `select(id)` looked it up.
    sessions: data.sessionsForEditing,
    onMutated: data.refreshAll,
});

/**
 * The selection's placement, or null when nothing is selected OR it is
 * banked: the one guard standing between `slotDateOf` and a null
 * `termWeek`/`dayOfWeek` (issue #22).
 */
const selectedPlacement = computed(() => (
    editing.selected.value && isPlacedSession(editing.selected.value) ? editing.selected.value : null
));

/**
 * Derived, not chosen: one BLOCK's pixel height, scaled from the resolved
 * TimeGrid's own `blockLengthMinutes` (see `autoRowHeight`). A 3.5-hour lab
 * block draws tall, a 45-minute lecture block draws compact, both from the
 * grid the tenant already configured. Falls back to a 45-minute assumption
 * before a Term resolves, matching the old default preset.
 */
const rowHeight = computed<number>(() => autoRowHeight(data.grid.value?.blockLengthMinutes ?? 45));

const showViolations = computed<boolean>({
    get: () => scheduleSettings.value.violationsOpen,
    set: (value) => {
        patchScheduleSettings({ violationsOpen: value });
    },
});

/**
 * Whether `ScheduleFilterPanel` is open: UI-only, unlike the filter VALUES
 * it edits (those stay URL-backed via `useScheduleFilters()`). A plain ref,
 * not persisted: reopening the panel on the next visit is not a state worth
 * remembering.
 */
const filtersOpen = ref(false);

/** How many of Group/Room/Person are narrowing the view: the toolbar's badge. */
const activeFilterCount = computed(() => [
    filters.groupId.value, filters.roomId.value, filters.personId.value,
].filter(Boolean).length);

/*
 * `plural(count, noun)` used to live here, with a comment naming i18n as its
 * eventual owner. i18n has landed, so it is gone: the two sentences it served
 * are whole plural messages now (`schedule.page.hardViolationCount` /
 * `softViolationCount`), which is the only form that survives a language with
 * no `-s` plural.
 */

/**
 * What an edit COST, named at the moment it lands.
 *
 * Warn-and-allow means a hard violation survives the edit that caused it
 * (TAXONOMY.md §3), so the reader has to be told. The alternative, which is
 * what shipped until now, is a schedule that quietly acquires clashes while the
 * only signal is a colour shift on one chip and a count in the far corner.
 *
 * SILENT WHEN THE CALLER CANNOT READ VIOLATIONS. "Nothing flagged" would be a
 * claim about state this screen is not allowed to see, and the reference wave
 * degrades a 403 to `[]`, so an empty list means "none" and "not permitted"
 * indistinguishably. Saying nothing is the honest branch.
 */
function violationClause(sessionId: string): string {
    if (!data.canReadViolations.value) {
        return '';
    }

    const rows = data.violationsBySessionId.value.get(sessionId) ?? [];

    if (!rows.length) {
        // "violations", matching the toolbar, the inspector, the panel and the
        // solver summary. "Nothing flagged" was a fifth word for one quantity,
        // mine, from the pass that added this sentence.
        return t('schedule.page.noViolations');
    }

    const hard = rows.filter((row) => row.severity === 'HARD').length;
    const soft = rows.length - hard;

    const parts = [
        ...(hard ? [t('schedule.page.hardViolationCount', { count: hard }, hard)] : []),
        ...(soft ? [t('schedule.page.softViolationCount', { count: soft }, soft)] : []),
    ];

    return t('schedule.page.violationsRecorded', { clauses: joinAnd(parts, t) });
}

function describeAction(action: ScheduleAction): string {
    switch (action.kind) {
        case 'move': {
            const grid = data.grid.value;
            // The clock time, not the block number: a timetabler checks a
            // placement against a wall clock. `blockTime` is passed the day so a
            // per-day break override moves the boundary it actually moves.
            const at = grid
                ? blockTime(grid, action.blockIndex, action.dayOfWeek).start
                : t('schedule.page.blockFallback', { block: action.blockIndex + 1 });

            return t('schedule.page.movedTo', {
                label: action.label,
                day: weekdayName(action.dayOfWeek, locale.value),
                time: at,
            });
        }
        case 'swap':
            return t('schedule.page.swapped', {
                label: action.label,
                partner: action.partnerLabel,
            });
        case 'lock':
            return action.locked
                ? t('schedule.page.locked', { label: action.label })
                : t('schedule.page.unlocked', { label: action.label });
        case 'rooms':
            return action.roomCount === 0
                ? t('schedule.page.roomsCleared', { label: action.label })
                : t('schedule.page.roomsUpdated', { label: action.label });
    }
}

const announcement = computed(() => {
    const action = editing.lastAction.value;

    if (!action) {
        return '';
    }

    /*
     * JOINED WITH A SPACE rather than concatenated, because the clause no
     * longer carries a leading one: a message that begins with a space is
     * unusable to a translator (and invisible in a diff), so the separator
     * lives at the join and `filter(Boolean)` keeps it out when the clause is
     * absent, which is what the caller-cannot-read-violations branch returns.
     */
    return [describeAction(action), violationClause(action.sessionId)].filter(Boolean).join(' ');
});

/**
 * A filter named in the URL that this caller cannot see: see `reconcileFilters`.
 * Reported rather than silently corrected: a link that said "week 7, Class A"
 * and renders the whole institution has lied to whoever opened it.
 */
const filterNotice = ref('');

/** One channel, because one line is all either message needs. */
const feedback = computed(() => announcement.value || filterNotice.value);

/**
 * FOCUS FOLLOWS THE EDIT, for the two actions whose control disappears under it.
 *
 * A grid cell carries `:disabled="!placing"`, so the cell just activated is
 * disabled the instant the move resolves and focus falls to `<body>`, verified
 * over CDP for the create flow, which is why `restoreCreateFocus` exists. The
 * move path is the same failure on the interaction taken hundreds of times a
 * session rather than once.
 *
 * Lock and rooms are deliberately EXCLUDED: their controls live in the inspector
 * and survive the mutation, so moving focus to the chip would steal it from the
 * button the reader just pressed.
 *
 * Found by attribute rather than threaded through two components, for the reason
 * `restoreCreateFocus` gives: what matters is that a control still exists to
 * receive focus. When the edit sent the session out of this view entirely
 * (another week, or outside the active filter), no chip exists, and focus goes to
 * the inspector, which still describes it.
 */
function restoreEditFocus(sessionId: string) {
    nextTick(() => {
        /*
         * ALL matches, then the one actually rendered. The week grid and the day
         * agenda are BOTH mounted at every width: each is hidden by
         * `display: none` at the other's breakpoint rather than unmounted, which
         * is what lets a breakpoint change keep the selection, so this session
         * has two chips and `querySelector` returns whichever comes first in the
         * document. `focus()` on a `display: none` element is a silent no-op, so
         * taking the first match would have left focus on `<body>` on exactly one
         * of the two layouts. `offsetParent` is null for a hidden element and is
         * the cheapest question that distinguishes them.
         */
        const chips = [...document.querySelectorAll<HTMLElement>(`[data-session-id="${sessionId}"]`)];
        const visible = chips.find((chip) => chip.offsetParent !== null);

        (visible ?? document.querySelector<HTMLElement>('[data-inspector-root]'))?.focus();
    });
}

/**
 * The acknowledgement clears itself. Long enough to read two clauses without
 * hurrying, short enough that it is gone before it can be mistaken for the
 * outcome of the next edit.
 */
const FEEDBACK_MS = 9000;

let feedbackTimer: ReturnType<typeof setTimeout> | null = null;

function holdFeedback(clear: () => void) {
    if (feedbackTimer) {
        clearTimeout(feedbackTimer);
    }

    feedbackTimer = setTimeout(clear, FEEDBACK_MS);
}

watch(() => editing.lastAction.value, (action) => {
    if (!action) {
        return;
    }

    holdFeedback(() => {
        editing.lastAction.value = null;
    });

    if (action.kind === 'move' || action.kind === 'swap') {
        restoreEditFocus(action.sessionId);
    }
});

watch(filterNotice, (notice) => {
    if (notice) {
        holdFeedback(() => {
            filterNotice.value = '';
        });
    }
});

// A timer outliving its page would fire against a disposed ref.
onBeforeUnmount(() => {
    if (feedbackTimer) {
        clearTimeout(feedbackTimer);
    }
});

/**
 * THE URL IS UNTRUSTED INPUT, and every one of these failures renders as an
 * empty grid indistinguishable from a term with nothing in it.
 *
 * `?week=999` outruns the term. `?group=<id>` may name a cohort this caller
 * cannot see, or one that has since been deleted, and then the toolbar's
 * `<select>` finds no matching option and sits blank while the filter is
 * demonstrably active, so the screen misrepresents its own state.
 *
 * THE EMPTY-LIST GUARD IS THE WHOLE SUBTLETY. The directory fetches degrade a
 * 403 to `[]` on purpose (`scheduleData.optional`), so "not in the list" means
 * either "no such group" or "you may not enumerate groups", and clearing a
 * perfectly valid filter because the reader lacks `group.read` would break the
 * one case the filter exists for. Reconciliation therefore only runs against a
 * list that actually arrived.
 */
function reconcileFilters() {
    if (data.pending.value || data.loadError.value) {
        return;
    }

    const total = data.totalWeeks.value;

    if (filters.week.value > total) {
        filters.week.value = total;
    }

    // Cleared rather than corrected: `useScheduleData`'s watchEffect seeds the
    // term the SERVER resolved as soon as this is empty, which is the one value
    // that cannot disagree with the chips on screen.
    if (filters.termId.value
        && data.terms.value.length
        && !data.terms.value.some((term) => term.id === filters.termId.value)) {
        filters.termId.value = '';
        filterNotice.value = t('schedule.page.termGone');

        return;
    }

    const dropped: string[] = [];

    if (filters.groupId.value && data.groups.value.length
        && !data.groups.value.some((group) => group.id === filters.groupId.value)) {
        filters.groupId.value = '';
        dropped.push(t('schedule.page.filterGroup'));
    }

    if (filters.roomId.value && data.rooms.value.length
        && !data.rooms.value.some((room) => room.id === filters.roomId.value)) {
        filters.roomId.value = '';
        dropped.push(t('schedule.page.filterRoom'));
    }

    if (filters.personId.value && data.people.value.length
        && !data.people.value.some((person) => person.id === filters.personId.value)) {
        filters.personId.value = '';
        dropped.push(t('schedule.page.filterPerson'));
    }

    if (dropped.length) {
        filterNotice.value = t('schedule.page.filtersDropped', { filters: joinAnd(dropped, t) });
    }
}

watch(
    [() => data.pending.value, () => data.totalWeeks.value, filters.query],
    reconcileFilters,
    { immediate: true },
);
</script>

<style scoped lang="scss">
.schedule {
    /*
     * THREE INTERVALS, NOT ONE. Every region was separated by the same 14px, so
     * the screen had two levels of hierarchy: the grid, and everything else.
     * `--space-7` between REGIONS, `--space-5` between members of a region,
     * `--space-3/4` inside a group: all steps on the documented scale, which
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
            line-height: var(--leading-prose);
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

    /*
     * THE OUTCOME LINE, in the placing strip's shape and slot: one line says
     * what to do next, the other says what was done, so they read as one
     * conversation rather than two systems. `$success` rather than the accent:
     * the accent is spent on "where a session may land" (DESIGN.md) and an
     * acknowledgement is not an offer.
     */
    &_done {
        display: flex;
        gap: var(--space-4);
        align-items: center;

        margin: 0;
        padding: var(--space-5) var(--space-6);
        border-radius: var(--radius-lg);

        font-size: var(--font-size-md);
        color: $content4;

        background: varToRgba('success600', 0.14);

        svg {
            flex: none;
            width: var(--space-6);
            height: var(--space-6);
            color: $success700;
        }
    }

    &_error {
        display: flex;
        gap: var(--space-4);
        align-items: flex-start;

        margin: 0;
        padding: var(--space-4) var(--space-6);
        border-radius: var(--radius-lg);

        font-size: var(--font-size-md);
        color: $error700;

        background: rgb(169, 45, 70, 0.16);

        span { flex: 1; }

        &-dismiss {
            cursor: pointer;

            display: flex;
            flex: none;
            align-items: center;
            justify-content: center;

            /* 28px of hit area for a 16px glyph: the smallest control on the
               page still has to be hittable. */
            width: var(--space-7);
            height: var(--space-7);
            margin: calc(var(--space-2) * -1) calc(var(--space-3) * -1) 0 0;
            border: 0;
            border-radius: var(--radius-sm);

            color: $error700;

            background: none;

            transition: background-color 140ms cubic-bezier(0.16, 1, 0.3, 1);

            &:hover { background: rgb(169, 45, 70, 0.16); }

            &:focus-visible {
                outline: 2px solid $error700;
                outline-offset: 1px;
            }

            svg {
                width: var(--space-6);
                height: var(--space-6);
            }
        }
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
         * STALE, NOT GONE: the frame stays mounted while the week refetches, so
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
     * calibrated on that number, so a third of the width was held for a panel
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

    /*
     * MATCHES `ScheduleWeekNav`'s OWN `.weeknav_step` BY EYE, DELIBERATELY
     * DUPLICATED rather than shared: this button is slotted content, so Vue's
     * scoped CSS attaches it to THIS component, not `ScheduleWeekNav`'s scope
     * `.weeknav_step` is defined under. Keep the two in sync by hand if either
     * changes; there is no third caller yet to justify extracting a shared
     * class.
     */
    &_today {
        cursor: pointer;

        display: flex;
        flex: none;
        align-items: center;
        justify-content: center;

        min-width: 44px;
        min-height: 44px;
        border: 0;
        border-radius: var(--radius-lg);

        color: $content6;

        background: none;

        transition: background 140ms cubic-bezier(0.16, 1, 0.3, 1),
            color 140ms cubic-bezier(0.16, 1, 0.3, 1);

        svg {
            width: 18px;
            height: 18px;
        }

        @include hover() {
            &:hover {
                color: $content1;
                background: varToRgba('primary500', 0.12);
            }
        }

        &:focus-visible {
            outline: 2px solid $primary600;
            outline-offset: 1px;
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
