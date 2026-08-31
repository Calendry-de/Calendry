<!--
    Every proposal the solver has produced for this tenant, so a decision is not
    lost when the run that made it scrolls away. Design intent lives in DESIGN.md.
-->
<template>
    <div class="props">
        <header class="props_head">
            <div>
                <NuxtLink
                    to="/schedule"
                    class="props_back"
                >
                    <Icon
                        name="material-symbols:arrow-back"
                        aria-hidden="true"
                    />
                    Schedule
                </NuxtLink>
                <h1>Proposals</h1>
                <!--
                    "one term's" is now a GUARANTEE rather than a hope. This copy
                    already said "a term's timetable" while the handler
                    superseded the tenant's current schedule whatever term it
                    belonged to — the words were right and the code was wrong.
                    Since it is true, it is worth stating plainly: the reassurance
                    a department head needs before applying anything is that the
                    rest of the institution is untouched.

                    "Mostly the solver's" rather than "the solver has produced",
                    because the list under All also carries the tenant's starting
                    baseline, which no solver made.
                -->
                <p class="props_sub">
                    Proposed schedules, mostly the solver's. Applying one replaces that
                    term's timetable and leaves every other term alone; nothing here
                    changes anything until you do.
                </p>
            </div>

            <div class="props_controls">
                <!--
                    A FILTER EXISTS WHEN IT HAS MORE THAN ONE OPTION, never
                    because of a permission — the rule `ScheduleToolbar`
                    documents. The term list is tolerant (a caller without
                    `term.read` gets none), so with nothing to choose between
                    the control is absent rather than empty.
                -->
                <label
                    v-if="terms.length > 1"
                    class="props_term"
                >
                    <span>Term</span>
                    <select v-model="termId">
                        <option
                            value=""
                            :selected="termId === ''"
                        >All terms</option>
                        <option
                            v-for="term in terms"
                            :key="term.id"
                            :value="term.id"
                            :selected="term.id === termId"
                        >{{ term.name }}</option>
                    </select>
                </label>

                <div
                    class="props_scope"
                    role="group"
                    aria-label="Which proposals to show"
                >
                    <button
                        v-for="option in SCOPES"
                        :key="option.value"
                        type="button"
                        class="props_scope-option"
                        :class="{ 'props_scope-option--active': scope === option.value }"
                        :aria-pressed="scope === option.value"
                        @click="scope = option.value"
                    >{{ option.label }}</button>
                </div>

                <!--
                    ALWAYS PRESENT, not only after a failure. The only way to
                    advance this list used to be the error banner's Retry, which
                    is `v-if="loadFailed"` and therefore absent exactly while
                    things are working — so a reader watching a running solve had
                    no way to ask again. It is also the manual path when the
                    automatic poll is paused because the tab is in the
                    background.
                -->
                <CommonButton
                    type="secondary"
                    :disabled="listing.pending.value"
                    @click="refresh"
                >
                    <template #icon>
                        <Icon
                            name="material-symbols:refresh"
                            aria-hidden="true"
                        />
                    </template>
                    {{ listing.pending.value ? 'Refreshing…' : 'Refresh' }}
                </CommonButton>
            </div>
        </header>

        <!--
            A run finishing is a state change nobody asked for, so it has to be
            announced rather than merely rendered. Mounted for the life of the
            page and never hidden — a live region only announces a change inside
            a region already being observed. The visible half needs nothing: the
            row's own status text changes in place, in view.
        -->
        <p
            class="props_sr"
            role="status"
            aria-live="polite"
        >{{ announcement }}</p>

        <p
            v-if="loadFailed"
            class="props_error"
            role="alert"
        >
            <Icon
                name="material-symbols:error"
                aria-hidden="true"
            />
            Could not load proposals. Nothing has been changed — try again.
            <CommonButton
                type="link"
                @click="refresh"
            >Retry</CommonButton>
        </p>

        <!--
            An empty state that distinguishes its two causes. "Nothing awaiting a
            decision" is good news; "no proposals at all" is a prompt to run the
            solver. One message for both would make a healthy tenant look broken.
        -->
        <div
            v-else-if="!rows.length"
            class="props_empty"
        >
            <Icon
                name="material-symbols:auto-awesome-outline"
                aria-hidden="true"
            />
            <!--
                THREE CAUSES NOW, not two. A term filter makes "nothing here" a
                claim about that term rather than about the institution, and the
                old copy would have told someone their solver had never run
                because they had narrowed to a term it had not run for.
            -->
            <h2>{{ emptyTitle }}</h2>
            <p v-if="activeTermName">
                Nothing for <strong>{{ activeTermName }}</strong>{{ scope === 'READY' ? ' is awaiting a decision' : ' has been produced yet' }}.
                Other terms may have proposals — clear the term filter to see them.
            </p>
            <p v-else-if="scope === 'READY'">
                Every proposal has been applied or discarded. Generate a schedule from
                the toolbar on the schedule page to produce a new one.
            </p>
            <p v-else>
                The solver has not produced a schedule for this institution yet. Open
                the schedule, pick a term, and choose <strong>Generate schedule</strong>.
            </p>
            <CommonButton
                type="secondary"
                to="/schedule"
            >Go to the schedule</CommonButton>
        </div>

        <!--
            `role="list"` because `list-style: none` makes Safari + VoiceOver drop
            list semantics and, with them, the item count — which on this page is
            the only cue for how many decisions are waiting.
        -->
        <ul
            v-else
            class="props_list"
            role="list"
        >
            <li
                v-for="row in rows"
                :key="row.id"
                class="props_row"
                :class="{ 'props_row--decidable': row.status === 'READY' }"
            >
                <div class="props_row-identity">
                    <p class="props_version">
                        v{{ row.version }}
                        <span
                            class="props_status"
                            :class="`props_status--${row.status.toLowerCase()}`"
                        >{{ STATUS_LABEL[row.status] ?? row.status.toLowerCase() }}</span>

                        <!--
                            `isCurrent` was fetched and typed and never rendered,
                            so nothing on this list said which proposal is the
                            timetable people are actually being taught from.
                            APPLIED does not answer it: a proposal applied in
                            March and replaced in April is still APPLIED, so the
                            status reads as history where this reads as
                            consequence. It matters more now that "current" is
                            per TERM — several rows here can be live at once, one
                            per term, and before that only one ever could be.
                        -->
                        <span
                            v-if="row.isCurrent"
                            class="props_live"
                        >
                            <Icon
                                name="material-symbols:play-circle-outline"
                                aria-hidden="true"
                            />
                            being taught now
                        </span>
                    </p>
                    <!--
                        A tenant-wide snapshot is NOT an unknown term. This read
                        "Term unknown" for the baseline every tenant starts from,
                        which describes a missing fact rather than the real one.
                    -->
                    <p class="props_meta">
                        {{ row.isTenantWide ? 'Whole institution' : row.termName ?? 'Term unknown' }} ·
                        <time :datetime="row.createdAt">{{ formatDate(row.createdAt, locale) }}</time>
                    </p>
                </div>

                <dl class="props_stats">
                    <div>
                        <dt>Sessions</dt>
                        <dd>{{ row.placements ?? '—' }}</dd>
                    </div>
                    <!--
                        "Hard violations", not "Unresolved". Two problems in one
                        word: it was a fourth name for a quantity the toolbar,
                        the inspector and the panel all call a violation, and
                        "unresolved" implies a workflow state — something waiting
                        to be dealt with — when the number is a property of the
                        proposal itself. `solverMeta.hardViolations` counts HARD
                        only, so the severity belongs in the label: a proposal
                        with soft breaches and no hard ones reads 0 here, and
                        "Unresolved: 0" invited "nothing wrong with it".
                    -->
                    <div>
                        <dt>Hard violations</dt>
                        <dd :class="{ 'props_flagged': (row.hardViolations ?? 0) > 0 }">
                            <Icon
                                v-if="(row.hardViolations ?? 0) > 0"
                                name="material-symbols:error"
                                aria-hidden="true"
                            />
                            {{ row.hardViolations ?? '—' }}
                        </dd>
                    </div>
                    <!--
                        "Penalty", and it says which direction is better.
                        "Score" reads as an achievement, so a higher one reads as
                        a better schedule — the exact inversion of what the
                        number means. It is a weighted penalty sum the solver
                        MINIMIZES, and the code below already refuses to rank by
                        it across different inputs; the label now carries the
                        same caution the `bestOf` badge does, said where the
                        number is rather than only where a badge happens to
                        appear.
                    -->
                    <div>
                        <dt>Penalty <span class="props_hint">lower is better</span></dt>
                        <dd>
                            <!--
                                THE VIEWER'S LOCALE, EXPLICITLY. A bare
                                `toLocaleString()` resolves the SERVER's locale
                                during SSR and the BROWSER's on hydration, so
                                33,955 and 33.955 swap places between the two
                                renders — the exact hazard `formatDate`'s doc
                                comment was written about, committed here on
                                numbers instead of dates.
                            -->
                            {{ row.objective === null ? '—' : row.objective.toLocaleString(locale) }}
                            <!--
                                The one comparison this data supports, and it is
                                worth a lot: 17 READY proposals here share an
                                input hash with objectives from 430 to 33,955,
                                and nothing in the product let anyone see that.
                                Scoped to identical inputs, and it says so — see
                                the note on `bestOf`.
                            -->
                            <span
                                v-if="row.bestOf"
                                class="props_best"
                            >best of {{ row.bestOf }} on the same input</span>
                        </dd>
                    </div>
                </dl>

                <div class="props_row-actions">
                    <CommonButton
                        type="secondary-black"
                        :to="`/schedule/review/${row.id}`"
                    >{{ row.status === 'READY' ? 'Review' : 'Inspect' }}</CommonButton>
                </div>
            </li>
        </ul>

        <!--
            THE LIST IS CAPPED AND MUST SAY SO. `/api/generations` takes
            `limit` (max 100) and returns a bare array with no total, so a tenant
            past 100 proposals silently sees a subset presented as the whole
            history. Saying which 100 is the honest version of a fact this page
            cannot count.
        -->
        <p
            v-if="truncated"
            class="props_truncated"
        >
            Showing the 100 most recent proposals. Older ones are not listed.
        </p>
    </div>
