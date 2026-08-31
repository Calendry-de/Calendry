import type { LocationQuery, LocationQueryValue } from 'vue-router';

/** The subset of filter state that round-trips through the URL (#74). */
export interface ScheduleFilterValues {
    termId: string;
    week: number;
    groupId: string;
    roomId: string;
    personId: string;
    includeNested: boolean;
}

function queryString(value: LocationQueryValue | LocationQueryValue[] | undefined): string | undefined {
    const single = Array.isArray(value) ? value[0] : value;

    return single || undefined;
}

/**
 * Route query → filter overrides, `undefined` per field where the query says
 * nothing — so a caller can apply only what was actually present rather than
 * every field reverting to a default on every read.
 */
export function scheduleFiltersFromQuery(query: LocationQuery): Partial<ScheduleFilterValues> {
    const weekRaw = queryString(query.week);
    const week = weekRaw !== undefined && Number(weekRaw) > 0 ? Math.trunc(Number(weekRaw)) : undefined;
    const includeNestedRaw = queryString(query.includeNested);

    return {
        termId: queryString(query.termId),
        week,
        groupId: queryString(query.groupId),
        roomId: queryString(query.roomId),
        personId: queryString(query.personId),
        includeNested: includeNestedRaw === undefined ? undefined : includeNestedRaw !== 'false',
    };
}

/**
 * Filter state → route query, omitting anything at its default — the same
 * "omitted rather than sent empty" rule `query` below applies to the API,
 * kept here so a link with nothing non-default set stays a bare `/schedule`.
 */
export function scheduleFiltersToQuery(filters: ScheduleFilterValues): Record<string, string> {
    const query: Record<string, string> = {};

    if (filters.termId) {
        query.termId = filters.termId;
    }

    if (filters.week !== 1) {
        query.week = String(filters.week);
    }

    if (filters.groupId) {
        query.groupId = filters.groupId;
        query.includeNested = String(filters.includeNested);
    }

    if (filters.roomId) {
        query.roomId = filters.roomId;
    }

    if (filters.personId) {
        query.personId = filters.personId;
    }

    return query;
}

/**
 * #73/#74's coordination rule, in one place so the store and the URL cannot
 * independently decide it differently: an explicit URL value always wins (and
 * the store is updated to match, by the caller); absent, the store's
 * remembered Term applies; absent that too, '' — the server's own default.
 */
export function resolveTermId(queryTermId: string | undefined, storedTermId: string): string {
    return queryTermId || storedTermId || '';
}

/**
 * The #75 fix: a link back to the schedule that carries the Term being
 * reviewed, so it lands on that Term instead of whichever one sorts first.
 */
export function scheduleLinkForTerm(termId: string | null): string {
    return termId ? `/schedule?termId=${encodeURIComponent(termId)}` : '/schedule';
}

/**
 * Filter state for the schedule view, held IN THE URL.
 *
 * OWNERSHIP BOUNDARY: this composable owns exactly the values that change the
 * API query, and nothing else. Density and the violations-panel toggle are
 * *view* state — they alter what the page looks like, never what it asks the
 * server for — so they stay page-local rather than drifting in here because it
 * would be convenient. (They are persisted per-viewer in a cookie there; that is
 * a different question from being addressable.)
 *
 * WHY THE URL RATHER THAN PLAIN REFS. These were six `ref`s, which made the
 * whole state of the view unaddressable and unrecoverable. Three concrete
 * consequences, all of them daily: browser Back from `/schedule/proposals` — a
 * round trip this surface actively invites — returned to week 1 with every
 * filter cleared; a reload during a 30-second solver run lost the reader's
 * place; and nobody could be sent "the Friday clash in week 7", though the page
 * already knows it serves several audiences.
 *
 * THE URL IS THEREFORE USER INPUT, and untrusted like any other. `?week=0` and
 * `?week=abc` are handled here; ids that name something the caller cannot see
 * are reconciled by the page, which is the only place that knows what the server
 * actually answered.
 */
