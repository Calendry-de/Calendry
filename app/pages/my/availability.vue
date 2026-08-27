<template>
    <CommonPage title="My unavailability">
        <p class="intro">
            Days and blocks you cannot teach. What you submit here is
            <strong>reviewed by an administrator</strong> before it affects any timetable —
            declaring unavailability is a hard rule for the scheduler, so it is not
            applied on your say-so alone.
        </p>

        <!--
            The limitation, stated where the person is about to rely on it. The
            solver's LecturerVeto reads a Session's LECTURERS; a window recorded
            against somebody assigned to a Session in any other capacity is
            stored and honoured by nobody. Leaving that unsaid would be the UI
            implying coverage the scheduler does not have.
        -->
        <!--
            The prose is wrapped in ONE span deliberately. `.note` is a flex
            container, and flex makes every child its own flex item — including
            each bare text node either side of a `<strong>`. Unwrapped, this
            sentence laid out as three side-by-side columns at 390px (measured:
            4 flex items) and injected a 6px gap on both sides of every
            `<strong>` at 1440px, so "the  lecturer  of a session" rendered with
            a space before the following full stop. `preferences.vue` already
            wrapped its own note this way; this file did not.
        -->
        <p class="note">
            <Icon
                name="material-symbols:info-outline"
                aria-hidden="true"
            />
            <span>
                The scheduler applies this when you are the <strong>lecturer</strong> of a session.
                Sessions you are attached to in another capacity are not affected yet.
            </span>
        </p>

        <p
            v-if="!grid"
            class="note note--warn"
            role="alert"
        >
            This institution has no time grid configured, so blocks cannot be shown or
            checked. An administrator has to create one first.
        </p>

        <!--
            TWO MODES, SIDE BY SIDE AND NAMED, not one shape bent to express
            both. "I never teach Friday afternoons" and "I am away the week of
            the 14th" are different claims: one recurs for as long as it stands,
            the other has dates and ends. Expressing the second as the first
            means asking somebody to translate their holiday into week numbers,
            which is the arithmetic the machine is for.
        -->
        <!--
            A COMPLETE tablist, or none at all. These were two bare
            `<button type="button">` whose only difference was a CSS class:
            measured, the document carried zero `role="tab"`, zero
            `aria-selected`, zero `aria-pressed`, zero `aria-controls` and zero
            `tabindex`, so a screen reader announced two identical unlabelled
            buttons and could not report which mode was active — WCAG 4.1.2.

            Half-doing this is a documented trap in CLAUDE.md (a `role="tablist"`
            elsewhere shipped with no tabpanel and no `aria-controls`, which is
            worse than plain buttons because it promises semantics it lacks). So:
            roving tabindex, arrow/Home/End keys, and panels that name their tab.
        -->
        <div
            class="modes"
            role="tablist"
            aria-label="How to declare unavailability"
        >
            <button
                v-for="(entry, position) in MODES"
                :id="`mode-tab-${entry.id}`"
                :key="entry.id"
                :ref="(el) => registerTab(el, position)"
                class="modes_tab"
                :class="{ 'modes_tab--on': mode === entry.id }"
                type="button"
                role="tab"
                :aria-selected="mode === entry.id"
                :aria-controls="`mode-panel-${entry.id}`"
                :tabindex="mode === entry.id ? 0 : -1"
                @click="mode = entry.id"
                @keydown="onTabKey($event, position)"
            >
                <strong>{{ entry.title }}</strong>
                <span>{{ entry.hint }}</span>
            </button>
        </div>

        <section
            v-if="mode === 'holiday'"
            id="mode-panel-holiday"
            class="card"
            role="tabpanel"
            aria-labelledby="mode-tab-holiday"
            tabindex="0"
        >
            <h2>Away on specific dates</h2>

            <AvailabilityHolidayForm
                ref="holidayForm"
                :busy="busy"
                :error="holidayError"
                :terms="terms"
                @submit="submitHoliday"
            />
        </section>

        <section
            v-else
            id="mode-panel-recurring"
            class="card"
            role="tabpanel"
            aria-labelledby="mode-tab-recurring"
            tabindex="0"
        >
            <h2>Declare unavailability</h2>

            <!--
                THE SELECTION IS THE PREVIEW.
                
                This was two independent pickers — a list of days and a list of
                blocks — whose meaning was their cross product, computed in the
                reader's head, with an empty axis inverting to mean ALL of it. The
                grid states the same window as the shape it actually is.

                It also dissolves two problems rather than fixing them: a
                non-teaching day cannot be painted because it has no column, and
                a total blackout cannot be expressed because a rectangle is
                always at least one cell.
            -->
            <AvailabilityWeekPainter
                v-if="grid"
                ref="painter"
                v-model="draftRects"
                :grid="grid"
                :windows="vetoes"
                @select-window="onSelectWindow"
            />

            <label class="field">
                <span class="field_label">Reason (optional)</span>
                <input
                    v-model="draftReason"
                    class="field_input"
                    maxlength="500"
                    placeholder="Fixed commitment elsewhere"
                    type="text"
                >
            </label>

            <!--
                No hint of its own, deliberately. This said "Draw a selection on
                the week above to submit it." directly beneath the painter's own
                "choose one corner … then the opposite one" — two sentences for
                one instruction, which is how a message stops being read. The
                button now names the painter's status line instead, so the
                precondition is stated once and next to the thing it is about.
            -->

            <p
                v-if="formError"
                class="note note--error"
                role="alert"
            >{{ formError }}</p>

            <div class="actions">
                <!--
                    `aria-describedby` is what connects the disabled button to
                    the sentence explaining it. Without it the control is simply
                    inert with no announced reason — and the reason was in a
                    `<p>` with no role, so it was never announced at all.
                -->
                <CommonButton
                    :aria-describedby="draftRects.length ? undefined : 'painter-status'"
                    :disabled="busy || draftRects.length === 0"
                    type="primary"
                    @click="submit"
                >{{ submitLabel }}</CommonButton>
            </div>
        </section>

        <!--
            PRESENT IN THE DOM ALWAYS, populated on success — not inserted by
            `v-if`. A live region that appears at the same moment as its text is
            unreliable: assistive technology may never see the change, because
            the node was not there to be watched. Placed after the panels so it
            sits under the submit button of whichever mode is open.
        -->
        <p
            ref="noticeRef"
            class="notice"
            role="status"
            tabindex="-1"
        >{{ formNotice }}</p>

        <section class="card">
            <header class="card_head">
                <h2>What you have declared</h2>
                <span
                    v-if="blocked"
                    class="card_meter"
                >
                    {{ blocked.blocked }} of {{ blocked.total }} teaching slots blocked
                    <template v-if="blocked.weekScopedWindows">
                        ({{ blocked.weekScopedWindows }} week-specific
                        {{ blocked.weekScopedWindows === 1 ? 'entry' : 'entries' }} not counted)
                    </template>
                </span>
            </header>

            <p
                class="notice"
                role="status"
            >{{ listNotice }}</p>

            <p
                v-if="!vetoes.length"
                class="empty"
            >Nothing declared. The scheduler may place you at any time.</p>

            <ul
                v-else
                class="rows"
            >
                <li
                    v-for="row in vetoes"
                    :key="row.id"
                    :ref="(el) => registerRow(el, row.id)"
                    class="rows_row"
                    :class="{ 'rows_row--picked': selectedWindowId === row.id }"
                >
                    <!--
                        Status and description share ONE wrapping line rather
                        than two competing grid tracks. As `auto 1fr auto` the
                        status word sized its own track first: measured at
                        390px, "AWAITING REVIEW" claimed 95.8px of a 294px row
                        — 32.6% — while the description it labels got 110.6px
                        and wrapped a 38-character string onto three lines,
                        growing the row from 92px to 147px. The tracks also
                        differed per row (95.8 / 56.4 / 50.0px), so every row in
                        the list had a different content width, set by the
                        length of a workflow-state word.
                    -->
                    <span class="rows_head">
                        <span
                            class="rows_status"
                            :class="`rows_status--${row.status.toLowerCase()}`"
                        >{{ STATUS_LABEL[row.status] }}</span>

                        <span class="rows_what">{{ describeRow(row) }}</span>
                    </span>

                    <span
                        v-if="row.reason"
                        class="rows_reason"
                    >{{ row.reason }}</span>

                    <!--
                        The load-bearing sentence on this page. Without it a
                        pending row LOOKS like a blocked Friday, and the person
                        plans around something that is not in force.
                    -->
                    <span class="rows_effect">{{ EFFECT[row.status] }}</span>

                    <span
                        v-if="row.decisionNote"
                        class="rows_reason"
                    >Reviewer: {{ row.decisionNote }}</span>

                    <!--
                        When it was submitted, and when it was decided. Both were
                        already in the payload and neither was shown, so a row
                        that had been waiting a week looked exactly like one
                        submitted a minute ago.
                    -->
                    <span class="rows_when">
                        Submitted {{ formatDate(row.createdAt) }}<template
                            v-if="row.decidedAt"
                        > · decided {{ formatDate(row.decidedAt) }}</template>
                    </span>

                    <span
                        v-if="rowError[row.id]"
                        class="rows_fail"
                        role="alert"
                    >{{ rowError[row.id] }}</span>

                    <div
                        v-if="pendingRemoval === row.id"
                        class="rows_confirm"
                    >
                        <span class="rows_confirm-ask">
                            Remove this approved window? It stops applying immediately, and a
                            replacement has to be reviewed again.
                        </span>
                        <button
                            class="rows_remove rows_remove--danger"
                            :disabled="workingId === row.id"
                            type="button"
                            @click="requestRemove(row)"
                        >{{ workingId === row.id ? 'Removing…' : 'Remove anyway' }}</button>
                        <button
                            class="rows_remove"
                            type="button"
                            @click="cancelRemove"
                        >Keep</button>
                    </div>

                    <button
                        v-else
                        class="rows_remove"
                        :aria-label="`Remove: ${describeRow(row)}`"
                        :disabled="workingId === row.id"
                        type="button"
                        @click="requestRemove(row)"
                    >{{ workingId === row.id ? 'Removing…' : 'Remove' }}</button>
                </li>
            </ul>
        </section>
    </CommonPage>