</template>

<script setup lang="ts">
import CommonButton from '~/components/common/CommonButton.vue';
import { useViewerLocale } from '~/composables/locale';
import { formatDate } from '~/utils/formatDate';

const locale = useViewerLocale();

/**
 * Gated on `generation.read`, matching the API route behind it and the review
 * page it leads to. Deliberately not the six-permission `schedule` middleware:
 * this page renders proposals, and degrades to an unnamed term rather than
 * refusing a caller who cannot read terms.
 */
definePageMeta({ middleware: 'review' });

useHead({ title: 'Proposals' });

const SCOPES = [
    { value: 'READY' as const, label: 'Awaiting a decision' },
    { value: 'ALL' as const, label: 'All' },
];

const STATUS_LABEL: Record<string, string> = {
    READY: 'awaiting a decision',
    APPLIED: 'applied',
    SUPERSEDED: 'discarded or superseded',
    FAILED: 'failed',
    INFEASIBLE: 'infeasible',
    PENDING: 'pending',
    RUNNING: 'running',
};

interface GenerationRow {
    id: string;
    version: number;
    status: string;
    isCurrent: boolean;
    createdAt: string;
    /** The Generation's OWN term. Null = a tenant-wide baseline or import. */
    termId: string | null;
    solverMeta: { placements?: number; hardViolations?: number; objective?: number | null } | null;
    run: { termId: string; objective: number | null; inputHash: string | null } | null;
}