export function useScheduleFilters() {
    const route = useRoute();
    const router = useRouter();

    /**
     * Writes coalesce through here because `router.replace()` resolves
     * ASYNCHRONOUSLY: two sets in one tick — the week stepper firing twice on a
     * fast wheel, or a term change that clears a group — would each read a
     * `route.query` that does not yet contain the other's change, and the first
     * write would be silently lost. Cleared once the router has caught up.
     */
    const pendingQuery = ref<Record<string, string | undefined>>({});

    watch(() => route.query, () => {
        pendingQuery.value = {};
    });

    /** What the controls should read: the URL, plus anything not yet committed to it. */
    const effective = computed<Record<string, unknown>>(() => ({
        ...route.query,
        ...pendingQuery.value,
    }));

    function readParam(key: string): string {
        const raw = effective.value[key];

        // An array arrives from `?group=a&group=b`. Neither value is more
        // correct than the other, so the filter reads as unset rather than
        // picking one and claiming it was asked for.
        return typeof raw === 'string' ? raw : '';
    }

    function patch(changes: Record<string, string | undefined>) {
        pendingQuery.value = { ...pendingQuery.value, ...changes };

        /*
         * SERVER-SIDE THIS IS A NO-OP, deliberately. The only writer during SSR
         * is `useScheduleData`'s watchEffect seeding the resolved term, and Vue
         * does not flush watchers on the server anyway — but a `router.replace()`
         * reached during render is a navigation mid-render, so the guard is
         * explicit rather than dependent on that.
         */
        if (import.meta.server) {
            return;
        }

        const next: Record<string, string> = {};

        for (const [key, value] of Object.entries({ ...route.query, ...pendingQuery.value })) {
            // Empty means "not filtering", which is the absence of the param
            // rather than a param whose value is the empty string.
            if (typeof value === 'string' && value !== '') {
                next[key] = value;
            }
        }

        // `replace`, never `push`: a filter tweak is not a place in history, and
        // pushing would make Back walk every keystroke of a session's filtering
        // instead of leaving the page.
        void router.replace({ query: next });
    }

    function paramRef(key: string) {
        return computed<string>({
            get: () => readParam(key),
            set: (value) => patch({ [key]: value || undefined }),
        });
    }

    const termId = paramRef('term');
    const groupId = paramRef('group');
    const roomId = paramRef('room');
    const personId = paramRef('person');

    /**
     * Clamped at the FLOOR only. A week past the end of the term needs
     * `totalWeeks`, which belongs to the fetched term rather than to the URL, so
     * the page clamps the ceiling once it knows it — this keeps `?week=0` and
     * `?week=-3` and `?week=abc` from ever reaching the query.
     */
    const week = computed<number>({
        get: () => {
            const parsed = Number.parseInt(readParam('week'), 10);

            return Number.isFinite(parsed) && parsed >= 1 ? parsed : 1;
        },
        // Week 1 is the default, so it travels as the absence of the param.
        set: (value) => patch({ week: value > 1 ? String(value) : undefined }),
    });

    /**
     * DEFAULTS TRUE, so it is the *disabled* case that needs writing down —
     * `?nested=0`. Encoding the default would put a param in every schedule URL
     * that says only "nothing unusual here".
     */
    const includeNested = computed<boolean>({
        get: () => readParam('nested') !== '0',
        set: (value) => patch({ nested: value ? undefined : '0' }),
    });

    /**
     * The exact shape sent to GET /api/sessions. Optional filters are omitted
     * rather than sent empty, so the server never has to treat '' as "all".
     */
    const query = computed(() => ({
        termId: termId.value,
        termWeek: week.value,
        ...(groupId.value ? { groupId: groupId.value, includeNested: includeNested.value } : {}),
        ...(roomId.value ? { roomId: roomId.value } : {}),
        ...(personId.value ? { personId: personId.value } : {}),
    }));

    return { termId, week, groupId, roomId, personId, includeNested, query };
}
