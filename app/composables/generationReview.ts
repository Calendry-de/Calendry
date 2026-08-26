import { weekCountOf } from '#shared/academicCalendar';
import type { NamedRow, TimeGrid } from '~/composables/schedule';

/**
 * Everything the review screen reads and decides with.
 *
 * OWNERSHIP BOUNDARY: one proposal, under review. The preview it is judged by,
 * the week and filters currently being looked at, and the two actions that end
 * the review. It owns no live schedule state — this screen deliberately never
 * shows the applied timetable, because the whole point is that applying has not
 * happened yet.
 *
 * SYNCHRONOUS, like every composable here that calls useAsyncData: an `await`
 * before the last Nuxt-context call detaches everything after it. The page holds
 * the single top-level await.
 */

export type DiffAction = 'create' | 'move' | 'unchanged' | 'delete';

export interface Placement {
    termWeek: number;
    dayOfWeek: number;
    blockIndex: number;
    durationBlocks: number;
}

export interface ReviewPlacement {
    action: DiffAction;
    sessionId: string | null;
    offeringId: string;
    placement: Placement;
    previous: Placement | null;
    roomId: string | null;
    groupIds: string[];
    lecturerIds: string[];
    personIds: string[];
}

export interface ReviewPreview {
    generation: {
        id: string;
        version: number;
        source: string;
        status: string;
        isCurrent: boolean;
        solverMeta: Record<string, unknown> | null;
        createdAt: string;
        appliedAt: string | null;
    };
    run: {
        id: string;
        termId: string;
        status: string;
        terminationReason: string | null;
        reproducible: boolean | null;
        objective: number | null;
        movesEvaluated: string | null;
        elapsedMillis: number | null;
        seed: string | null;
    } | null;
    plan: {
        created: number;
        moved: number;
        unchanged: number;
        deleted: number;
        skippedLocked: number;
        placementsUnmapped: number;
    };
    deletedByOffering: { offeringId: string; title: string; code: string | null; count: number }[];
    violations: {
        current: { hard: number; soft: number; byType: Record<string, number> };
        proposed: {
            hard: number;
            byType: Record<string, number>;
            unmappable: number;
            sessionReferences: number;
        };
    };
    weekSummary: { termWeek: number; created: number; moved: number; unchanged: number; deleted: number }[];
    /** Names for the placements' offerings, served under this route's own gate. */
    offerings: { id: string; title: string; code: string | null }[];
    placements?: ReviewPlacement[];
    computedAt: string;
}

/**
 * Termination reason as a sentence, because the token is the single field that
 * most changes the decision and nobody should have to know what it means.
 *
 * `null` is its own case, not folded into any other: runs captured before Stage
 * 6a have no reason recorded, and claiming reproducibility there would be a
 * guess (see the no-backfill decision in CLAUDE.md).
 */
export function terminationSentence(reason: string | null): string {
    switch (reason) {
        case 'converged':
            return 'Found an optimal solution and stopped.';
        case 'move_budget':
            return 'Ran out of move budget — a longer run may do better.';
        case 'time_budget':
            return 'Ran out of time. Not reproducible — a re-run may differ.';
        case 'cancelled':
            return 'The run was cancelled.';
        default:
            return 'Unknown — this run predates termination capture.';
    }
}

/**
 * Why the preview could not be read, as something renderable.
 *
 * The screen used to have no such concept. The primary fetch is the one thing
 * here that is NOT tolerant — a proposal whose preview cannot be read is not a
 * degraded page, it is no page — so a rejection nulled `summary.data`, `preview`
 * computed to `null`, and the template fell through to its two "this proposal
 * proposes nothing" branches. A 403, a 404, a dropped connection and a genuine
 * manual-baseline Generation all rendered the same sentence, and that sentence
 * asserted a fact about the data. Naming the failure is what makes the four
 * distinguishable.
 */
export interface ReviewLoadError {
    kind: 'forbidden' | 'notFound' | 'failed';
    title: string;
    detail: string;
    /** Whether retrying could plausibly succeed. A 403 will not fix itself. */
    retryable: boolean;
}