/**
 * PENDING and RUNNING advance WITHOUT THIS PAGE ASKING — the solver poller moves
 * them server-side. Every other status is terminal, reached only by an action.
 * That distinction is the whole reason this page needs a clock.
 */
const LIVE_STATUSES = ['PENDING', 'RUNNING'];

/**
 * `/api/generations` caps `limit` at 100 and returns a bare array with no total,
 * so this is both the request and the only truncation signal available.
 */
const LIST_LIMIT = 100;

const scope = ref<'READY' | 'ALL'>('READY');

/**
 * IN THE URL, so a term's proposal list is a shareable place — the same
 * reasoning `useScheduleFilters` documents for the schedule itself. Empty means
 * every term.
 */
const route = useRoute();
const router = useRouter();

const termId = computed<string>({
    get: () => (typeof route.query.term === 'string' ? route.query.term : ''),
    set: (value) => {
        const query = { ...route.query };

        if (value) {
            query.term = value;
        } else {
            delete query.term;
        }

        void router.replace({ query });
    },
});

const request = useRequestFetch();

/**
 * SSR-safe fetch: `useRequestFetch()` rather than bare `$fetch`, which drops the
 * browser cookie server-side — the page would 401 and render its empty state,
 * indistinguishable from a tenant with no proposals.
 */
