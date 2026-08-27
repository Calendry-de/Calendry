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
                <p class="props_sub">
                    Schedules the solver has produced. Applying one replaces a term's
                    timetable; nothing here changes anything until you do.
                </p>
            </div>

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
        </header>

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
            <h2>{{ scope === 'READY' ? 'Nothing awaiting a decision' : 'No proposals yet' }}</h2>
            <p v-if="scope === 'READY'">
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

        <ul
            v-else
            class="props_list"
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
                    </p>
                    <p class="props_meta">
                        {{ row.termName ?? 'Term unknown' }} ·
                        <time :datetime="row.createdAt">{{ formatDate(row.createdAt) }}</time>
                    </p>
                </div>

                <dl class="props_stats">
                    <div>
                        <dt>Sessions</dt>
                        <dd>{{ row.placements ?? '—' }}</dd>
                    </div>
                    <div>
                        <dt>Unresolved</dt>
                        <dd :class="{ 'props_flagged': (row.hardViolations ?? 0) > 0 }">
                            <Icon
                                v-if="(row.hardViolations ?? 0) > 0"
                                name="material-symbols:error"
                                aria-hidden="true"
                            />
                            {{ row.hardViolations ?? '—' }}
                        </dd>
                    </div>
                    <div>
                        <dt>Score</dt>
                        <dd>
                            {{ row.objective === null ? '—' : row.objective.toLocaleString() }}
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
    </div>
</template>

<script setup lang="ts">
import CommonButton from '~/components/common/CommonButton.vue';

/**
 * Gated on `session.read`, matching the API route behind it and the review page
 * it leads to. Deliberately not the six-permission `schedule` middleware: this
 * page renders proposals, and degrades to an unnamed term rather than refusing
 * a caller who cannot read terms.
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
    solverMeta: { placements?: number; hardViolations?: number; objective?: number | null } | null;
    run: { termId: string; objective: number | null; inputHash: string | null } | null;
}

const scope = ref<'READY' | 'ALL'>('READY');
const request = useRequestFetch();

/**
 * SSR-safe fetch: `useRequestFetch()` rather than bare `$fetch`, which drops the
 * browser cookie server-side — the page would 401 and render its empty state,
 * indistinguishable from a tenant with no proposals.
 */
const listing = useAsyncData(
    'schedule-proposals',
    async () => {
        const query = scope.value === 'READY' ? '?status=READY&limit=100' : '?limit=100';

        const [generations, terms] = await Promise.all([
            request<GenerationRow[]>(`/api/generations${query}`),
            // Tolerant, exactly as the review screen's reference fetches are: a
            // caller without `term.read` sees "Term unknown", not a blank page.
            request<{ id: string; name: string }[]>('/api/terms').catch(() => []),
        ]);

        return { generations, terms };
    },
    { watch: [scope] },
);

await listing;

const loadFailed = computed(() => Boolean(listing.error.value));

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
        createdAt: generation.createdAt,
        termId: generation.run?.termId ?? null,
        termName: generation.run?.termId ? termName.get(generation.run.termId) ?? null : null,
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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Formatted from the stored instant, deliberately NOT via `toLocaleDateString`.
 *
 * Two hazards it avoids. `toLocaleDateString(undefined, …)` resolves the server's
 * locale during SSR and the browser's on hydration, which is a mismatch whenever
 * they differ; and reading the day through the local timezone means a server in
 * one zone and a reader in another can disagree about which DAY a proposal was
 * created on. Reading the UTC parts gives one answer everywhere.
 */
function formatDate(iso: string): string {
    const date = new Date(iso);

    if (Number.isNaN(date.getTime())) {
        return 'date unknown';
    }

    return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}
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
        color: $content6;
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

    &_row-identity {
        flex: 1 1 22ch;
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
    }

    &_meta {
        margin-top: var(--space-2);
        font-size: var(--font-size-sm);
        font-variant-numeric: tabular-nums;
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
