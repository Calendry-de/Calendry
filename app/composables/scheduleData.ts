import type { ComputedRef, Ref } from 'vue';
import type { ScheduleSession, Term, TimeGrid, Violation } from '~/composables/schedule';
import { isOnGrid, sessionLabel } from '~/composables/schedule';
import { slotDate, weekCountOf } from '#shared/academicCalendar';
import { DISPLAY_DEFAULTS } from '#shared/sessionColor';
import type { DisplaySettings } from '#shared/sessionColor';
import { useHasPermission } from '~/composables/session';

/**
 * Everything the schedule view reads from the server, plus what is derived from
 * it: grid geometry, the on/off-grid partition, and name lookups.
 *
 * OWNERSHIP BOUNDARY: server state and its derivations. No selection, no
 * placement mode, no view preferences.
 */
export function useScheduleData(filters: {
    termId: Ref<string>;
    query: ComputedRef<Record<string, unknown>>;
}) {
    /**
     * CRITICAL: resolved at setup time, not inside a fetch callback.
     *
     * `useRequestFetch()` needs the Nuxt request context to forward the
     * browser's cookie during SSR. Called lazily inside `useAsyncData`'s handler
     * it loses that context, every authenticated call 401s on the server, and
     * the page renders its *empty state* — indistinguishable from a tenant with
     * no data. That exact bug shipped once already; keep this line here.
     *
     * For the same reason this composable is SYNCHRONOUS. An `await` here would
     * detach every later useAsyncData/watchEffect from the Nuxt instance, which
     * fails at runtime with "a composable ... was called outside of a Vue setup
     * function". The single await belongs to the page.
     */
    const request = useRequestFetch();

    const canReadViolations = useHasPermission('violation.read');

    /**
     * One request wave, not three. Beyond being fewer round trips, it removes an
     * ordering hazard: the sessions query keys off termId, which is only known
     * after the reference data lands. Resolving both inside one handler means
     * the server never issues a sessions fetch with an empty term and renders an
     * empty grid.
     */
    const asyncData = useAsyncData('schedule', async () => {
        const [terms, timeGrids, groupRows, roomRows, personRows, kindRows] = await Promise.all([
            request<Term[]>('/api/terms'),
            request<TimeGrid[]>('/api/time-grids'),
            request<{ id: string; name: string; parentGroupId: string | null }[]>('/api/groups'),
            request<{ id: string; name: string; code: string; isVirtual: boolean }[]>('/api/rooms'),
            request<{ id: string; givenName: string; familyName: string }[]>('/api/persons'),
            /*
             * Joins the SAME wave rather than being fetched when the inspector
             * opens — but INDIVIDUALLY TOLERANT, which the others do not need
             * to be.
             *
             * `/schedule` is gated on `session.read`, and `session_kind.read` is
             * a different permission the `viewer` role does not hold. Inside a
             * bare `Promise.all` that 403 rejected the whole handler and
             * rendered a COMPLETELY BLANK page — not an error, not a partial
             * view. CLAUDE.md records this exact failure from Stage 6c and the
             * rule it left: enumerate every endpoint a page calls and confirm
             * each is covered by the permission the page is gated on.
             *
             * Degrading to an empty list is the honest fallback: a caller who
             * cannot read kinds also cannot be offered a kind picker, and the
             * schedule itself does not need them.
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
             * Virtual rooms, by id. Online delivery is a virtual ROOM and never
             * a flag on Session (TAXONOMY.md), so marking an online session on
             * the schedule means asking which of its rooms are virtual — and a
             * Set is what turns that from a lookup per chip per render into one.
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
     * The term the fetch actually used, correct at FIRST RENDER.
     *
     * `filters.termId` is seeded by the watchEffect above, and Vue does not
     * flush watchers during SSR — so on the server it is still `''` while the
     * page renders. Anything that must be right server-side has to read this
     * instead, or it renders as though no term existed. That is what hid the
     * solver control on first paint until hydration corrected it.
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
     * How this tenant wants the schedule drawn.
     *
     * A SEPARATE, TOLERANT fetch rather than a member of the reference wave: it
     * is gated on `session.read` like the page itself, so it cannot 403 where
     * the page does not — but it is also the one thing here whose absence is
     * harmless. A tenant that has never opened the Display page has no row, the
     * route answers with defaults, and if the request fails outright the
     * schedule still draws with the same defaults rather than not drawing.
     */
    const display = useAsyncData(
        'schedule-display-settings',
        () => request<DisplaySettings>('/api/display-settings').catch(() => DISPLAY_DEFAULTS),
        { default: () => DISPLAY_DEFAULTS },
    );

    const displaySettings = computed<DisplaySettings>(() => display.data.value ?? DISPLAY_DEFAULTS);

    /**
     * Resolved through `resolvedTermId`, NOT `filters.termId`.
     *
     * `filters.termId` is seeded by the watchEffect above, which Vue never
     * flushes during SSR — so on the server it is `''`, this computed is null,
     * and `totalWeeks` below falls back to 1. That made the toolbar render
     * `Week 1 / 1` with `disabled="true"` on the week buttons.
     *
     * The text was patched on hydration; the ATTRIBUTE was not. Vue does not
     * rectify attribute mismatches ("this mismatch is check-only. The DOM will
     * not be rectified"), so the buttons stayed disabled in the DOM forever and
     * week navigation was dead on every page load — not a flash, a permanently
     * broken control.
     */
    const term = computed(() => terms.value.find((t) => t.id === resolvedTermId.value) ?? null);
    /**
     * `weekCountOf`, the SAME function the week classifier, the solver calendar
     * and `POST /api/sessions`'s validation already use.
     *
     * This used to call a local `weeksInTerm`, which computed the raw span
     * (`ceil((end - start) / 7)`) instead of counting Monday-anchored weeks.
     * The two disagree on roughly half of all terms, always by one, and the
     * toolbar was the only thing reading the local version — so the schedule
     * capped a term one week short of what the server would accept, and the
     * final week was unreachable. Measured on a Saturday-start term: the
     * toolbar said `Week 1 / 12` and disabled the next button there, while the
     * classifier, the solver and the API all said 13.
     *
     * `POST /api/sessions` already carried the warning in a comment — that
     * computing this locally "would be a fourth definition of which week is
     * this" — written after the local version already existed.
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
        pending, canReadViolations, refreshAll,
        /** The page awaits this — the one await, at setup top level. */
        ready: asyncData,
    };
}