const listing = useAsyncData(
    'schedule-proposals',
    async () => {
        const params = new URLSearchParams({ limit: String(LIST_LIMIT) });

        if (scope.value === 'READY') {
            params.set('status', 'READY');
        }

        // The server filters in its query now, so `limit` applies to this term's
        // proposals rather than to the newest 100 across every term.
        if (termId.value) {
            params.set('termId', termId.value);
        }

        const query = `?${params.toString()}`;

        const [generations, terms] = await Promise.all([
            request<GenerationRow[]>(`/api/generations${query}`),
            // Tolerant, exactly as the review screen's reference fetches are: a
            // caller without `term.read` sees "Term unknown", not a blank page.
            request<{ id: string; name: string }[]>('/api/terms').catch(() => []),
        ]);

        return { generations, terms };
    },
    { watch: [scope, termId] },
);

await listing;

const loadFailed = computed(() => Boolean(listing.error.value));

/** Tolerant: a caller without `term.read` gets none, and the filter disappears. */
const terms = computed(() => listing.data.value?.terms ?? []);

const activeTermName = computed(() => (
    termId.value ? terms.value.find((term) => term.id === termId.value)?.name ?? null : null
));

const emptyTitle = computed(() => {
    if (activeTermName.value) {
        return scope.value === 'READY' ? 'Nothing awaiting a decision here' : 'No proposals for this term';
    }

    return scope.value === 'READY' ? 'Nothing awaiting a decision' : 'No proposals yet';
});

const rows = computed(() => {
    const data = listing.data.value;

    if (!data) {
        return [];
    }

    const termName = new Map(data.terms.map((term) => [term.id, term.name]));

    const enriched = data.generations.map((generation) => ({
        id: generation.id,
        version: generation.version,
        status: generation.status,
        isCurrent: generation.isCurrent,
        createdAt: generation.createdAt,
        /*
         * THE GENERATION'S OWN TERM, with the run as a fallback only for rows
         * that predate the `term_id` column and were never backfilled because
         * their run row is gone. A null term is a real state — a tenant-wide
         * baseline — and renders as such rather than as "unknown".
         */
        termId: generation.termId ?? generation.run?.termId ?? null,
        termName: (() => {
            const id = generation.termId ?? generation.run?.termId ?? null;

            return id ? termName.get(id) ?? null : null;
        })(),
        isTenantWide: generation.termId === null && !generation.run?.termId,
        placements: generation.solverMeta?.placements ?? null,
        hardViolations: generation.solverMeta?.hardViolations ?? null,
        objective: generation.run?.objective ?? generation.solverMeta?.objective ?? null,
        inputHash: generation.run?.inputHash ?? null,
    }));

    /**
     * WHAT MAKES TWO SCORES COMPARABLE: an identical solver input, not a shared
     * term.
     *
     * The objective is a weighted penalty sum with no absolute scale, so it only
     * means something between runs that solved the SAME problem. Ranking within a
     * term looked right and was not: measured against real data, it crowned a
     * 67-session proposal at score 40 over a 260-session one at 430 for the same
     * term — the 67-session run scored lower because it had far less to place.
     * That badge would have recommended the worse schedule with a green label.
     *
     * `inputHash` is the exact identity of the input (SHA-256 of the encoded
     * SolverInput; it is half the idempotency key), so same hash means literally
     * the same problem. A run without one earns no badge — fail closed, because
     * the failure mode here is a confident recommendation.
     *
     * COMPARED AT DISPLAYED PRECISION. The solver returns accumulated floats:
     * proposals came back as 429.99999999999926 and 429.9999999999995, which
     * both render as "430". Comparing raw values would award "best" to whichever
     * way the float noise fell and hide a genuine tie behind a badge that looks
     * like a finding.
     */
    const scoreKey = (objective: number) => Math.round(objective * 1000) / 1000;

    const comparable = enriched.filter((row) => (
        row.status === 'READY' && row.objective !== null && row.inputHash !== null
    ));

    const bestByInput = new Map<string, { score: number; count: number }>();

    for (const row of comparable) {
        const score = scoreKey(row.objective!);
        const current = bestByInput.get(row.inputHash!);

        bestByInput.set(row.inputHash!, {
            score: current === undefined ? score : Math.min(current.score, score),
            count: (current?.count ?? 0) + 1,
        });
    }

    return enriched.map((row) => {
        const group = row.inputHash ? bestByInput.get(row.inputHash) : undefined;

        return {
            ...row,
            /**
             * Only when there is a field to win. One candidate is not a
             * comparison, and a group where everything ties has no best.
             */
            bestOf: (
                group
                && row.objective !== null
                && group.count > 1
                && group.score === scoreKey(row.objective)
                && comparable.some((other) => (
                    other !== row
                    && other.inputHash === row.inputHash
                    && scoreKey(other.objective!) !== scoreKey(row.objective!)
                ))
            )
                ? group.count
                : null,
        };
    });
});

