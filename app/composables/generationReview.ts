import { statusCodeOf } from '~/composables/httpError';
import { weekCountOf } from '#shared/academicCalendar';
import type { NamedRow, TimeGrid } from '~/composables/schedule';

/**
 * Everything the review screen reads and decides with: one proposal under review,
 * the preview it is judged by, and the two actions that end it. It owns no live
 * schedule state — the point is that applying has not happened yet.
 *
 * SYNCHRONOUS, like every composable here that calls useAsyncData: an `await`
 * before the last Nuxt-context call detaches everything after it.
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
        /**
         * The subset of `moved` outside the run's scope. Optional because a
         * Generation captured before this counter existed has no value for it,
         * and 0 would be a claim rather than a gap — those runs were all hard
         * locked, so the honest reading is "the same as none", which `?? 0`
         * gives without pretending the field was stored.
         */
        movedCollateral?: number;
        unchanged: number;
        deleted: number;
        skippedLocked: number;
        placementsUnmapped: number;
    };
    deletedByOffering: { offeringId: string; title: string; code: string | null; count: number }[];
    /**
     * What the proposal does to each Offering over the whole term — the page's
     * primary evidence. Server-aggregated because `placements` is fetched one
     * `termWeek` at a time, so no client holds the term.
     */
    changesByOffering: {
        rows: OfferingChange[];
        /** Offerings the proposal reproduces exactly. A number, never a list. */
        untouchedOfferings: number;
    };
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

/** One Offering's whole-term change record. `title`/`code` are null when the
 *  caller cannot read that Offering — never the raw id, which is unreadable. */
export interface OfferingChange {
    offeringId: string;
    title: string | null;
    code: string | null;
    created: number;
    moved: number;
    unchanged: number;
    deleted: number;
    /** Term weeks this Offering changes in, ascending. Empty is impossible here. */
    weeks: number[];
    /**
     * The solver moved this Offering's Sessions without being asked to — the
     * per-Offering resolution of the plan's `movedCollateral` integer. Always
     * true for every moved Offering under a repair, where the scope is empty by
     * design and that is the mode working.
     */
    outOfScope: boolean;
}

/**
 * Termination reason as a sentence — the single field that most changes the
 * decision. `null` is its own case: runs captured before Stage 6a have no reason
 * recorded, and claiming reproducibility there would be a guess.
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
 * Why the preview could not be read. The primary fetch is the one thing here that
 * is NOT tolerant, so a rejection nulled `summary.data` and the template fell
 * through to "this proposal proposes nothing" — a 403, a 404, a dropped
 * connection and a genuine manual baseline all rendered the same false claim.
 */
export interface ReviewLoadError {
    kind: 'forbidden' | 'notFound' | 'failed';
    title: string;
    detail: string;
    /** Whether retrying could plausibly succeed. A 403 will not fix itself. */
    retryable: boolean;
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
                detail: 'Reviewing proposals needs the generation.read permission. '
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
 * How each diff state is named and drawn. Here rather than in a component because
 * BOTH presentations render it, and a chip labelled "Added" in one and "Created"
 * in the other is what makes two views of one dataset look like two datasets.
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
 * The grid encodes WHEN in `grid-column`/`grid-row`, which no assistive
 * technology reads — a moved chip said its action, offering, room and origin, and
 * never when it now is: the one fact a move consists of.
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
        /*
         * THE COLLATERAL SUBSET IS NAMED, not folded in. A minimize-movement
         * repair moves Sessions of Offerings the reviewer never selected — that
         * is the mode working, and it is the one thing about the plan they
         * cannot infer from "6 moved", which reads as six consequences of what
         * they asked for. Applying a repair that quietly reshuffles an untouched
         * cohort is the surprise warn-and-allow exists to prevent.
         *
         * Silent under an ordinary rebuild, where the count is always 0 because
         * out-of-scope Sessions are never returned at all.
         */
        const collateral = plan.movedCollateral ?? 0;

        clauses.push(collateral > 0
            ? `${plan.moved} moved, ${collateral} of them outside what you asked for`
            : `${plan.moved} moved`);
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
         * `offering.read` while this screen is gated on `generation.read` alone.
         * A page must only depend on what its own gate guarantees.
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
     * How many weeks the TERM has, not how many the proposal touches:
     * `weekSummary` carries only weeks that receive placements, so a proposal
     * pulling 258 sessions into weeks 1–5 of 13 left 6–13 unselectable —
     * precisely the weeks being emptied.
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

    /**
     * WHICH EVIDENCE LEADS. `list` is the term-wide change list, `grid` the week
     * the reviewer drilled into.
     *
     * Default `list`, and that is the redesign: the week grid was the primary
     * view, and a proposal moving 187 of 260 Sessions cannot be read one week at
     * a time — the grid answers "what is in week 4", never "what does this do".
     * It is now where you go once you know which Offering you are checking.
     */
    const view = ref<'list' | 'grid'>('list');