</template>

<script setup lang="ts">
import type { BlockedSlotSummary, TermWindow } from '#shared/availability';
import type { TimeGrid } from '~/composables/schedule';
import AvailabilityHolidayForm from '~/components/availability/AvailabilityHolidayForm.vue';
import AvailabilityWeekPainter from '~/components/availability/AvailabilityWeekPainter.vue';
import { describeWindow } from '~/utils/availabilityLabels';
import { formatDate } from '~/utils/formatDate';

definePageMeta({ middleware: 'my' });

useHead({ title: 'My unavailability' });

interface VetoRow {
    id: string;
    days: number[];
    blocks: number[];
    weeks: number[];
    termId: string | null;
    term: { name: string } | null;
    reason: string | null;
    status: 'PENDING' | 'APPROVED' | 'REJECTED';
    decisionNote: string | null;
    /*
     * Both already travelled in the response and neither was rendered, so a
     * pending row could not say how long it had waited and a decided one could
     * not say when it was decided. The wait is the state a lecturer spends the
     * most time in; it was the one with no information in it.
     */
    createdAt: string;
    decidedAt: string | null;
}

interface Payload {
    personId: string;
    grid: TimeGrid | null;
    terms: TermWindow[];
    vetoes: VetoRow[];
    blocked: BlockedSlotSummary | null;
}

