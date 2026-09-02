import type { ComputedRef } from 'vue';
import type { ScheduleSession } from '~/composables/schedule';
import { sessionLabel } from '~/composables/schedule';
import { useT } from '~/composables/i18n';
import { useOverlayActive } from '~/composables/overlay';

/**
 * The editing interaction: what is selected, whether we are placing it, and the two
 * mutations the API exposes.
 *
 * ONE STATE MACHINE, not a bag of flags: selection and placement mode constrain
 * each other and Escape unwinds them in order. Enforcement stays server-side;
 * nothing here is a permission check.
 */
/**
 * What a click on the grid means right now.
 *
 * `idle`: selects a session
 * `place`: a slot is a destination for the selected session
 * `swap`: a session is the partner to exchange placements with
 */
export type EditMode = 'idle' | 'place' | 'swap' | 'create';

/**
 * WHAT JUST HAPPENED: the one thing a successful mutation used to leave unsaid.
 *
 * Every path below ended in `await options.onMutated()` and nothing else, so a
 * move, a swap, a lock and a room change were all indistinguishable from having
 * clicked nothing at all. The move path is worse than the others: the grid cell
 * that was activated carries `:disabled="!placing"`, so it is disabled the
 * instant the mode drops and focus falls to `<body>`.
 *
 * STRUCTURED, NOT A FINISHED SENTENCE, because the wording is not this
 * composable's to own: the weekday name and the block's clock time come from the
 * grid, the viewer's locale decides how either is spelled, and the violations a
 * move CREATED are only knowable once `onMutated()` has refreshed them. This
 * composable knows the act; the page knows how to say it.
 */
export type ScheduleAction =
    | { kind: 'move'; sessionId: string; label: string; dayOfWeek: number; blockIndex: number }
    | { kind: 'swap'; sessionId: string; label: string; partnerLabel: string }
    | { kind: 'lock'; sessionId: string; label: string; locked: boolean }
    | { kind: 'rooms'; sessionId: string; label: string; roomCount: number };

