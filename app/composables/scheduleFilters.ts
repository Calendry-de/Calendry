/**
 * #73/#74's coordination rule, in one place so the store and the URL cannot
 * independently decide it differently: an explicit URL value always wins (and
 * the store is updated to match, by the caller); absent, the store's
 * remembered Term applies; absent that too, '' (the server's own default).
 *
 * `useScheduleFilters()` below owns reading AND writing the URL itself
 * (`termId` there is a computed backed by `?term=`); this function is only
 * the precedence rule between that value and the Pinia store, not a second
 * reader of the query string.
 */
export function resolveTermId(queryTermId: string | undefined, storedTermId: string): string {
    return queryTermId || storedTermId || '';
}

/**
 * The #75 fix: a link back to the schedule that carries the Term being
 * reviewed, so it lands on that Term instead of whichever one sorts first.
 * `term`, not `termId`: the short name is `useScheduleFilters()`'s own
 * `?term=` param, and a link built with any other key would silently fail to
 * be read.
 */
export function scheduleLinkForTerm(termId: string | null): string {
    return termId ? `/schedule?term=${encodeURIComponent(termId)}` : '/schedule';
}

/**
 * Filter state for the schedule view, held IN THE URL.
 *
 * OWNERSHIP BOUNDARY: this composable owns exactly the values that change the
 * API query, and nothing else. Density and the violations-panel toggle are
 * *view* state: they alter what the page looks like, never what it asks the
 * server for, so they stay page-local rather than drifting in here because it
 * would be convenient. (They are persisted per-viewer in a cookie there; that is
 * a different question from being addressable.)
 *
 * WHY THE URL RATHER THAN PLAIN REFS. These were six `ref`s, which made the
 * whole state of the view unaddressable and unrecoverable. Three concrete
 * consequences, all of them daily: browser Back from `/schedule/proposals`
 * (a round trip this surface actively invites) returned to week 1 with every
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
     * ASYNCHRONOUSLY: two sets in one tick (the week stepper firing twice on a
     * fast wheel, or a term change that clears a group) would each read a
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
         * does not flush watchers on the server anyway, but a `router.replace()`
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

    /**
     * A MULTI-VALUED filter, carried as ONE comma-joined param (`?room=a,b`)
     * rather than a repeated one (`?room=a&room=b`). `readParam` above treats
     * a repeated key as unset on purpose, and ids are UUIDs, which never
     * contain a comma, so the join is lossless. Deduplicated on write, so a
     * double click cannot put the same id in the URL twice; empty travels as
     * the absence of the param, same as every other filter here.
     */
    function listParamRef(key: string) {
        return computed<string[]>({
            get: () => readParam(key).split(',').filter(Boolean),
            set: (value) => patch({ [key]: value.length ? [...new Set(value)].join(',') : undefined }),
        });
    }

    const termId = paramRef('term');
    const groupIds = listParamRef('group');
    const roomIds = listParamRef('room');
    const personIds = listParamRef('person');

    /**
     * Clamped at the FLOOR only. A week past the end of the term needs
     * `totalWeeks`, which belongs to the fetched term rather than to the URL, so
     * the page clamps the ceiling once it knows it; this keeps `?week=0` and
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
     * DEFAULTS TRUE, so it is the *disabled* case that needs writing down:
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
     * The lists go over as REPEATED keys (`roomId=a&roomId=b`, ofetch's
     * array serialisation), which is the shape the route's `idList` schema
     * documents; the comma form above is the URL bar's, not the API's.
     */
    const query = computed(() => ({
        termId: termId.value,
        termWeek: week.value,
        ...(groupIds.value.length ? { groupId: groupIds.value, includeNested: includeNested.value } : {}),
        ...(roomIds.value.length ? { roomId: roomIds.value } : {}),
        ...(personIds.value.length ? { personId: personIds.value } : {}),
    }));

    return { termId, week, groupIds, roomIds, personIds, includeNested, query };
}