const STATUS_LABEL: Record<VetoRow['status'], string> = {
    PENDING: 'Awaiting review',
    APPROVED: 'Approved',
    REJECTED: 'Rejected',
};

/**
 * What each status MEANS for the timetable, spelled out per row.
 *
 * A badge alone is not enough. "Pending" next to "every Friday" reads as a
 * blocked Friday to anybody who is not thinking about workflow states, and the
 * whole cost of the approval step lands on the person who then discovers they
 * were scheduled anyway.
 */
const EFFECT: Record<VetoRow['status'], string> = {
    PENDING: 'Not yet in effect — the scheduler can still place you here.',
    APPROVED: 'In effect from the next schedule run.',
    REJECTED: 'Not in effect. Remove it, or talk to an administrator.',
};

/*
 * `useRequestFetch`, not `$fetch`: on the server a bare fetch carries no cookie
 * and 401s into an empty page that looks exactly like having declared nothing.
 */
const request = useRequestFetch();

const { data, refresh } = await useAsyncData(
    'my:availability',
    () => request<Payload>('/api/me/availability'),
);

const grid = computed(() => data.value?.grid ?? null);
const terms = computed(() => data.value?.terms ?? []);

type Mode = 'recurring' | 'holiday';

/** The two tabs, as data, so markup and keyboard order cannot disagree. */
const MODES: readonly { id: Mode; title: string; hint: string }[] = [
    { id: 'recurring', title: 'Every week', hint: 'Days or blocks you never teach' },
    { id: 'holiday', title: 'Specific dates', hint: 'Holiday or another absence' },
] as const;