/** `useAsyncData`'s error, narrowed without trusting its shape. */
function statusCodeOf(error: unknown): number | null {
    if (typeof error !== 'object' || error === null) {
        return null;
    }

    const code = (error as { statusCode?: unknown }).statusCode;

    return typeof code === 'number' ? code : null;
}

function describeLoadError(error: unknown): ReviewLoadError {
    switch (statusCodeOf(error)) {
        case 401:
            return {
                kind: 'forbidden',
                title: 'Your session has expired',
                detail: 'Sign in again to review this proposal.',
                retryable: false,
            };
        case 403:
            return {
                kind: 'forbidden',
                title: 'You cannot review this proposal',
                detail: 'Reviewing proposals needs the session.read permission. '
                    + 'Ask a tenant administrator to grant it.',
                retryable: false,
            };
        case 404:
            return {
                kind: 'notFound',
                title: 'No such proposal',
                detail: 'It may have been removed, or the link may point at another institution.',
                retryable: false,
            };
        default:
            return {
                kind: 'failed',
                title: 'Could not load this proposal',
                detail: 'The preview did not come back. Nothing has been changed — try again.',
                retryable: true,
            };
    }
}

/**
 * How each diff state is named and drawn.
 *
 * Here rather than in a component because BOTH presentations render it — the
 * week grid and the mobile agenda — and a chip labelled "Added" in one and
 * "Created" in the other, or carrying a different icon, is the drift that makes
 * two views of one dataset look like two datasets.
 */
export const DIFF_TAG: Record<DiffAction, string> = {
    create: 'Added',
    move: 'Moved',
    unchanged: 'Unchanged',
    delete: 'Removed',
};

export const DIFF_ICON: Record<DiffAction, string> = {
    create: 'material-symbols:add-circle-outline',
    move: 'material-symbols:arrow-forward',
    unchanged: 'material-symbols:remove',
    delete: 'material-symbols:cancel-outline',
};

/** Where a placement is drawn: a removal sits where it still is, not where it isn't. */
export function shownAt(item: ReviewPlacement): Placement {
    return item.action === 'delete' && item.previous ? item.previous : item.placement;
}

/**
 * The whole placement as one sentence.
 *
 * The grid encodes WHEN in `grid-column` and `grid-row` — inline geometry, which
 * no assistive technology reads. A moved chip announced its action, its
 * offering, its room and where it came FROM, and never said when it now is: the
 * one fact a move actually consists of.
 */
export function describePlacement(
    item: ReviewPlacement,
    slotLabel: (placement: Placement) => string,
    offeringName: (id: string) => string,
    roomName: (id: string) => string,
): string {
    const parts = [DIFF_TAG[item.action], offeringName(item.offeringId), slotLabel(shownAt(item))];

    if (item.roomId) {
        parts.push(roomName(item.roomId));
    }

    if (item.action === 'move' && item.previous) {
        parts.push(item.previous.termWeek === item.placement.termWeek
            ? `moved from ${slotLabel(item.previous)}`
            : `moved from ${slotLabel(item.previous)} in week ${item.previous.termWeek}`);
    }

    return parts.join(', ');
}

/**
 * What applying will do, in words, at the button that does it.
 *
 * The reviewer reads the plan at the top of the screen and then commits from a
 * header 800px away; nothing restated the consequence where the decision is
 * actually made. Built from the same `plan` the summary renders, so the sentence
 * cannot claim a different change than the screen shows.
 *
 * Ordered by how much each clause should worry someone: removals first — they
 * are the destructive part — then additions, then moves. Zero-count clauses are
 * omitted, because "0 removed" spends a reviewer's attention on nothing.
 */
export function applyConsequence(
    plan: ReviewPreview['plan'],
    proposedHard: number,
): string {
    const clauses: string[] = [];

    if (plan.deleted > 0) {
        clauses.push(`${plan.deleted} session${plan.deleted === 1 ? '' : 's'} removed`);
    }

    if (plan.created > 0) {
        clauses.push(`${plan.created} added`);
    }

    if (plan.moved > 0) {
        clauses.push(`${plan.moved} moved`);
    }

    const changes = clauses.length ? clauses.join(', ') : 'no placement changes';
    const parts = [`Replace this term's timetable — ${changes}.`];

    if (proposedHard > 0) {
        parts.push(
            `${proposedHard} hard-rule issue${proposedHard === 1 ? '' : 's'} the solver could not resolve `
            + 'will be recorded against the schedule.',
        );
    }

    if (plan.skippedLocked > 0) {
        parts.push(`${plan.skippedLocked} locked session${plan.skippedLocked === 1 ? '' : 's'} stay as they are.`);
    }

    return parts.join(' ');
}

