/**
 * One wheel gesture, one step: for the controls that opt into it.
 *
 * SCOPED BY WHERE IT IS BOUND, never globally. It lives on the week grid, the
 * day agenda and the week stepper, so a wheel anywhere else on the page is an
 * ordinary scroll. Binding it to the whole page body would make reading a long
 * schedule impossible without changing the week by accident.
 *
 * TWO THINGS MAKE IT A SHORTCUT RATHER THAN A TRAP:
 *
 * - it only calls `preventDefault()` when the step is actually CONSUMED, so at
 *   the first or last week the gesture is handed back and the page scrolls as it
 *   always did;
 * - a cooldown, because a trackpad emits a burst of small deltas for one
 *   physical flick and without it a single gesture would skip five weeks. A
 *   mouse wheel's one large delta passes the same gate on its first event.
 *
 * Shared rather than written twice: the toolbar and the page both need it, and
 * two copies of a debounce are two different debounces within a release.
 */
const COOLDOWN_MS = 220;
const THRESHOLD = 8;

export interface WheelStepTarget {
    /** Whether a step in this direction is possible at all. */
    canStep: (direction: 1 | -1) => boolean;
    /** Take the step. Only called once per gesture. */
    step: (direction: 1 | -1) => void;
}

export function useWheelStep(target: WheelStepTarget) {
    const lastAt = ref(0);

    return function onWheel(event: WheelEvent) {
        // A horizontal gesture belongs to whatever scrolls sideways.
        if (Math.abs(event.deltaY) < Math.abs(event.deltaX) || Math.abs(event.deltaY) < THRESHOLD) {
            return;
        }

        const direction = event.deltaY > 0 ? 1 : -1;

        /*
         * Asked BEFORE the cooldown, and kept separate from taking the step for
         * that reason: whether the gesture is OURS must not depend on how
         * recently the last one happened. Folded together, a fast second flick
         * at the last week would be swallowed instead of scrolling the page.
         */
        if (!target.canStep(direction)) {
            return;
        }

        event.preventDefault();

        const now = Date.now();

        if (now - lastAt.value < COOLDOWN_MS) {
            return;
        }

        lastAt.value = now;
        target.step(direction);
    };
}