/** Which entry mode the form is showing. Not persisted — it is a question, not a setting. */
const mode = ref<Mode>('recurring');

const tabRefs = ref<(HTMLElement | null)[]>([]);

function registerTab(el: unknown, position: number) {
    tabRefs.value[position] = (el as HTMLElement | null) ?? null;
}

/**
 * Arrow keys move between tabs, which is what `role="tablist"` promises — the
 * roving `tabindex` means Tab enters the strip once and then leaves it, so
 * without this the second tab would be unreachable by keyboard entirely.
 * Selection follows focus, the expected behaviour when switching panels is
 * cheap and reversible.
 */
function onTabKey(event: KeyboardEvent, position: number) {
    const last = MODES.length - 1;
    let next: number | null = null;

    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        next = position === last ? 0 : position + 1;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        next = position === 0 ? last : position - 1;
    } else if (event.key === 'Home') {
        next = 0;
    } else if (event.key === 'End') {
        next = last;
    }

    if (next === null) return;

    event.preventDefault();
    mode.value = MODES[next]!.id;
    tabRefs.value[next]?.focus();
}
const holidayForm = ref<{ reset: () => void } | null>(null);
const vetoes = computed(() => data.value?.vetoes ?? []);
const blocked = computed(() => data.value?.blocked ?? null);

/**
 * The rectangles drawn on the week, each of which becomes one window.
 *
 * Replaces `draftDays` and `draftBlocks`. Those were two independent lists whose
 * meaning was their cross product; these are the products themselves, so there
 * is no arithmetic between what the person sees and what gets stored — and the
 * wire format is untouched, because a rectangle IS `days[] × blocks[]`.
 *
 * A LIST, because a real week is rarely one rectangle: "Friday afternoons and
 * Monday first thing" is two, and each is separately submitted, reviewed and
 * approved. One window per rectangle keeps that visible instead of pretending
 * an irregular shape is a single claim.
 */
const draftRects = ref<{ days: number[]; blocks: number[] }[]>([]);
const draftReason = ref('');
const painter = ref<{ clear: () => void } | null>(null);
const busy = ref(false);

/*
 * THREE error channels, not one.
 *
 * A single `error` ref served the recurring form, the holiday form and row
 * removal, and was rendered inside the recurring card — so a failed Remove
 * reported itself hundreds of pixels from the button pressed, and a holiday
 * error stayed on screen after switching modes. An error has to appear where
 * the action was.
 */
const formError = ref('');
const holidayError = ref('');
const rowError = ref<Record<string, string>>({});

/** Announced on success. Present in the DOM always; see the live regions in the template. */
const formNotice = ref('');
const listNotice = ref('');

/** Which row is mid-request, so only its own button goes quiet. */
const workingId = ref<string | null>(null);

const noticeRef = ref<HTMLElement | null>(null);

/**
 * Move to the confirmation after a successful submit.
 *
 * The live region announces on its own; this is for everyone else — the new row
 * lands in a section that can be below the fold, so without it the only evidence
 * of success is off screen. `tabindex="-1"` makes a non-interactive element
 * focusable programmatically without adding it to the tab order.
 */
async function announce() {
    await nextTick();
    noticeRef.value?.focus();
    noticeRef.value?.scrollIntoView({ block: 'nearest' });
}

/** An approved window waiting for a second click before it is destroyed. */
const pendingRemoval = ref<string | null>(null);