export function useScheduleEditing(options: {
    sessions: ComputedRef<ScheduleSession[]>;
    onMutated: () => Promise<void>;
}) {
    const { t } = useT();

    const selectedId = ref<string | null>(null);
    /**
     * What a click on the GRID currently means, which is the whole test for what
     * belongs here. Editing the room changes nothing about the grid, so it is an
     * inspector control rather than a fourth value.
     *
     * One enum rather than two booleans: `placing` + `swapping` would describe four
     * states, three meaningless, needing a guard to keep them apart.
     */
    const mode = ref<EditMode>('idle');
    const busy = ref(false);
    const error = ref('');

    /**
     * The last edit that SUCCEEDED, or null. Cleared by any fresh intent (a new
     * selection, a new mode, the start of the next mutation), because an outcome
     * that outlives the interaction it belongs to is the failure mode
     * `schedule_error` already had.
     */
    const lastAction = ref<ScheduleAction | null>(null);

    /** Kept so existing callers (`ScheduleGrid`, the page) read unchanged. */
    const placing = computed(() => mode.value === 'place');
    const swapping = computed(() => mode.value === 'swap');

    /**
     * `create` earns a mode by the same test the comment above states: it
     * changes what a click on the GRID means. A slot becomes the placement for
     * a Session that does not exist yet.
     *
     * Unlike `place` and `swap` it needs NO selection: there is nothing
     * selected yet, which is why it does not go through `setMode`, whose
     * whole job is guarding that a mode without a subject cannot be entered.
     */
    const creating = computed(() => mode.value === 'create');

    /**
     * Kept even if it leaves the view. `sessions` holds only the week on screen, so
     * deriving `selected` from it alone drops the selection on navigation, fatal
     * for a cross-week move, where the interaction is "select here, navigate there,
     * place". The mode survived that transition; the subject did not.
     *
     * The snapshot is the fallback, never the primary: while the session IS in view
     * the live row wins, so edits and violations stay current.
     */
    const snapshot = ref<ScheduleSession | null>(null);

    const selected = computed(() => (
        options.sessions.value.find((s) => s.id === selectedId.value)
        ?? (snapshot.value?.id === selectedId.value ? snapshot.value : null)
    ));

    /**
     * Clicking a session.
     *
     * In `swap` this IS the action: the second session is the partner, which
     * is the one place the two grid modes genuinely differ. In `place`, picking
     * a different session cancels the mode rather than silently retargeting a
     * placement the user set up for something else.
     */
    function select(id: string) {
        lastAction.value = null;

        if (mode.value === 'swap' && selectedId.value && id !== selectedId.value) {
            void swapWith(id);

            return;
        }

        selectedId.value = id;
        snapshot.value = options.sessions.value.find((s) => s.id === id) ?? null;
        mode.value = 'idle';
    }

    function clearSelection() {
        selectedId.value = null;
        snapshot.value = null;
        mode.value = 'idle';
        lastAction.value = null;
    }

    /** Entering either grid mode leaves the other; they cannot both be on. */
    function setMode(next: EditMode) {
        mode.value = selectedId.value && mode.value !== next ? next : 'idle';
        lastAction.value = null;
    }

    function togglePlacing() {
        setMode('place');
    }

    function toggleSwapping() {
        setMode('swap');
    }

    /**
     * Entering create CLEARS the selection. Leaving a session selected while
     * the grid means "put a new event here" would leave the inspector offering
     * Move and Swap against a subject the next click is not going to act on:
     * two live interpretations of one click, which is exactly what the single
     * `mode` enum exists to prevent.
     */
    function toggleCreating() {
        if (mode.value === 'create') {
            mode.value = 'idle';

            return;
        }

        selectedId.value = null;
        mode.value = 'create';
    }

    /** Leaves create mode without touching a selection made since. */
    function endCreating() {
        if (mode.value === 'create') {
            mode.value = 'idle';
        }
    }

    async function move(target: { dayOfWeek: number; blockIndex: number; termWeek?: number }) {
        if (!selected.value || busy.value) {
            return;
        }

        /*
         * Captured BEFORE the request. `selected` is derived from the sessions
         * list, which `onMutated()` replaces, so reading the label afterwards
         * races the refresh, and reading it after a cross-week move reads the
         * snapshot fallback instead of the row that actually moved.
         */
        const subject = selected.value;

        busy.value = true;
        error.value = '';
        lastAction.value = null;

        try {
            await $fetch(`/api/sessions/${selected.value.id}/move`, {
                method: 'POST',
                /**
                 * `termWeek` travels with every placement. The grid shows one
                 * week at a time, so the displayed week IS the destination;
                 * omitting it (as this did until now) left the server keeping
                 * the session's existing week, which made cross-week moves
                 * impossible through the UI even though /move has always
                 * accepted the field.
                 */
                body: {
                    dayOfWeek: target.dayOfWeek,
                    blockIndex: target.blockIndex,
                    ...(target.termWeek === undefined ? {} : { termWeek: target.termWeek }),
                },
            });

            mode.value = 'idle';
            // Violations are recomputed server-side in the same transaction as
            // the move, so refreshing both reflects one consistent state.
            await options.onMutated();

            /*
             * AFTER the refresh, not before. The page's sentence names the
             * violations this move created, and those only exist in the store
             * once `onMutated()` has resolved. Announcing earlier would make
             * the live region state one thing and then correct itself, which is
             * two announcements for one act.
             */
            lastAction.value = {
                kind: 'move',
                sessionId: subject.id,
                label: sessionLabel(subject),
                dayOfWeek: target.dayOfWeek,
                blockIndex: target.blockIndex,
            };
        } catch (e) {
            error.value = serverErrorMessage(e) ?? t('schedule.editing.moveFailed');
        } finally {
            busy.value = false;
        }
    }

    /**
     * Exchange the selected Session's placement with another's.
     *
     * Distinct from `move` on purpose: a swap is one atomic server operation
     * that repositions BOTH sessions, and the event log records it as a swap
     * rather than as two unrelated moves.
     */
    async function swapWith(otherId: string) {
        if (!selected.value || busy.value || otherId === selected.value.id) {
            return;
        }

        const subject = selected.value;
        // The partner is named in the announcement, and after the swap both rows
        // have new placements, so it is read from the list that still describes
        // where they were.
        const partner = options.sessions.value.find((s) => s.id === otherId) ?? null;

        busy.value = true;
        error.value = '';
        lastAction.value = null;

        try {
            await $fetch(`/api/sessions/${selected.value.id}/swap`, {
                method: 'POST',
                body: { withSessionId: otherId },
            });

            mode.value = 'idle';
            await options.onMutated();

            lastAction.value = {
                kind: 'swap',
                sessionId: subject.id,
                label: sessionLabel(subject),
                partnerLabel: sessionLabel(partner),
            };
        } catch (e) {
            error.value = serverErrorMessage(e) ?? t('schedule.editing.swapFailed');
        } finally {
            busy.value = false;
        }
    }

    /**
     * Replace the Session's Rooms.
     *
     * `/move` sets `roomIds` WHOLESALE, so this must always send the complete
     * desired set: sending one id would delete every other room the session
     * has. That is why the inspector edits the whole collection rather than
     * offering an "add room" action.
     */
    async function setRooms(roomIds: string[]) {
        if (!selected.value || busy.value) {
            return;
        }

        const subject = selected.value;

        busy.value = true;
        error.value = '';
        lastAction.value = null;

        try {
            await $fetch(`/api/sessions/${selected.value.id}/move`, {
                method: 'POST',
                body: { roomIds },
            });
            await options.onMutated();

            lastAction.value = {
                kind: 'rooms',
                sessionId: subject.id,
                label: sessionLabel(subject),
                roomCount: roomIds.length,
            };
        } catch (e) {
            error.value = serverErrorMessage(e) ?? t('schedule.editing.roomsFailed');
        } finally {
            busy.value = false;
        }
    }

    /**
     * Cancel the selected Session to the spare bank (issue #22).
     *
     * Deliberately separate from `move` rather than a special target: banking
     * removes the placement rather than changing it, and the server route it
     * calls is its own verb (`/bank`) with its own event type, matching how
     * `swapWith` is its own function rather than two `move` calls.
     */
    async function bankSelected() {
        if (!selected.value || busy.value) {
            return;
        }

        busy.value = true;
        error.value = '';

        try {
            await $fetch(`/api/sessions/${selected.value.id}/bank`, { method: 'POST', body: {} });

            mode.value = 'idle';
            await options.onMutated();
        } catch (e) {
            error.value = serverErrorMessage(e) ?? t('schedule.editing.bankFailed');
        } finally {
            busy.value = false;
        }
    }

    async function toggleLock() {
        if (!selected.value || busy.value) {
            return;
        }

        const subject = selected.value;
        // The state being MOVED TO, resolved before the request so the sentence
        // cannot disagree with what was asked for.
        const locked = !subject.isLocked;

        busy.value = true;
        error.value = '';
        lastAction.value = null;

        try {
            await $fetch(`/api/sessions/${selected.value.id}/${selected.value.isLocked ? 'unlock' : 'lock'}`, {
                method: 'POST',
                body: {},
            });
            await options.onMutated();

            lastAction.value = {
                kind: 'lock',
                sessionId: subject.id,
                label: sessionLabel(subject),
                locked,
            };
        } catch (e) {
            error.value = serverErrorMessage(e) ?? t('schedule.editing.lockFailed');
        } finally {
            busy.value = false;
        }
    }

    const overlayActive = useOverlayActive();

    // Escape leaves placement mode before it clears the selection, so one key
    // unwinds the interaction one step at a time.
    //
    // While an overlay owns the keyboard (the command palette, a dialog),
    // Escape belongs to it and this handler stands down, otherwise closing the
    // palette would also cancel a placement the user is still in the middle of.
    function onKey(event: KeyboardEvent) {
        if (event.key !== 'Escape' || overlayActive.value) return;

        // Either grid mode first, then the selection: one key, one step.
        // Neither mode is an overlay (nothing traps focus), so neither
        // claims the keyboard; a claim here would suppress the very Escape
        // that leaves the mode.
        if (mode.value !== 'idle') mode.value = 'idle';
        else clearSelection();
    }

    onMounted(() => window.addEventListener('keydown', onKey));
    onBeforeUnmount(() => window.removeEventListener('keydown', onKey));

    return {
        selectedId, selected, mode, placing, swapping, creating, busy, error, lastAction,
        toggleCreating, endCreating,
        select, clearSelection, setMode, togglePlacing, toggleSwapping,
        move, swapWith, setRooms, toggleLock, bankSelected,
    };
}
