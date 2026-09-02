import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { Ref } from 'vue';
import { localNow } from '#shared/academicCalendar';
import type { TenantLocalNow } from '#shared/academicCalendar';

/**
 * "Now", resolved in the TENANT's timezone and kept live.
 *
 * The grid's live now-indicator (issue #109) needs a ticking "now"; the Today
 * button needs a one-off read at click time and calls `localNow` directly
 * instead of mounting this. Either way it is the SAME function
 * `computeReferenceSlot` uses server-side (`shared/academicCalendar.ts`), so
 * the client's idea of "today"/"now" cannot disagree with the solver's or
 * drift into the viewer's own browser timezone. CLAUDE.md: timezone is
 * per-Person and DISPLAY-ONLY, and grid resolution is always tenant-local.
 *
 * Re-evaluated on an interval rather than once, so a mounted indicator moves
 * without a reload. A minute is granular enough: the line's own thickness
 * already covers a couple of minutes at any reasonable row density, so
 * anything finer would be precision the drawing cannot show.
 */
export function useTenantNow(timeZone: Ref<string>, intervalMs = 60_000): Ref<TenantLocalNow> {
    // Computed at creation time too: this runs during SSR, where `onMounted`
    // never fires, so the first render already shows a real instant rather
    // than a placeholder that jumps once hydration's interval starts ticking.
    const now = ref<TenantLocalNow>(localNow(new Date(), timeZone.value)) as Ref<TenantLocalNow>;

    function refresh() {
        now.value = localNow(new Date(), timeZone.value);
    }

    let timer: ReturnType<typeof setInterval> | undefined;

    onMounted(() => {
        refresh();
        timer = setInterval(refresh, intervalMs);
    });

    // A timer outliving its component would tick against a disposed ref.
    onBeforeUnmount(() => {
        if (timer) {
            clearInterval(timer);
        }
    });

    // The tenant's zone cannot change mid-session today, but re-resolving on
    // change costs nothing and is one fewer thing to get wrong if it ever can.
    watch(timeZone, refresh);

    return now;
}