/**
 * Which existing window the grid is pointing at, so the list below can answer.
 *
 * The grid shows every standing window as its own region; pressing one offers
 * that window rather than starting a new rectangle, because windows are
 * immutable and there is no partial edit to imply.
 */
const selectedWindowId = ref<string | null>(null);
const rowNodes = new Map<string, HTMLElement>();

function registerRow(el: unknown, id: string) {
    const node = el as HTMLElement | null;

    if (node) {
        rowNodes.set(id, node);
    } else {
        rowNodes.delete(id);
    }
}

function onSelectWindow(id: string) {
    selectedWindowId.value = id;

    // The list can be below the fold on a tall grid, so the answer to "what did
    // I just press" is brought into view rather than left to be hunted for.
    void nextTick(() => rowNodes.get(id)?.scrollIntoView({ block: 'nearest' }));
}

/** Names what pressing it will actually send, since it may be several windows. */
const submitLabel = computed(() => {
    if (busy.value) return 'Submitting…';

    const count = draftRects.value.length;

    return count > 1 ? `Submit ${count} entries for approval` : 'Submit for approval';
});

/**
 * One POST per rectangle, because one rectangle is one window.
 *
 * Sent sequentially rather than in parallel: they land in a human review queue,
 * and a predictable order there is worth more than a few milliseconds. Each
 * success is removed from the draft as it goes, so a failure part-way through
 * leaves EXACTLY the un-sent rectangles on the grid — the retry is pressing the
 * button again, with nothing silently lost and nothing sent twice.
 */
async function submit() {
    busy.value = true;
    formError.value = '';
    formNotice.value = '';

    const queued = [...draftRects.value];
    const failed: typeof queued = [];
    let sent = 0;

    for (const rect of queued) {
        try {
            await request('/api/me/availability/vetoes', {
                method: 'POST',
                body: {
                    days: rect.days,
                    blocks: rect.blocks,
                    weeks: [],
                    reason: draftReason.value.trim() || null,
                },
            });
            sent += 1;
        } catch (cause) {
            failed.push(rect);
            formError.value = (cause as { statusMessage?: string }).statusMessage
                ?? 'Could not submit that.';
        }
    }

    draftRects.value = failed;

    if (failed.length === 0) {
        painter.value?.clear();
        draftReason.value = '';
    }

    await refresh();

    if (sent > 0) {
        const what = sent === 1 ? 'Entry' : `${sent} entries`;

        formNotice.value = failed.length === 0
            ? `${what} submitted for approval. Nothing is blocked until an administrator approves it.`
            // The count is stated because the grid still shows the remainder,
            // and "some of it worked" is the one outcome a person must not guess.
            : `${what} submitted. ${failed.length} still on the grid — press again to retry.`;
    }

    await announce();
    busy.value = false;
}

/**
 * A holiday row reads as its dates, not as "every day, all day".
 *
 * `describeWindow` renders the wire's own emptiness convention faithfully — an
 * empty `days` IS every day — which is right for a recurring window and useless
 * for a holiday, where the empty axes are an implementation detail of blocking
 * whole weeks. Naming the term and weeks is what the person actually entered.
 */
function describeRow(row: VetoRow): string {
    if (row.weeks.length === 0) {
        return describeWindow(row, grid.value);
    }

    const label = row.term?.name ?? 'term';
    const weeks = row.weeks.map((week) => week + 1).join(', ');

    return `${label}: week${row.weeks.length === 1 ? '' : 's'} ${weeks} — away all day`;
}

async function submitHoliday(payload: { startDate: string; endDate: string; reason: string | null }) {
    busy.value = true;
    holidayError.value = '';
    formNotice.value = '';

    try {
        await request('/api/me/availability/holidays', { method: 'POST', body: payload });

        holidayForm.value?.reset();
        await refresh();
        formNotice.value = 'Submitted for approval. Nothing is blocked until an administrator approves it.';
        await announce();
    } catch (cause) {
        holidayError.value = (cause as { statusMessage?: string }).statusMessage ?? 'Could not submit that.';
    } finally {
        busy.value = false;
    }
}

