import type { ComputedRef, Ref } from 'vue';
import type { ScheduleSession, Term, TimeGrid, Violation } from '~/composables/schedule';
import { isOnGrid, sessionLabel } from '~/composables/schedule';
import { slotDate, weekCountOf } from '#shared/academicCalendar';
import { describeScheduleFailure } from '~/composables/httpError';
import { DISPLAY_DEFAULTS } from '#shared/sessionColor';
import type { DisplaySettings } from '#shared/sessionColor';
import { useHasPermission } from '~/composables/session';

/**
 * Everything the schedule view reads from the server, plus what is derived from
 * it. Server state only — no selection, placement mode or view preferences.
 */
export function useScheduleData(filters: {
    termId: Ref<string>;
    query: ComputedRef<Record<string, unknown>>;
}) {
    /*
     * Resolved at setup time, not inside the fetch handler: `useRequestFetch()`
     * needs the Nuxt request context to forward the cookie during SSR, and
     * without it every authenticated call 401s and the page renders its empty
     * state — indistinguishable from a tenant with no data.
     *
     * For the same reason this composable stays SYNCHRONOUS; the single await
     * belongs to the page.
     */
    const request = useRequestFetch();

    const canReadViolations = useHasPermission('violation.read');

    /*
     * One wave: the sessions query keys off termId, which is only known after
     * the reference data lands, so splitting it risks a fetch with an empty term.
     */
    const asyncData = useAsyncData('schedule', async () => {
        const [terms, timeGrids, groupRows, roomRows, personRows, kindRows] = await Promise.all([
            request<Term[]>('/api/terms'),
            request<TimeGrid[]>('/api/time-grids'),
            request<{ id: string; name: string; parentGroupId: string | null }[]>('/api/groups'),
            request<{ id: string; name: string; code: string; isVirtual: boolean }[]>('/api/rooms'),
            request<{ id: string; givenName: string; familyName: string }[]>('/api/persons'),
            /*
             * INDIVIDUALLY TOLERANT: `session_kind.read` is a different
             * permission from the `session.read` this page is gated on, and
             * inside a bare `Promise.all` that 403 blanked the whole page. A
             * caller who cannot read kinds cannot be offered a kind picker
             * either, so an empty list is the honest fallback.
             */
            request<{ id: string; name: string }[]>('/api/session-kinds').catch(() => []),
        ]);

        const resolvedTermId = filters.termId.value || terms[0]?.id || '';

        const [sessions, violations] = await Promise.all([
            resolvedTermId
                ? request<ScheduleSession[]>('/api/sessions', {
                    query: { ...filters.query.value, termId: resolvedTermId },
                })
                : Promise.resolve([] as ScheduleSession[]),
            resolvedTermId && canReadViolations.value
                ? request<Violation[]>('/api/violations', { query: { termId: resolvedTermId } })
                : Promise.resolve([] as Violation[]),
        ]);

        return {
            terms,
            timeGrids,
            groups: groupRows,
            rooms: roomRows.map((r) => ({ id: r.id, name: `${r.code} · ${r.name}` })),
            /*
             * Online delivery is a virtual ROOM, never a flag on Session
             * (TAXONOMY.md), so a Set here turns "is this online" from a lookup
             * per chip per render into one.
             */
            virtualRoomIds: roomRows.filter((r) => r.isVirtual).map((r) => r.id),
            people: personRows.map((p) => ({ id: p.id, name: `${p.givenName} ${p.familyName}` })),
            kinds: kindRows,
            sessions,
            violations,
            resolvedTermId,
        };
    }, { watch: [filters.query] });

    const reference = asyncData.data;

    // Reflect the term the fetch actually used, so the toolbar shows it.
    watchEffect(() => {
        const resolved = reference.value?.resolvedTermId;

        if (resolved && !filters.termId.value) {
            filters.termId.value = resolved;
        }
    });

    /**
     * Correct at FIRST RENDER, unlike `filters.termId`, which a watchEffect
     * seeds and Vue never flushes during SSR. Anything that must be right
     * server-side reads this.
     */
    const resolvedTermId = computed(() => (
        filters.termId.value || reference.value?.resolvedTermId || ''
    ));

    const terms = computed(() => reference.value?.terms ?? []);
    const groups = computed(() => reference.value?.groups ?? []);
    const rooms = computed(() => reference.value?.rooms ?? []);
    const people = computed(() => reference.value?.people ?? []);
    const kinds = computed(() => reference.value?.kinds ?? []);
    const virtualRoomIds = computed(() => new Set(reference.value?.virtualRoomIds ?? []));

    /**
     * A separate, tolerant fetch: its absence is harmless, so a tenant that has
     * never opened the Display page — or a failed request — still draws with
     * `DISPLAY_DEFAULTS` rather than not drawing.
     */
    const display = useAsyncData(
        'schedule-display-settings',
        () => request<DisplaySettings>('/api/display-settings').catch(() => DISPLAY_DEFAULTS),
        { default: () => DISPLAY_DEFAULTS },
    );

    const displaySettings = computed<DisplaySettings>(() => display.data.value ?? DISPLAY_DEFAULTS);

    /**
     * Through `resolvedTermId`, not `filters.termId`: on the server the latter
     * is still `''`, which made `totalWeeks` fall back to 1 and rendered the
     * week buttons `disabled`. Vue does not rectify attribute mismatches on
     * hydration, so they stayed dead for the life of the page.
     */
    const term = computed(() => terms.value.find((t) => t.id === resolvedTermId.value) ?? null);
    /**
     * `weekCountOf` — the same definition the week classifier, the solver
     * calendar and `POST /api/sessions` use. A local `ceil((end - start) / 7)`
     * disagrees by one on about half of all terms, which capped the schedule a
     * week short of what the server accepts.
     */
    const totalWeeks = computed(() => (term.value
        ? weekCountOf(new Date(term.value.startDate), new Date(term.value.endDate))
        : 1));

    /**
     * Grid shape follows the selected Term's TimeGrid, falling back to the
     * tenant default. Never a constant (TAXONOMY.md §2).
     */
    const grid = computed<TimeGrid | null>(() => {
        const grids = reference.value?.timeGrids ?? [];

        return grids.find((g) => g.id === term.value?.timeGridId)
            ?? grids.find((g) => g.isDefault)
            ?? grids[0]
            ?? null;
    });

    const pending = computed(() => asyncData.pending.value);

    /**
     * Why the schedule could not be read, or null. Without it a network failure
     * fell through to the "No time grid configured" empty state, sending the
     * reader to create a TimeGrid they already have.
     */
    const loadError = computed(() => (asyncData.error.value
        ? describeScheduleFailure(asyncData.error.value)
        : null));

    const allSessions = computed(() => reference.value?.sessions ?? []);
    const violations = computed(() => reference.value?.violations ?? []);

    const onGridSessions = computed(() => (grid.value
        ? allSessions.value.filter((s) => isOnGrid(grid.value as TimeGrid, s))
        : []));

    /** Sessions the grid cannot position — surfaced, never silently dropped. */
    const offGridSessions = computed(() => (grid.value
        ? allSessions.value.filter((s) => !isOnGrid(grid.value as TimeGrid, s))
        : []));

    const violationsBySessionId = computed(() => {
        const map = new Map<string, Violation[]>();

        for (const violation of violations.value) {
            // Skipped, not bucketed under '': an offering-scoped violation
            // belongs to no chip on the grid.
            if (!violation.sessionId) {
                continue;
            }

            const list = map.get(violation.sessionId) ?? [];

            list.push(violation);
            map.set(violation.sessionId, list);
        }

        return map;
    });

    const lookup = {
        room: (id: string) => rooms.value.find((r) => r.id === id)?.name ?? id,
        person: (id: string) => people.value.find((p) => p.id === id)?.name ?? id,
        group: (id: string) => groups.value.find((g) => g.id === id)?.name ?? id,
        /**
         * The group's PARENT name, or null for a root.
         *
         * Group names repeat across a hierarchy — "Seminar A1" means little
         * without "under Class A" — and the nesting is load-bearing rather than
         * decorative: a Session on a cohort blocks every class beneath it, so
         * knowing where a group sits explains why a clash appears somewhere the
         * name alone would not suggest.
         *
         * ONE level only. The full ancestry is available but reads as noise in a
         * side panel, and the immediate parent is what disambiguates.
         *
         * `parentGroupId` already arrives in the /api/groups payload — the type
         * annotation was simply narrowing it away — so this costs no extra
         * request and no permission the page does not already hold.
         */
        groupParent: (id: string): string | null => {
            const parentId = groups.value.find((g) => g.id === id)?.parentGroupId;

            return parentId ? groups.value.find((g) => g.id === parentId)?.name ?? null : null;
        },
    };

    /**
     * The calendar date a slot in THIS term falls on, or null when no term is
     * resolved yet.
     *
     * Lives here because the term is here; every consumer (the grid's day
     * headers, the inspector) would otherwise need the term's start date and
     * would each re-derive the same arithmetic.
     */
    function slotDateOf(termWeek: number, dayOfWeek: number): Date | null {
        const start = term.value?.startDate;

        return start ? slotDate(new Date(start), termWeek, dayOfWeek) : null;
    }

    function sessionTitle(id: string): string {
        return sessionLabel(allSessions.value.find((s) => s.id === id));
    }

    async function refreshAll() {
        await asyncData.refresh();
    }

    return {
        terms, groups, rooms, people, kinds, resolvedTermId,
        virtualRoomIds, displaySettings,
        term, totalWeeks, grid,
        allSessions, onGridSessions, offGridSessions,
        violations, violationsBySessionId,
        lookup, sessionTitle, slotDateOf,
        pending, loadError, canReadViolations, refreshAll,
        /** The page awaits this — the one await, at setup top level. */
        ready: asyncData,
    };
}