export function useGenerationReview(generationId: string) {
    const request = useRequestFetch();

    const termWeek = ref(1);
    const groupId = ref('');
    const roomId = ref('');
    const personId = ref('');
    /**
     * Default ON. A proposal that moves 12 of 48 sessions renders 36 chips that
     * did not change, and the reviewer has to find the twelve that did.
     */
    const changesOnly = ref(true);

    const summary = useAsyncData(`review-${generationId}`, async () => {
        const preview = await request<ReviewPreview>(`/api/generations/${generationId}/preview`);

        /**
         * Reference data for names: placements carry ids only. Deliberately not
         * useScheduleData(), which also fetches the live sessions this screen
         * must never show.
         *
         * TOLERANT, one fetch at a time. A single 403 inside a `Promise.all`
         * rejects the whole thing and renders a BLANK page — which is exactly
         * what `/api/offerings` did to a viewer, because it requires
         * `offering.read` while this screen is gated on `session.read`. A page
         * must only depend on what its own gate guarantees.
         *
         * Offerings now travel with the preview, under that same gate. The rest
         * degrade to showing ids, which is visibly wrong rather than blank.
         */
        const optional = async <T>(path: string): Promise<T[]> => {
            try {
                return await request<T[]>(path);
            } catch {
                return [];
            }
        };

        const [terms, timeGrids, rooms, persons, groups] = await Promise.all([
            optional<{
                id: string;
                name: string;
                timeGridId: string | null;
                startDate: string;
                endDate: string;
            }>('/api/terms'),
            optional<TimeGrid>('/api/time-grids'),
            optional<{ id: string; name: string; code: string }>('/api/rooms'),
            optional<{ id: string; givenName: string; familyName: string }>('/api/persons'),
            optional<{ id: string; name: string }>('/api/groups'),
        ]);

        return {
            preview, terms, timeGrids, rooms, persons, groups,
            offerings: preview.offerings ?? [],
        };
    });

    const preview = computed(() => summary.data.value?.preview ?? null);
    const plan = computed(() => preview.value?.plan ?? null);

    /**
     * A load failure, or null. Read BEFORE any "there is nothing here" branch:
     * "nothing to review" is a statement about the proposal and may only be made
     * once the proposal has actually been read.
     */
    const loadError = computed<ReviewLoadError | null>(() => (
        summary.error.value ? describeLoadError(summary.error.value) : null
    ));

    const term = computed(() => {
        const termId = preview.value?.run?.termId;

        return summary.data.value?.terms.find((t) => t.id === termId) ?? null;
    });

    /**
     * How many weeks the term has — not how many the proposal touches.
     *
     * `weekSummary` only carries weeks that RECEIVE placements, so a proposal
     * that pulls 258 sessions into weeks 1–5 of 13 left weeks 6–13 unselectable:
     * precisely the weeks a reviewer needs to look at, because those are the ones
     * being emptied. Null when the term cannot be read (a tolerant fetch may
     * have degraded), and the page falls back to the weeks it does know.
     */
    const weekCount = computed<number | null>(() => {
        const value = term.value;

        if (!value?.startDate || !value?.endDate) {
            return null;
        }

        return weekCountOf(new Date(value.startDate), new Date(value.endDate));
    });

    const grid = computed<TimeGrid | null>(() => {
        const grids = summary.data.value?.timeGrids ?? [];

        return grids.find((g) => g.id === term.value?.timeGridId)
            ?? grids.find((g) => g.isDefault)
            ?? grids[0]
            ?? null;
    });

    const offerings = computed<NamedRow[]>(() => (summary.data.value?.offerings ?? []).map((o) => ({
        id: o.id,
        name: o.code ? `${o.code} · ${o.title}` : o.title,
    })));
    const rooms = computed<NamedRow[]>(() => (summary.data.value?.rooms ?? []).map((r) => ({
        id: r.id, name: `${r.code} · ${r.name}`,
    })));
    const people = computed<NamedRow[]>(() => (summary.data.value?.persons ?? []).map((p) => ({
        id: p.id, name: `${p.givenName} ${p.familyName}`,
    })));
    const groups = computed<NamedRow[]>(() => summary.data.value?.groups ?? []);

    const lookup = {
        offering: (id: string) => offerings.value.find((o) => o.id === id)?.name ?? id,
        room: (id: string) => rooms.value.find((r) => r.id === id)?.name ?? id,
        person: (id: string) => people.value.find((p) => p.id === id)?.name ?? id,
        group: (id: string) => groups.value.find((g) => g.id === id)?.name ?? id,
    };

    /** Placements for the week and filters currently selected. Fetched per week. */
    const weekData = useAsyncData(
        `review-week-${generationId}`,
        () => {
            const query = new URLSearchParams({
                include: 'placements',
                termWeek: String(termWeek.value),
                ...(groupId.value ? { groupId: groupId.value } : {}),
                ...(roomId.value ? { roomId: roomId.value } : {}),
                ...(personId.value ? { personId: personId.value } : {}),
            });

            return request<ReviewPreview>(`/api/generations/${generationId}/preview?${query}`);
        },
        { watch: [termWeek, groupId, roomId, personId] },
    );

    const placements = computed(() => {
        const all = weekData.data.value?.placements ?? [];

        return changesOnly.value ? all.filter((p) => p.action !== 'unchanged') : all;
    });

    /**
     * TWO flags, not one.
     *
     * A single `applying` ref drove both actions, so discarding a proposal
     * relabelled the Apply button to "Applying…" and rendered "Writing
     * placements — a large proposal takes a few seconds." The two operations
     * mean opposite things; a reviewer watching the destructive-sounding message
     * during the safe action has been told something false about what the system
     * is doing.
     */
    const applying = ref(false);
    const discarding = ref(false);
    const busy = computed(() => applying.value || discarding.value);
    const actionError = ref<string | null>(null);

    /**
     * What just happened, once something has.
     *
     * `apply()` used to end in `navigateTo('/schedule')` — the highest-stakes
     * action in the product finishing as a silent screen change, with no
     * confirmation that it worked and no statement of what it did. The outcome
     * is held here instead, and the page stays put to say so: the proposal's own
     * status becomes APPLIED, which the screen already knows how to render.
     */
    const outcome = ref<{ action: 'applied' | 'discarded'; version: number } | null>(null);

    async function apply() {
        applying.value = true;
        actionError.value = null;

        try {
            // Materializing a thousand placements took ~2.7s in verification, so
            // this is a real wait rather than a formality.
            await request(`/api/generations/${generationId}/apply`, { method: 'POST', body: {} });

            outcome.value = { action: 'applied', version: preview.value?.generation.version ?? 0 };

            // Re-read rather than navigate: the row is now APPLIED, and the
            // reviewer should see that stated on the thing they just decided.
            await summary.refresh();
        } catch (e) {
            actionError.value = (e as { statusMessage?: string }).statusMessage
                ?? 'Could not apply this proposal. The schedule is unchanged.';
        } finally {
            applying.value = false;
        }
    }

    async function discard() {
        discarding.value = true;
        actionError.value = null;

        try {
            await request(`/api/generations/${generationId}/discard`, { method: 'POST', body: {} });

            outcome.value = { action: 'discarded', version: preview.value?.generation.version ?? 0 };
            await summary.refresh();
        } catch (e) {
            actionError.value = (e as { statusMessage?: string }).statusMessage
                ?? 'Could not discard this proposal. It is still awaiting a decision.';
        } finally {
            discarding.value = false;
        }
    }

    return {
        summary, preview, plan, term, grid, loadError, weekCount,
        offerings, rooms, people, groups, lookup,
        termWeek, groupId, roomId, personId, changesOnly,
        placements, weekPending: computed(() => weekData.pending.value),
        applying, discarding, busy, outcome, actionError, apply, discard,
        refresh: async () => {
            await summary.refresh();
            await weekData.refresh();
        },
        /** The page awaits this — the one await, at setup top level. */
        ready: summary,
    };
}