/**
 * First click on an APPROVED row asks; the second destroys.
 *
 * Removing an approved window discards a decision a human made and cannot be
 * undone from the UI — rows are immutable by design, so the only route back is
 * re-typing it and re-joining the queue. The server will never object, because
 * relaxing a constraint needs no approval; that asymmetry is exactly why the
 * cost has to be visible on the client.
 *
 * Two-step in place rather than a modal: this needs neither interruption nor
 * protected focus, and the question belongs on the row it is about. PENDING and
 * REJECTED rows remove on the first click — nothing is in force to lose.
 */
function requestRemove(row: VetoRow) {
    if (row.status === 'APPROVED' && pendingRemoval.value !== row.id) {
        pendingRemoval.value = row.id;

        return;
    }

    void remove(row);
}

function cancelRemove() {
    pendingRemoval.value = null;
}

async function remove(row: VetoRow) {
    workingId.value = row.id;
    rowError.value = { ...rowError.value, [row.id]: '' };
    listNotice.value = '';

    try {
        await request(`/api/me/availability/vetoes/${row.id}`, { method: 'DELETE' });
        pendingRemoval.value = null;
        await refresh();
        listNotice.value = `Removed: ${describeRow(row)}.`;
    } catch (cause) {
        rowError.value = {
            ...rowError.value,
            [row.id]: (cause as { statusMessage?: string }).statusMessage ?? 'Could not remove that.',
        };
    } finally {
        workingId.value = null;
    }
}
</script>

<style scoped lang="scss">
/*
 * Prose is capped at 68ch — the measure this repo already uses
 * (`ManageConstraintGrid`, `LandingRoadmapList`, `LandingPrincipleList`).
 * Uncapped, `.intro` measured 1278px at 1440px, about 205 characters per line
 * against a 45–75 target, because nothing in the section bounded anything.
 */
.intro,
.note,
.empty {
    max-width: 68ch;
    margin: 0;

    font-size: var(--font-size-sm);
    line-height: 1.6;
    color: $content7;
}

.note {
    display: flex;
    gap: var(--space-3);
    align-items: flex-start;

    /*
     * `.iconify`, not `svg`. `Icon` renders an Iconify **span**, so the old
     * `svg` rule matched nothing — verified in the served HTML — which left the
     * glyph at `flex: 0 1 auto` and therefore shrinkable. At 390px it collapsed
     * to a dot beside the text.
     */
    > .iconify {
        flex: none;
        width: 16px;
        height: 16px;
    }

    &--warn {
        // `$warning800`: `warning700` measured 3.73:1 here, below AA at every
        // size this renders. See the token's own note in `utils/styles.ts`.
        color: $warning800;
    }

    &--error {
        font-weight: 600;
        color: $error700;
    }
}

/*
 * A GRID that fills, not a flex line that could not.
 *
 * `flex: 1 1 200px` was inert at every width tested: the container was itself
 * shrink-wrapped by `CommonPage`'s old `align-items: center`, so the flex line
 * never had free space to distribute and both tabs measured 401.8px at 390px
 * AND at 1440px — stacked vertically even on a 1440px display, reading as a
 * list rather than a choice between two things. `auto-fit` + `minmax` states
 * the intent structurally: two abreast whenever ~220px each will fit, one
 * column below that.
 */
.modes {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: var(--space-3);
    max-width: 620px;

    &_tab {
        cursor: pointer;

        display: flex;
        flex-direction: column;
        gap: var(--space-1);

        padding: var(--space-4) var(--space-5);
        // Same reasoning as the text inputs: the tab's ground is 1.04:1 from
        // the card's, so the border is its only identifying edge.
        border: 1px solid $content7;
        border-radius: var(--radius-lg);

        font-family: inherit;
        text-align: left;

        background: $surface0;

        strong {
            font-size: var(--font-size-md);
            color: $content2;
        }

        span {
            font-size: var(--font-size-sm);
            color: $content7;
        }

        &--on {
            border-color: $primary500;
            background: $surface2;
        }
    }
}

