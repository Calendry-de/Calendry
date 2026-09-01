/**
 * A number that eases toward its target instead of jumping to it.
 *
 * WHY A TWEEN AND NOT A CSS TRANSITION: there is no CSS property here. The thing
 * animating is the rendered TEXT of a euro total, and the only way to animate
 * text content is to change it on a schedule.
 *
 * WHAT IT IS FOR, and it is not decoration. On the pricing calculator the total
 * is the one number a visitor is watching, and a slider changes it several times
 * a second. Snapping between values makes it impossible to tell whether a drag
 * made the price go up or down, or by roughly how much; easing over ~450ms turns
 * the same input into a legible direction and magnitude. That is the animation
 * carrying information rather than ornamenting it.
 *
 * IT DRIVES A REF, WHICH IS THE POINT. Vue's reactivity is not React's: writing
 * a ref inside `requestAnimationFrame` patches the one text node that depends on
 * it, rather than re-rendering a tree. The frames stop the moment the value
 * arrives, so an idle calculator schedules nothing at all.
 *
 * REDUCED MOTION IS NOT A DEGRADED PATH, it is an early return: the ref is set
 * to the target and no frame is ever requested.
 */
export function useTweenedNumber(source: () => number, durationMs = 450) {
    const displayed = ref(source());

    // Only the client animates. On the server there is one render and no
    // scheduler, so the first paint must already carry the real figure.
    if (import.meta.server) {
        watch(source, next => {
            displayed.value = next;
        });
        return displayed;
    }

    let frame = 0;
    let from = displayed.value;
    let to = displayed.value;
    let startedAt = 0;

    // Standard ease-out: fast enough to feel responsive to a drag, settled
    // before the next value is likely to arrive.
    const ease = (t: number): number => 1 - ((1 - t) ** 3);

    const stop = () => {
        if (frame !== 0) {
            cancelAnimationFrame(frame);
            frame = 0;
        }
    };

    const step = (now: number) => {
        const elapsed = now - startedAt;
        const t = Math.min(1, elapsed / durationMs);
        displayed.value = from + ((to - from) * ease(t));

        if (t < 1) {
            frame = requestAnimationFrame(step);
            return;
        }

        // Land exactly on the target. Easing asymptotically toward it would
        // leave a rounding error visible in the last digit of a price.
        displayed.value = to;
        frame = 0;
    };

    watch(source, (next) => {
        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        if (reduced || durationMs <= 0) {
            stop();
            displayed.value = next;
            return;
        }

        // Retarget from wherever the previous tween had reached, so a fast drag
        // reads as one continuous movement rather than a series of restarts.
        stop();
        from = displayed.value;
        to = next;
        startedAt = performance.now();
        frame = requestAnimationFrame(step);
    });

    // Without this a component unmounted mid-tween keeps a frame scheduled
    // against a ref nothing reads any more.
    onScopeDispose(stop);

    return displayed;
}
