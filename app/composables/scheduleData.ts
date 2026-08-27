import type { ComputedRef, Ref } from 'vue';
import type { ScheduleSession, Term, TimeGrid, Violation } from '~/composables/schedule';
import { isOnGrid, sessionLabel } from '~/composables/schedule';
import { slotDate, weekCountOf } from '#shared/academicCalendar';
import { describeScheduleFailure } from '~/composables/httpError';
import { DISPLAY_DEFAULTS } from '#shared/sessionColor';
import type { DisplaySettings } from '#shared/sessionColor';
import { useHasPermission } from '~/composables/session';

interface DirectoryRoom { id: string; code: string; name: string; isVirtual: boolean }
interface DirectoryPerson { id: string; givenName: string; familyName: string }
interface DirectoryGroup { id: string; name: string; parentGroupId: string | null }

/**
 * `GET /api/schedule/context` — everything needed to DRAW, behind the page's own
 * permission. See that route for why it exists and what it deliberately omits.
 */
interface ScheduleContext {
    /** `any` is the whole institution's timetable; `own` is the caller's. */
    scope: 'any' | 'own';
    /** The term the server actually answered for. Never re-derived client-side. */
    resolvedTermId: string;
    terms: Term[];
    timeGrids: TimeGrid[];
    rooms: DirectoryRoom[];
    people: DirectoryPerson[];
    groups: DirectoryGroup[];
}

/**
 * A directory fetch that may fail without taking the page with it.
 *
 * The `.catch` is not laziness: these lists feed CONTROLS, not the grid, and the
 * honest response to "we could not read the room list" is a schedule with no
 * room filter — not an empty screen. What must never happen is the version of
 * this that had no catch, where one 403 inside a `Promise.all` rejected the
 * whole handler and rendered nothing at all.
 */
function optional<T>(request: ReturnType<typeof useRequestFetch>, path: string): Promise<T[]> {
    return request<T[]>(path).catch(() => [] as T[]);
}

/** Union by id, first occurrence winning. Both inputs describe the same rows. */
function mergeById<T extends { id: string }>(primary: T[], extra: T[]): T[] {
    const byId = new Map<string, T>();

    for (const row of [...primary, ...extra]) {
        if (!byId.has(row.id)) {
            byId.set(row.id, row);
        }
    }

    return [...byId.values()];
}

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

    /**
     * DIRECTORY permissions, which are about QUERYING the institution rather
     * than drawing a timetable.
     *
     * Every one of these used to be a REQUIREMENT of this page, because its
     * reference wave fetched the whole roster to put names on chips — so the
     * smallest role that could see a schedule could also enumerate every person,
     * room and cohort. The names now travel with the schedule
     * (`/api/schedule/context`); these keys buy the WIDER lists that the filters
     * and the inspector's pickers offer.
     *
     * THEY DO NOT DECIDE WHETHER A FILTER EXISTS. That is the option count's job
     * (see `ScheduleToolbar`): somebody reading their own timetable holds none of
     * these and can still have sessions across three cohorts, and narrowing to
     * one of them is exactly what a filter is for. What these keys change is how
     * far the list reaches — their own schedule, or the whole institution.
     *
     * What they still decide is whether the REQUEST is made at all: skipping it
     * keeps a guaranteed 403 off the wire.
     */
    const canReadGroups = useHasPermission('group.read');
    const canReadRooms = useHasPermission('room.read');
    const canReadPeople = useHasPermission('person.read');
    const canReadKinds = useHasPermission('session_kind.read');

    /*
     * One wave: the sessions query keys off termId, which is only known after
     * the context lands, so splitting it risks a fetch with an empty term.
     */
    const asyncData = useAsyncData('schedule', async () => {
        /**
         * ONE ENDPOINT, THE PAGE'S OWN GATE. Everything needed to DRAW: the
         * terms, the grid geometry, and names for the rooms, people and groups
         * appearing in the sessions this caller may read — narrowed server-side
         * by the same rule that narrows the sessions themselves.
         *
         * Not tolerant, deliberately: without this there is no schedule, so a
         * failure must reach `loadError` and say so rather than degrade into a
         * grid with no geometry.
         */
        const context = await request<ScheduleContext>('/api/schedule/context', {
            query: filters.termId.value ? { termId: filters.termId.value } : {},
        });

        /*
         * THE SERVER'S ANSWER, not a second local default. The context's names
         * describe the term IT resolved, so re-deriving "the first term" here
         * would let the two disagree and put last year's room names on this
         * year's chips.
         */
        const resolvedTermId = context.resolvedTermId;

        const [sessions, violations, groupRows, roomRows, personRows, kindRows] = await Promise.all([
            resolvedTermId
                ? request<ScheduleSession[]>('/api/sessions', {
                    query: { ...filters.query.value, termId: resolvedTermId },
                })
                : Promise.resolve([] as ScheduleSession[]),
            resolvedTermId && canReadViolations.value
                ? request<Violation[]>('/api/violations', { query: { termId: resolvedTermId } })
                : Promise.resolve([] as Violation[]),
            /*
             * THE DIRECTORY, AND EVERY ONE OF THESE IS OPTIONAL TWICE OVER:
             * skipped when the permission is absent, and caught when it fails
             * anyway. Both matter — the permission check keeps the request off
             * the wire, and the catch survives a permission revoked mid-session
             * or a role the client's cached session predates.
             *
             * This is the wave that used to blank the whole page. It cannot now:
             * nothing here is required to render, and each list only decides
             * whether one control appears.
             */
            canReadGroups.value ? optional<DirectoryGroup>(request, '/api/groups') : [],
            canReadRooms.value ? optional<DirectoryRoom>(request, '/api/rooms') : [],
            canReadPeople.value ? optional<DirectoryPerson>(request, '/api/persons') : [],
            canReadKinds.value ? optional<{ id: string; name: string }>(request, '/api/session-kinds') : [],
        ]);

        /*
         * MERGED, context first. The directory is a superset when it arrived at
         * all, so this is a no-op for an administrator and is the whole of the
         * list for somebody reading their own timetable. Keyed by id so a row
         * present in both appears once.
         */
        const rooms = mergeById<DirectoryRoom>(context.rooms, roomRows);
        const people = mergeById<DirectoryPerson>(context.people, personRows);
        const groups = mergeById<DirectoryGroup>(context.groups, groupRows);

        return {
            scope: context.scope,
            terms: context.terms,
            timeGrids: context.timeGrids,
            groups,
            rooms: rooms.map((r) => ({ id: r.id, name: `${r.code} · ${r.name}` })),
            /*
             * Online delivery is a virtual ROOM, never a flag on Session
             * (TAXONOMY.md), so a Set here turns "is this online" from a lookup
             * per chip per render into one.
             */
            virtualRoomIds: rooms.filter((r) => r.isVirtual).map((r) => r.id),
            people: people.map((p) => ({ id: p.id, name: `${p.givenName} ${p.familyName}` })),
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
        /**
         * Whether this caller is looking at the institution's timetable or their
         * own. Read off the server's answer rather than inferred from the
         * permission, so the page and the data can never describe different
         * things.
         */
        scope: computed(() => reference.value?.scope ?? 'own'),
        term, totalWeeks, grid,
        allSessions, onGridSessions, offGridSessions,
        violations, violationsBySessionId,
        lookup, sessionTitle, slotDateOf,
        pending, loadError, canReadViolations, refreshAll,
        /** The page awaits this — the one await, at setup top level. */
        ready: asyncData,
    };
}