/*
 * The form column is capped at 620px, matching `ManageEntityForm` and
 * `ManageRelationsPanel`. Two sibling cards on this page previously measured
 * 1085.5px and 382.7px — 703px apart — because each sized to its own content.
 *
 * Rhythm is three-step and deliberate, replacing one repeated value:
 * `--space-1/2` inside a control, `--space-5` between fields, `--space-7`
 * between sections (the page-level gap). With the section gap plus this card's
 * `--space-6` padding above a heading and `--space-5` below it, there is more
 * space above each heading than below — the grouping is carried by proximity
 * rather than by the container, which is just as well: `.card`'s `$surface1` is
 * the body's own ground, so it currently draws nothing at all. That is a colour
 * decision and belongs to a colour pass, not to this one.
 */
.card {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);

    /*
     * NO GROUND, and that is the resolution rather than a compromise.
     *
     * This carried `background: $surface1` on a page ground that is also
     * `$surface1` — 1.00:1, measured, in both themes — so the fill and the
     * radius drew literally nothing. No adjacent surface step can fix it
     * either: `surface0` is 1.04:1 from the ground and `surface2` is 1.05:1, so
     * a visible card is simply not available in this palette.
     *
     * Rather than leave a fill that lies, the grouping is carried by what
     * actually works here: the section rhythm and the heading. Restore a fill
     * only alongside a palette that has a real raised surface to spend.
     */
    max-width: 620px;

    /*
     * Vertical inset only. `$surface1` is the body's own ground, so this box
     * draws nothing (measured 1.00:1) — and a horizontal padding on an
     * invisible container is just an unexplained 16px indent: it put this
     * card's content at x=288 while the page's own prose sat at x=272. The
     * section is grouped by rhythm instead. Restore the horizontal inset in the
     * same change that gives the card a real ground, not before; note that the
     * palette's adjacent surface steps measure ~1.09:1 and its strongest
     * hairline 1.20:1, so "visible card" is a colour-system decision, not a
     * token swap.
     */
    padding: var(--space-6) 0;

    h2 {
        margin: 0;
        font-size: var(--font-size-md);
        font-weight: 680;
        color: $content2;
    }

    &_head {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-3);
        align-items: baseline;
        justify-content: space-between;
    }

    &_meter {
        font-size: var(--font-size-sm);
        font-variant-numeric: tabular-nums;
        color: $content7;
    }
}

.field {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);

    &_label {
        font-size: var(--font-size-sm);
        font-weight: 650;
        color: $content4;
    }

    &_input {
        width: 100%;
        // `10px` was off the scale, sitting beside a token in the same
        // declaration; `--space-5` is 12px and takes the field to a 44px box.
        padding: var(--space-5);
        // `$content7`, not a surface step. The ENTIRE surface ramp fails WCAG 1.4.11
        // against `surface0` in both themes — measured, best case 2.38:1 — and this
        // border is the only thing identifying the control, because its ground sits
        // 1.04:1 from the card's. The content ramp is the lightest place a
        // compliant boundary exists: 7.28:1 light, 8.00:1 dark.
        border: 1px solid $content7;
        border-radius: var(--radius-lg);

        font-family: inherit;
        font-size: var(--font-size-md);
        color: $content3;

        background: $surface0;

        /*
         * No `outline: none`. That declaration beat the repo's own global
         * `:focus-visible` ring (`layout.scss`, measured 4.51:1) on specificity
         * and replaced it with a 1px border change at 2.45:1 — and fired on
         * mouse click too, being `:focus` rather than `:focus-visible`. The
         * global ring is correct; this only tints the border alongside it.
         */
        &:focus-visible {
            border-color: $primary600;
        }
    }
}

.actions {
    display: flex;
    gap: var(--space-3);
}

/*
 * A live region with nothing to say must occupy no space, but must stay in the
 * DOM — hence `:empty`, not `v-if`. Also drops the focus ring's own outline
 * offset onto something that is not a control.
 */
.notice {
    max-width: 68ch;
    margin: 0;

    font-size: var(--font-size-sm);
    line-height: 1.6;
    color: $success700;

    &:empty {
        display: none;
    }

    &:focus-visible {
        outline: 2px solid $primary600;
        outline-offset: var(--space-1);
    }
}