    /**
     * The Offering the reviewer drilled in on, or null for the whole week.
     *
     * Filtered on the CLIENT rather than adding an `offeringId` query param: the
     * week fetch already returns every placement in the week, so a round trip
     * would buy nothing, and the four server-side filters exist because they
     * change which rows the SERVER may reveal. This one only narrows what is
     * already on screen.
     */
    const offeringId = ref<string>('');

    const placements = computed(() => {
        const all = weekData.data.value?.placements ?? [];

        const scoped = offeringId.value
            ? all.filter((p) => p.offeringId === offeringId.value)
            : all;

        return changesOnly.value ? scoped.filter((p) => p.action !== 'unchanged') : scoped;
    });

    /**
     * Send the reviewer to one Offering's changes in the grid.
     *
     * Sets the week as well as the filter, because an Offering that changes in
     * weeks 6–8 is invisible from week 1 and "show in grid" that lands on an
     * empty grid teaches the reviewer the feature is broken.
     */
    function showInGrid(change: { offeringId: string; weeks: number[] }): void {
        offeringId.value = change.offeringId;

        const first = change.weeks[0];

        if (first !== undefined) {
            termWeek.value = first;
        }

        view.value = 'grid';
    }

    /**
     * TWO flags: a single `applying` ref relabelled Apply to "Applying…" and
     * showed "Writing placements" while DISCARDING, telling the reviewer
     * something false about what the system was doing.
     */
    const applying = ref(false);
    const discarding = ref(false);
    const busy = computed(() => applying.value || discarding.value);
    const actionError = ref<string | null>(null);

    /**
     * A THIRD flag, for the same reason as the two above.
     *
     * `refresh()` awaits `summary.refresh()` and then `weekData.refresh()` — two
     * sequential round trips — and reported nothing for their whole duration, so
     * the control the staleness notice actively tells the reviewer to press
     * ("over 2h ago — refresh before applying") looked inert when pressed.
     *
     * Deliberately NOT folded into `busy`: that gates Apply and Discard, and a
     * refresh must not disable the decision it exists to make safe.
     */
    const refreshing = ref(false);

    /**
     * `apply()` used to end in `navigateTo('/schedule')` — the highest-stakes
     * action in the product finishing as a silent screen change. The outcome is
     * held here and the page stays put to say so.
     */
    const outcome = ref<{ action: 'applied' | 'discarded'; version: number } | null>(null);

    /**
     * The server's message is used whenever there IS one: a 4xx means the request
     * was understood and refused, so "nothing happened" is true. Without one the
     * request may have been executed and only the answer lost, so claiming the
     * schedule is unchanged would be a guess presented as a fact.
     */
    function describeWriteFailure(error: unknown, verb: 'apply' | 'discard'): string {
        const stated = (error as { statusMessage?: string }).statusMessage;

        if (stated) {
            return stated;
        }

        return `Lost contact while trying to ${verb} this proposal, so it is not known `
            + 'whether it went through. Refresh before trying again.';
    }

    async function apply() {
        applying.value = true;
        actionError.value = null;

        try {
            // Materializing a thousand placements took ~2.7s in verification, so
            // this is a real wait rather than a formality.
            await request(`/api/generations/${generationId}/apply`, { method: 'POST', body: {} });

            outcome.value = { action: 'applied', version: preview.value?.generation.version ?? 0 };
        } catch (e) {
            actionError.value = describeWriteFailure(e, 'apply');
            applying.value = false;

            return;
        }

        /*
         * THE RE-READ IS NOT PART OF THE WRITE. Inside the same `try`, a refresh
         * that failed after a SUCCESSFUL apply was reported as "Could not apply
         * this proposal. The schedule is unchanged." — a flat falsehood at the
         * moment the reviewer most needs the truth.
         */
        try {
            await summary.refresh();
        } catch {
            actionError.value = 'Applied. The view could not be refreshed — reload to see it.';
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
        } catch (e) {
            actionError.value = describeWriteFailure(e, 'discard');
            discarding.value = false;

            return;
        }

        try {
            await summary.refresh();
        } catch {
            actionError.value = 'Discarded. The view could not be refreshed — reload to see it.';
        } finally {
            discarding.value = false;
        }
    }

    return {
        summary, preview, plan, term, grid, loadError, weekCount,
        offerings, rooms, people, groups, lookup,
        termWeek, groupId, roomId, personId, changesOnly, offeringId, view, showInGrid,
        placements, weekPending: computed(() => weekData.pending.value),
        applying, discarding, busy, refreshing, outcome, actionError, apply, discard,
        refresh: async () => {
            refreshing.value = true;

            // `finally` rather than a trailing assignment: the failure path here
            // already has a destination (the load-error branch), and a flag left
            // true would leave the control permanently disabled behind it.
            try {
                await summary.refresh();
                await weekData.refresh();
            } finally {
                refreshing.value = false;
            }
        },
        /** The page awaits this — the one await, at setup top level. */
        ready: summary,
    };
}