const refresh = () => listing.refresh();

/** The cap was hit, so this list is a subset presented as a whole. */
const truncated = computed(() => (listing.data.value?.generations.length ?? 0) >= LIST_LIMIT);

const liveRowCount = computed(() => rows.value.filter((row) => LIVE_STATUSES.includes(row.status)).length);

/**
 * A LIVE ROW IS A CLOCK, AND THIS PAGE HAD NONE.
 *
 * `PENDING` and `RUNNING` were rendered statically: the row for a solve in
 * progress sat unchanged until the reader navigated away and back, which on the
 * one page whose job is "what can I decide?" means the answer arrives and
 * nothing says so.
 *
 * Polls only while something can actually change, and stops the moment the last
 * live row reaches a terminal status — an idle list costs nothing. The
 * self-rescheduling timeout (rather than an interval) is the idiom
 * `useSolverRun` already uses, and it cannot overlap its own request.
 */
const POLL_MS = 5000;

let pollTimer: ReturnType<typeof setTimeout> | undefined;
let pollStopped = false;

function schedulePoll() {
    clearTimeout(pollTimer);

    /*
     * NOT WHILE THE TAB IS HIDDEN. A backgrounded page with a running solve
     * would otherwise spend an hour asking a question nobody is reading; the
     * visibility listener below resumes and refreshes at once on return, so
     * coming back never shows a stale row.
     */
    if (pollStopped || !liveRowCount.value || document.hidden) {
        return;
    }

    pollTimer = setTimeout(async () => {
        await listing.refresh();
        schedulePoll();
    }, POLL_MS);
}

function onVisibilityChange() {
    if (document.hidden) {
        clearTimeout(pollTimer);

        return;
    }

    if (liveRowCount.value) {
        void listing.refresh();
    }

    schedulePoll();
}

onMounted(() => {
    document.addEventListener('visibilitychange', onVisibilityChange);
    schedulePoll();
});

onBeforeUnmount(() => {
    pollStopped = true;
    clearTimeout(pollTimer);
    document.removeEventListener('visibilitychange', onVisibilityChange);
});

// Starts the clock when a live row appears (switching scope to All can reveal
// one), and lets it lapse when the last one finishes. `schedulePoll` clears
// before it schedules, so calling it twice cannot double up.
watch(liveRowCount, schedulePoll);

/**
 * What CHANGED, for the reader who cannot see the row change.
 *
 * Only live → terminal transitions, which are the ones worth interrupting for: a
 * proposal becoming decidable is the event this page exists to report. Statuses
 * are seeded on the first pass without announcing, so arriving at a list of
 * finished runs says nothing.
 */
const lastStatuses = new Map<string, string>();
const announcement = ref('');