.rows {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);

    margin: 0;
    padding: 0;

    list-style: none;

    /*
     * TWO columns — content and the row's action — not three.
     *
     * `minmax(0, 1fr)` is load-bearing: a bare `1fr` is `minmax(auto, 1fr)`,
     * whose auto minimum refuses to shrink below the longest unbreakable word,
     * which is how a long description used to push the row wider than its
     * container. The status badge no longer owns a track at all; it shares a
     * wrapping line with the description inside column one.
     */
    &_row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: var(--space-3) var(--space-4);

        padding: var(--space-4);
        border-radius: var(--radius-lg);

        background: $surface0;

        // The window the grid is pointing at. A hairline, not a fill: the row
        // already carries three status colours and a fourth would compete.
        &--picked {
            outline: 2px solid $content4;
            outline-offset: 2px;
        }

        /*
         * A raw query, and the only one in the app — deliberately not
         * `mobileOnly()`. The repo's mixins are PAGE breakpoints (699px and
         * 1365px); this is a component reflow threshold, and the two do not
         * coincide because the card caps at 620px. At a 699px viewport this row
         * still has ~540px for content beside a 56px button, so stacking there
         * would give up a working two-column layout for 200px of viewport.
         * Below ~480px it genuinely stops fitting. Single column moves the
         * action to its own line at the end, which is also its DOM position, so
         * visual and focus order agree.
         */
        @media (width <= 480px) {
            grid-template-columns: minmax(0, 1fr);
        }
    }

    &_head {
        display: flex;
        grid-column: 1;
        flex-wrap: wrap;
        gap: var(--space-2) var(--space-3);
        align-items: baseline;

        min-width: 0;
    }

    &_status {
        font-size: var(--font-size-xs);
        font-weight: 700;
        text-transform: uppercase;
        // The label register this repo commits to is uppercase 11px with
        // `0.05em` tracking. This was the only uppercase label in the app
        // carrying the case and the size but not the tracking.
        letter-spacing: 0.05em;
        white-space: nowrap;

        &--pending {
            // The one status whose message is time-critical was the least
            // legible of the three: 3.89:1 at 11px bold uppercase.
            color: $warning800;
        }

        &--approved {
            color: $success700;
        }

        &--rejected {
            color: $error700;
        }
    }

    &_what {
        // Clock times live in this string, so it takes the tabular figures the
        // rest of the section already uses for times and counts.
        font-size: var(--font-size-md);
        font-variant-numeric: tabular-nums;
        color: $content3;
    }

    &_effect,
    &_reason {
        grid-column: 1;
        max-width: 68ch;
        font-size: var(--font-size-sm);
        color: $content7;
    }

    &_when {
        grid-column: 1;
        font-size: var(--font-size-xs);
        font-variant-numeric: tabular-nums;
        color: $surface7;
    }

    &_fail {
        grid-column: 1;
        font-size: var(--font-size-sm);
        font-weight: 600;
        color: $error700;
    }

    /*
     * The confirm replaces the button in place, on the row it is about. A modal
     * would interrupt and protect focus, neither of which this needs.
     */
    &_confirm {
        display: flex;
        grid-column: 1 / -1;
        flex-wrap: wrap;
        gap: var(--space-3);
        align-items: center;

        &-ask {
            flex: 1 1 100%;

            max-width: 68ch;

            font-size: var(--font-size-sm);
            font-weight: 600;
            color: $content4;
        }
    }

    &_remove {
        cursor: pointer;

        grid-area: 1 / 2;
        align-self: start;

        // Was `--space-1 --space-3`, a 21px box: the only destructive control
        // in the section and the smallest target in it, under the 24px WCAG
        // 2.5.8 minimum. `--space-3` vertical takes it to 25px.
        padding: var(--space-3);
        // The only destructive control here, and its 1.25:1 boundary was the
        // only thing marking it as a control at all.
        border: 1px solid $content7;
        border-radius: var(--radius-md);

        font-family: inherit;
        font-size: var(--font-size-xs);
        color: $content4;

        background: $surface1;

        &:hover {
            border-color: $error700;
            color: $error700;
        }

        @media (width <= 480px) {
            grid-area: auto / 1;
            justify-self: start;
        }
    }
}
</style>
