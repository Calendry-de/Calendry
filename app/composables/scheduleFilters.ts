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
 * Filter state for the schedule view.
 *
 * OWNERSHIP BOUNDARY: this composable owns exactly the values that change the
 * API query, and nothing else. Density and the violations-panel toggle are
 * *view* state — they alter what the page looks like, never what it asks the
 * server for — so they stay page-local rather than drifting in here because it
 * would be convenient.
 */
export function useScheduleFilters() {
    const termId = ref('');
    const week = ref(1);
    const groupId = ref('');
    const roomId = ref('');
    const personId = ref('');
    const includeNested = ref(true);

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