watch(rows, (current) => {
    const finished: string[] = [];

    for (const row of current) {
        const before = lastStatuses.get(row.id);

        if (before && LIVE_STATUSES.includes(before) && !LIVE_STATUSES.includes(row.status)) {
            finished.push(`v${row.version} is now ${STATUS_LABEL[row.status] ?? row.status.toLowerCase()}`);
        }

        lastStatuses.set(row.id, row.status);
    }

    if (finished.length) {
        announcement.value = `${finished.join('. ')}.`;
    }
}, { immediate: true });

</script>

<style scoped lang="scss">
.props {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    padding: var(--space-6);

    &_head {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-5);
        align-items: flex-start;
        justify-content: space-between;

        h1 {
            font-size: var(--font-size-xl);
            color: $content1;
        }
    }

    &_back {
        display: inline-flex;
        gap: var(--space-3);
        align-items: center;

        min-height: 44px;
        margin: calc(var(--space-5) * -1) 0;
        padding: var(--space-5) 0;

        font-size: var(--font-size-sm);
        color: $content6;
        text-decoration: none;

        svg {
            width: 15px;
            height: 15px;
        }

        @include hover() {
            &:hover {
                color: $content2;
                text-decoration: underline;
            }
        }
    }

    &_sub {
        max-width: 62ch;
        margin-top: var(--space-3);

        font-size: var(--font-size-md);
        line-height: var(--leading-prose);
        color: $content6;
    }

    &_sr {
        position: absolute;

        overflow: hidden;

        width: 1px;
        height: 1px;

        white-space: nowrap;

        clip-path: inset(50%);
    }

    &_controls {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-4);
        align-items: center;
    }

    // The label register DESIGN.md sets: uppercase 11px with 0.05em tracking,
    // matching the schedule toolbar's filters so the two read as one system.
    &_term {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);

        span {
            font-size: var(--font-size-xs);
            font-weight: 600;
            color: $content6;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }

        select {
            max-width: 220px;
            min-height: 44px;
            padding: var(--space-3) var(--space-4);
            border: 1px solid $surface5;
            border-radius: var(--radius-md);

            font-family: inherit;
            font-size: var(--font-size-sm);
            color: $content2;

            background: $surface1;

            &:focus-visible {
                outline: 2px solid $primary600;
                outline-offset: 1px;
            }
        }
    }

    &_scope {
        display: flex;
        gap: var(--space-1);

        padding: var(--space-2);
        border-radius: var(--radius-lg);

        background: $surface1;
    }

    &_scope-option {
        cursor: pointer;

        min-height: 44px;
        padding: var(--space-4) var(--space-5);
        border: 0;
        border-radius: var(--radius-md);

        font-family: inherit;
        font-size: var(--font-size-sm);
        font-weight: 600;
        color: $content6;

        background: none;

        &--active {
            color: $content1;
            background: varToRgba('primary500', 0.16);
        }
    }

    &_error {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-4);
        align-items: center;

        font-size: var(--font-size-sm);
        color: $error700;

        svg {
            flex: none;
            width: 16px;
            height: 16px;
        }
    }

    &_empty {
        display: flex;
        flex-direction: column;
        gap: var(--space-4);
        align-items: center;

        padding: var(--space-10) var(--space-6);
        border-radius: var(--radius-lg);

        text-align: center;

        background: $surface1;

        svg {
            width: 28px;
            height: 28px;
            color: $content6;
        }

        h2 {
            font-size: var(--font-size-lg);
            color: $content1;
        }

        p {
            max-width: 54ch;
            font-size: var(--font-size-md);
            line-height: var(--leading-prose);
            color: $content6;
        }
    }

    &_list {
        display: flex;
        flex-direction: column;
        gap: var(--space-4);
        list-style: none;
    }

    &_row {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-5) var(--space-7);
        align-items: center;
        justify-content: space-between;

        padding: var(--space-5) var(--space-6);
        border-left: var(--space-1) solid transparent;
        border-radius: var(--radius-lg);

        background: $surface1;

        // A decidable proposal is the reason this page exists; a decided one is
        // context. The accent marks the ones that are still a question.
        &--decidable {
            border-left-color: $primary500;
        }
    }

    /*
     * `min-width: 0` because a flex item defaults to `min-width: auto`, which
     * refuses to shrink below its content — an institution that names a term
     * "Wintersemester 2027/28 (Fachbereich Elektrotechnik und
     * Informationstechnik)" pushed the stats and the action off the row.
     */
    &_row-identity {
        flex: 1 1 22ch;
        min-width: 0;
    }

    &_version {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-4);
        align-items: baseline;

        font-size: var(--font-size-lg);
        font-weight: 600;
        font-variant-numeric: tabular-nums;
        color: $content1;
    }

    /*
     * SEVEN STATUSES, THREE REGISTERS. Four were coloured and three fell through
     * to the same `$content6`, so "pending", "running" and "discarded or
     * superseded" were typographically identical — a live run and a dead one
     * reading the same is the worst of the three to get wrong.
     *
     * A verdict gets colour. A live state gets a FILLED PILL, reusing this
     * page's own `props_best` device, so "still happening" is legible as a shape
     * rather than as a hue — it survives greyscale, and it needs no new colour
     * family. A superseded proposal recedes instead: `$content7` is a step
     * WEAKER than the default, which is the right direction for context nobody
     * has to act on.
     */
    &_status {
        font-size: var(--font-size-xs);
        font-weight: 600;
        color: $content6;
        text-transform: uppercase;
        letter-spacing: 0.05em;

        &--ready { color: $primary700; }
        &--applied { color: $success700; }

        &--failed,
        &--infeasible { color: $error700; }

        &--pending,
        &--running {
            padding: var(--space-1) var(--space-3);
            border-radius: var(--radius-sm);
            color: $content2;
            background: varToRgba('content4', 0.12);
        }

        &--superseded { color: $content7; }
    }

    &_meta {
        margin-top: var(--space-2);

        font-size: var(--font-size-sm);
        font-variant-numeric: tabular-nums;
        color: $content6;

        // A term name is tenant-supplied text of no known length, and may carry
        // no spaces to break at.
        overflow-wrap: anywhere;
    }

    &_truncated {
        font-size: var(--font-size-sm);
        color: $content6;
    }

    &_stats {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-5) var(--space-7);
        align-items: baseline;

        dt {
            font-size: var(--font-size-xs);
            font-weight: 600;
            color: $content6;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }

        dd {
            display: flex;
            flex-wrap: wrap;
            gap: var(--space-3);
            align-items: baseline;

            margin-top: var(--space-2);

            font-size: var(--font-size-md);
            font-variant-numeric: tabular-nums;
            color: $content2;
        }

        svg {
            width: 14px;
            height: 14px;
            color: $error700;
        }
    }

    &_flagged {
        color: $error700;
    }

    /*
     * The one green thing on a row, and it means "this is live" rather than
     * "this is good" — `props_best` is the other green, and the two never
     * coexist: a READY proposal can win a comparison, an applied one cannot
     * still be in the running.
     */
    &_live {
        display: inline-flex;
        gap: var(--space-2);
        align-items: center;

        padding: var(--space-1) var(--space-3);
        border-radius: var(--radius-sm);

        font-size: var(--font-size-xs);
        font-weight: 600;
        color: $success700;
        text-transform: uppercase;
        letter-spacing: 0.05em;

        background: varToRgba('success600', 0.14);

        svg {
            width: 13px;
            height: 13px;
        }
    }

    // Sits inside a `dt`, so it must not inherit the uppercase label register —
    // it is a sentence fragment, not a label.
    &_hint {
        margin-left: var(--space-2);
        font-weight: 400;
        text-transform: none;
        letter-spacing: 0;
    }

    &_best {
        padding: var(--space-1) var(--space-3);
        border-radius: var(--radius-sm);

        font-size: var(--font-size-xs);
        font-weight: 600;
        color: $success700;
        text-transform: uppercase;
        letter-spacing: 0.05em;

        background: varToRgba('success600', 0.1);
    }

    @include mobile() {
        padding: var(--space-5);

        &_head {
            flex-direction: column;
            align-items: stretch;
        }

        &_row {
            flex-direction: column;
            align-items: stretch;
        }
    }
}
</style>
