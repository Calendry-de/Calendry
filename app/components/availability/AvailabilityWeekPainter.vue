<template>
    <div class="painter">
        <div
            class="painter_grid"
            role="grid"
            :aria-label="`Teaching week — ${gridLabel}`"
            aria-multiselectable="true"
            :style="geometry.cssVars.value"
            @pointerleave="onPointerLeave"
        >
            <!--
                `display: contents` on the rows: `role="grid"` needs row children,
                and the cells have to be placed on the OUTER grid's lines so the
                time gutter and the day columns cannot drift apart. `contents`
                gives the semantics without generating a box that would break
                that placement.
            -->
            <div
                class="painter_row painter_row--head"
                role="row"
            >
                <span
                    class="painter_corner"
                    role="columnheader"
                    :style="{ gridRow: 1, gridColumn: 1 }"
                ><span class="painter_sr">Time</span></span>
                <span
                    v-for="day in grid.activeDays"
                    :key="day"
                    class="painter_day"
                    role="columnheader"
                    :style="{ gridRow: 1, gridColumn: columnOf(day) }"
                >
                    {{ weekdayShort(day) }}
                    <span
                        v-if="geometry.dayDiffers(day)"
                        class="painter_own"
                        title="This day's blocks run to their own break times."
                    >own breaks</span>
                </span>
            </div>

            <div
                v-for="row in geometry.rows.value"
                :key="`${row.kind}-${row.line}`"
                class="painter_row"
                role="row"
            >
                <span
                    class="painter_time"
                    :class="{ 'painter_time--quiet': !geometry.labelledLines.value.has(row.line) }"
                    role="rowheader"
                    :style="{ gridRow: row.line, gridColumn: 1 }"
                >
                    <template v-if="row.kind === 'block' && geometry.labelledLines.value.has(row.line)">
                        {{ row.start }}
                    </template>
                    <span
                        v-else-if="row.kind === 'gap'"
                        class="painter_break"
                    >{{ row.label ?? 'Break' }}</span>
                </span>

                <!--
                    A GAP IS NOT A BLOCK. Break rows render as an unpaintable
                    band: `reference_slot` has no index for them, so a cell there
                    could not be stored, and offering one would be an affordance
                    that silently does nothing.
                -->
                <template v-if="row.kind === 'gap'">
                    <span
                        v-for="day in grid.activeDays"
                        :key="`gap-${day}`"
                        class="painter_gap"
                        role="gridcell"
                        :style="{ gridRow: row.line, gridColumn: columnOf(day) }"
                    />
                </template>

                <template v-else>
                    <button
                        v-for="day in grid.activeDays"
                        :key="`${day}-${row.index}`"
                        :ref="(el) => registerCell(el, day, row.index)"
                        class="painter_cell"
                        :class="cellClass(day, row.index)"
                        type="button"
                        role="gridcell"
                        :aria-label="cellLabel(day, row.index)"
                        :aria-selected="inDraft(day, row.index)"
                        :disabled="readonly"
                        :tabindex="isCursor(day, row.index) ? 0 : -1"
                        :style="{ gridRow: row.line, gridColumn: columnOf(day) }"
                        @pointerdown.prevent="onPointerDown(day, row.index)"
                        @pointerenter="onPointerEnter(day, row.index)"
                        @pointerup="onPointerUp(day, row.index)"
                        @focus="cursor = { day, block: row.index }"
                        @keydown="onKey($event, day, row.index)"
                    />
                </template>
            </div>
        </div>

        <!--
            THE FOCAL MOMENT: the consequence, live, in the same sentence the
            page's own meter uses. The two-axis form it replaces could state a
            days list and a blocks list but never their product, which is the one
            number that says what a submission actually costs.
        -->
        <p
            id="painter-status"
            class="painter_says"
            role="status"
        >{{ says }}</p>
    </div>
</template>

<script setup lang="ts">
import { blockedSlotSummary } from '#shared/availability';
import type { TimeGrid } from '~/composables/schedule';
import { blockTime, weekdayName, weekdayShort } from '~/composables/schedule';
import { useGridGeometry } from '~/composables/gridGeometry';

/**
 * Paint one unavailability window onto the tenant's own teaching week.
 *
 * WHY A RECTANGLE AND NOT FREE CELLS. `UnavailabilityWindow` is
 * `{ days[], blocks[], weeks[] }` — the proto message verbatim — and that is a
 * CROSS PRODUCT, not a set of cells. "Monday block 1 and Friday block 8" is not
 * one window; as `days:[1,5] × blocks:[1,8]` it is four cells. So the gesture is
 * a rectangle, because the model is a rectangle: what you drag is exactly what
 * gets stored, and a non-rectangular need is two visible gestures producing two
 * visible rows in the approval queue rather than a silent decomposition.
 *
 * WHY NOT `ScheduleGrid`. That component takes sessions, violations, placement
 * and swap modes, room/person resolvers and display settings — none of which
 * exist here. What the two share is `useGridGeometry`, and sharing it is the
 * point: it is what stops this grid and the schedule disagreeing about where
 * 09:45 is, breaks included.
 *
 * The status line carries a FIXED id so the page's submit button can name it as
 * its own description. Safe because the painter is single-instance per page —
 * one week, one selection — and it means the precondition for submitting is
 * stated once, beside the grid, rather than repeated under the form.
 *
 * THE ACCENT IS DELIBERATELY ABSENT. DESIGN.md spends `$primary` on one idea,
 * "where a session may land". Unavailability is its inverse, so a painted region
 * reads as a hatched negative and never borrows that signal.
 */
const props = withDefaults(defineProps<{
    grid: TimeGrid;
    /** Existing recurring windows, so the grid shows what already stands. */
    windows?: PaintedWindow[];
    readonly?: boolean;
}>(), {
    windows: () => [],
    readonly: false,
});

interface PaintedWindow {
    id: string;
    days: number[];
    blocks: number[];
    status: 'PENDING' | 'APPROVED' | 'REJECTED';
}

interface Rect { days: number[]; blocks: number[] }

/**
 * EVERY rectangle drawn so far, not one.
 *
 * A window is a cross product, so one rectangle is one window — but a person's
 * real week is rarely one rectangle. "Friday afternoons and Monday first thing"
 * is two, and the first version of this held a single draft, so a second drag
 * silently replaced the first and only one could ever be submitted.
 *
 * Accumulating them keeps the rectangle-to-window identity intact — each entry
 * still maps to exactly one stored window and one row in the approval queue —
 * while letting the gesture be repeated as often as the week needs.
 */
const draft = defineModel<Rect[]>({ required: true });

const emit = defineEmits<{ selectWindow: [id: string] }>();

const gridRef = computed(() => props.grid);
const rowHeight = ref(44);
const geometry = useGridGeometry(gridRef, rowHeight);

const gridLabel = computed(() => (
    `${props.grid.activeDays.length} teaching days, ${props.grid.blocksPerDay} blocks`
));

/** Column 1 is the time gutter, so the first teaching day is column 2. */
const columnOf = (day: number) => props.grid.activeDays.indexOf(day) + 2;

/* ---------------------------------------------------------------- selection */

interface Cell { day: number; block: number }

/** Where the keyboard cursor is, and the only cell carrying `tabindex="0"`. */
const cursor = ref<Cell>({ day: props.grid.activeDays[0] ?? 1, block: 0 });

/** First corner of the rectangle being drawn; held between the two taps. */
const anchor = ref<Cell | null>(null);
const dragging = ref(false);

/**
 * The rectangle currently under the pointer, before it is let go.
 *
 * Held apart from `draft` so a drag in progress can be redrawn on every
 * pointermove without churning the committed list — and so abandoning it leaves
 * the earlier rectangles untouched.
 */
const live = ref<Rect | null>(null);
const cells = new Map<string, HTMLElement>();

const key = (day: number, block: number) => `${day}:${block}`;

function registerCell(el: unknown, day: number, block: number) {
    const node = el as HTMLElement | null;

    if (node) {
        cells.set(key(day, block), node);
    } else {
        cells.delete(key(day, block));
    }
}

const isCursor = (day: number, block: number) => cursor.value.day === day && cursor.value.block === block;

/** Every cell between two corners, as the axis lists the model stores. */
function rectangle(a: Cell, b: Cell): Rect {
    const order = props.grid.activeDays;
    const from = order.indexOf(a.day);
    const to = order.indexOf(b.day);

    return {
        days: order.slice(Math.min(from, to), Math.max(from, to) + 1),
        blocks: Array.from(
            { length: Math.abs(a.block - b.block) + 1 },
            (_, offset) => Math.min(a.block, b.block) + offset,
        ),
    };
}

const covers = (rect: Rect, day: number, block: number) => (
    rect.days.includes(day) && rect.blocks.includes(block)
);

function inDraft(day: number, block: number): boolean {
    return Boolean(live.value && covers(live.value, day, block))
        || draft.value.some((rect) => covers(rect, day, block));
}

/** Which committed rectangle holds this cell, so a press can take it back off. */
const draftIndexAt = (day: number, block: number) => (
    draft.value.findIndex((rect) => covers(rect, day, block))
);

/** Extend the live rectangle to this corner without committing to it. */
function extendTo(day: number, block: number) {
    if (!anchor.value) return;

    live.value = rectangle(anchor.value, { day, block });
}

function begin(day: number, block: number) {
    anchor.value = { day, block };
    live.value = rectangle(anchor.value, anchor.value);
}

/** Second corner chosen: the rectangle joins the list and the next press starts a new one. */
function settle() {
    if (live.value) {
        draft.value = [...draft.value, live.value];
    }

    live.value = null;
    anchor.value = null;
    dragging.value = false;
}

/** Take one rectangle back off, so a mis-drawn selection is correctable in place. */
function removeAt(index: number) {
    draft.value = draft.value.filter((_, at) => at !== index);
}

function clear() {
    anchor.value = null;
    dragging.value = false;
    live.value = null;
    draft.value = [];
}

defineExpose({ clear });

/* ------------------------------------------------------------------ pointer */

/*
 * ONE model for mouse, trackpad and touch: press anchors, movement extends,
 * release settles — and a press-and-release WITHOUT movement leaves the anchor
 * standing so a second tap picks the far corner. Drag alone would be unusable on
 * a phone, where a drag across cells is the scroll gesture.
 */
function onPointerDown(day: number, block: number) {
    if (props.readonly) return;

    cursor.value = { day, block };

    if (anchor.value) {
        extendTo(day, block);
        settle();

        return;
    }

    /*
     * A press inside a rectangle you just drew REMOVES it. Correction has to be
     * as cheap as selection, or a mis-drawn shape can only be fixed by clearing
     * everything and starting again.
     */
    const mine = draftIndexAt(day, block);

    if (mine !== -1) {
        removeAt(mine);

        return;
    }

    /*
     * A press on a cell an existing window already governs OFFERS THAT WINDOW
     * rather than starting a new one. Windows are immutable, so there is no
     * partial edit to imply: the page reveals the window's status and its
     * Remove. Emitted on a deliberate press only — hanging this off the cursor
     * would fire it on every arrow keypress.
     */
    const held = coverage.value.get(key(day, block));

    if (held) {
        emit('selectWindow', held.id);

        return;
    }

    dragging.value = true;
    begin(day, block);
}

function onPointerEnter(day: number, block: number) {
    if (dragging.value) {
        extendTo(day, block);
    }
}

function onPointerUp(day: number, block: number) {
    if (!dragging.value || !anchor.value) return;

    // A release on the anchor itself is a tap, not a drag: keep the anchor and
    // wait for the second corner rather than committing a one-cell window.
    if (anchor.value.day === day && anchor.value.block === block) {
        dragging.value = false;

        return;
    }

    extendTo(day, block);
    settle();
}

/** A drag that leaves the grid settles where it left, rather than hanging. */
function onPointerLeave() {
    if (dragging.value) {
        settle();
    }
}

/* ----------------------------------------------------------------- keyboard */

/*
 * A drag-only painter would be unusable by keyboard — the failure this section
 * just had fixed. Arrows move, Space anchors and then settles, Enter settles,
 * Escape abandons. `role="grid"` is what makes one tab stop plus arrows the
 * expected contract rather than a surprise.
 */
function onKey(event: KeyboardEvent, day: number, block: number) {
    const days = props.grid.activeDays;
    const column = days.indexOf(day);
    let next: Cell | null = null;

    switch (event.key) {
        case 'ArrowRight':
            next = { day: days[Math.min(days.length - 1, column + 1)]!, block };
            break;
        case 'ArrowLeft':
            next = { day: days[Math.max(0, column - 1)]!, block };
            break;
        case 'ArrowDown':
            next = { day, block: Math.min(props.grid.blocksPerDay - 1, block + 1) };
            break;
        case 'ArrowUp':
            next = { day, block: Math.max(0, block - 1) };
            break;
        case 'Home':
            next = { day: days[0]!, block };
            break;
        case 'End':
            next = { day: days[days.length - 1]!, block };
            break;
        case ' ':
        case 'Enter':
            event.preventDefault();

            if (props.readonly) return;

            if (anchor.value) {
                extendTo(day, block);
                settle();

                return;
            }

            {
                const own = draftIndexAt(day, block);

                if (own !== -1) {
                    removeAt(own);

                    return;
                }

                const held = coverage.value.get(key(day, block));

                if (held) {
                    emit('selectWindow', held.id);

                    return;
                }
            }

            begin(day, block);

            return;
        case 'Escape':
            // The rectangle in progress first, the whole selection second — so
            // abandoning one drag never discards the ones already drawn.
            if (anchor.value || live.value) {
                event.preventDefault();
                live.value = null;
                anchor.value = null;
                dragging.value = false;
            } else if (draft.value.length) {
                event.preventDefault();
                clear();
            }

            return;
        default:
            return;
    }

    event.preventDefault();
    cursor.value = next;

    if (anchor.value) {
        extendTo(next.day, next.block);
    }

    void nextTick(() => cells.get(key(next!.day, next!.block))?.focus());
}

/* ------------------------------------------------------------ what is drawn */

/**
 * Which existing window governs a cell.
 *
 * Precedence is stated rather than emergent: APPROVED reads strongest because it
 * is the only status actually in force, PENDING sits under it, and REJECTED is
 * not painted at all — it is not in effect, and drawing it would claim the
 * scheduler is honouring something it ignores.
 */
const RANK: Record<PaintedWindow['status'], number> = { APPROVED: 2, PENDING: 1, REJECTED: 0 };

const coverage = computed(() => {
    const map = new Map<string, PaintedWindow>();

    for (const window of props.windows) {
        if (window.status === 'REJECTED') continue;

        const days = window.days.length ? window.days : props.grid.activeDays;
        const blocks = window.blocks.length
            ? window.blocks
            : Array.from({ length: props.grid.blocksPerDay }, (_, index) => index);

        for (const day of days) {
            for (const block of blocks) {
                const at = key(day, block);
                const held = map.get(at);

                if (!held || RANK[window.status] > RANK[held.status]) {
                    map.set(at, window);
                }
            }
        }
    }

    return map;
});

/**
 * Which region a cell belongs to — the draft outranks a stored window.
 *
 * Each committed rectangle gets its OWN region id. Without that, two selections
 * that happen to touch would fuse into a single shape and read as one window,
 * which is precisely what they are not: each is submitted, reviewed and approved
 * on its own.
 */
function regionOf(day: number, block: number): string | null {
    if (live.value && covers(live.value, day, block)) return 'live';

    const index = draftIndexAt(day, block);

    if (index !== -1) return `draft-${index}`;

    return coverage.value.get(key(day, block))?.id ?? null;
}

/**
 * Are two block indices visually adjacent, or is there a break between them?
 *
 * A break gets its own grid row, so blocks either side of one are adjacent in
 * INDEX space but separated on screen. Treating the break as an edge closes each
 * contiguous run into its own shape — a border running through a band would
 * claim the break is blocked, and it is not: it has no block index, so it cannot
 * be.
 */
function touching(block: number): boolean {
    return geometry.lineOf(block + 1) === geometry.lineOf(block) + 1;
}

/*
 * WHY EDGES AT ALL. Without this a painted rectangle rendered as six separate
 * rounded cells with gaps between them — six things, when the whole point of the
 * reshape is that one window is one shape. The border is drawn only where the
 * region actually ends, so the interior fuses.
 */
function cellClass(day: number, block: number) {
    const held = coverage.value.get(key(day, block));
    const mine = regionOf(day, block);

    if (!mine) {
        return {};
    }

    const days = props.grid.activeDays;
    const column = days.indexOf(day);
    const last = props.grid.blocksPerDay - 1;
    const at = (d: number | undefined, b: number) => (d === undefined ? null : regionOf(d, b));

    return {
        'painter_cell--draft': mine === 'draft',
        'painter_cell--pending': mine !== 'draft' && held?.status === 'PENDING',
        'painter_cell--approved': mine !== 'draft' && held?.status === 'APPROVED',
        'painter_cell--edge-l': at(days[column - 1], block) !== mine,
        'painter_cell--edge-r': at(days[column + 1], block) !== mine,
        'painter_cell--edge-t': block === 0 || !touching(block - 1) || at(day, block - 1) !== mine,
        'painter_cell--edge-b': block === last || !touching(block) || at(day, block + 1) !== mine,
    };
}

function cellLabel(day: number, block: number): string {
    const time = blockTime(props.grid, block, day);
    const held = coverage.value.get(key(day, block));
    const state = inDraft(day, block)
        ? 'in your selection, choose again to remove'
        : held?.status === 'APPROVED'
            ? 'already blocked, approved'
            : held?.status === 'PENDING'
                ? 'already declared, awaiting review'
                : 'free';

    return `${weekdayName(day)} block ${block + 1}, ${time.start} to ${time.end} — ${state}`;
}

/** One rectangle as "Mon–Wed, 09:45–11:15". */
function describeRect(rect: Rect): string {
    const first = blockTime(props.grid, rect.blocks[0]!, rect.days[0]!);
    const last = blockTime(props.grid, rect.blocks[rect.blocks.length - 1]!, rect.days[0]!);
    const span = rect.days.length === 1
        ? weekdayName(rect.days[0]!)
        : `${weekdayShort(rect.days[0]!)}–${weekdayShort(rect.days[rect.days.length - 1]!)}`;

    return `${span}, ${first.start}–${last.end}`;
}

const says = computed(() => {
    const all = [...draft.value, ...(live.value ? [live.value] : [])];

    if (all.length === 0) {
        return props.readonly
            ? ''
            /*
             * INPUT-NEUTRAL, deliberately. The first draft named dragging and
             * the arrow keys, which is wrong on the surface most likely to read
             * it: on a phone there is no drag (that gesture scrolls) and no
             * arrow keys. "A corner, then the opposite one" is true of all three
             * inputs, because that is the model all three share.
             */
            : 'Mark when you cannot teach: choose one corner of the week, then the opposite one. '
                + 'Repeat for as many separate times as you need.';
    }

    /*
     * `blockedSlotSummary` counts DISTINCT (day, block) pairs, so overlapping
     * rectangles are counted once — the same helper, and therefore the same
     * number, as the page's own "blocked N of M" meter.
     */
    const summary = blockedSlotSummary(
        all.map((rect) => ({ ...rect, weeks: [] })),
        props.grid.activeDays,
        props.grid.blocksPerDay,
    );

    const slots = `Blocks ${summary.blocked} of ${summary.total} teaching slots`;

    if (all.length === 1) {
        return `${slots} · ${describeRect(all[0]!)}`;
    }

    // Named, not just counted: each rectangle becomes its own window and its own
    // row in the approval queue, so the person should see what they are sending.
    return `${slots} · ${all.length} separate entries — ${all.map(describeRect).join('; ')}`;
});
</script>

<style scoped lang="scss">
.painter {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
}

.painter_grid {
    display: grid;
    // Column 1 is the clock gutter; every teaching day shares the rest equally.
    // `minmax(0, 1fr)` so a long day name cannot widen its own column.
    grid-template-columns: auto repeat(var(--day-count), minmax(0, 1fr));
    // NO GAP. A gap cannot be bridged, so a painted rectangle would always read
    // as separate cells however its borders were drawn. The lattice comes from
    // each cell's own inset hairline instead, which a painted region overrides.
    gap: 0;

    padding: var(--space-3);
    // Matched to the cell lattice rather than left at `$surface4`'s 1.25:1, so
    // the grid reads as one lattice with an outer edge instead of a faint frame
    // around a stronger interior.
    border: 1px solid varToRgba('content7', 0.65);
    border-radius: var(--radius-lg);

    background: $surface1;

    &:focus-within {
        border-color: $surface5;
    }
}

/*
 * `display: contents` so the row exists for `role="grid"` and generates no box:
 * the cells place onto the OUTER grid's lines, which is what keeps the clock
 * gutter aligned with the day columns structurally rather than by computation.
 */
.painter_row {
    display: contents;
}

.painter_corner {
    grid-row: 1;
}

.painter_sr {
    position: absolute;

    overflow: hidden;

    width: 1px;
    height: 1px;

    white-space: nowrap;

    clip-path: inset(50%);
}

.painter_day {
    display: flex;
    flex-direction: column;
    gap: 0;
    align-items: center;
    justify-content: end;

    padding-bottom: var(--space-2);

    font-size: var(--font-size-xs);
    font-weight: 700;
    color: $content7;
    text-transform: uppercase;
    letter-spacing: 0.05em;
}

.painter_own {
    font-size: var(--font-size-xs);
    font-weight: 400;
    color: $surface7;
    text-transform: none;
    letter-spacing: 0;
}

.painter_time {
    display: flex;
    align-items: start;
    justify-content: end;

    padding-right: var(--space-3);

    font-size: var(--font-size-xs);
    font-variant-numeric: tabular-nums;
    color: $content7;
}

.painter_break {
    font-size: var(--font-size-xs);
    color: $surface7;
    text-transform: lowercase;
}

/* A break is not a block: no index, so nothing to store and nothing to offer. */
.painter_gap {
    border-radius: var(--radius-sm);
    background: repeating-linear-gradient(
        135deg,
        transparent 0 3px,
        varToRgba('surface5', 0.35) 3px 4px
    );
}

.painter_cell {
    cursor: crosshair;

    box-sizing: border-box;
    min-height: 18px;
    // Transparent on every side; the edge classes below colour only the sides
    // where the region actually ends. `border-box` keeps every cell the same
    // size whether or not a given side is drawn.
    border: 1px solid transparent;

    background: $surface0;
    // 3.14:1 light, 4.04:1 dark. The surface ramp cannot reach 1.4.11's 3:1
    // at all, and a painting surface wants its cells visible anyway — the faint
    // first version made the targets hard to aim at.
    box-shadow: inset 0 0 0 1px varToRgba('content7', 0.65);

    &:disabled {
        cursor: default;
    }

    &:focus-visible {
        outline: 2px solid $primary600;
        outline-offset: 1px;
    }

    /*
     * THREE STATES, AND NONE OF THEM IS THE ACCENT.
     *
     * DESIGN.md spends `$primary` on "where a session may land"; this grid is
     * about where one may NOT, so borrowing that colour would spend the one
     * signal the schedule reserves. Each state also carries a PATTERN, so the
     * three survive greyscale and a colourblind reader — the same rule
     * violations follow, and the reason the block chips gained a real tick.
     */
    // A region drops the lattice: the hairline is what separated cells, and
    // inside one window there is nothing to separate.
    &--approved,
    &--pending,
    &--draft {
        box-shadow: none;
    }

    &--approved {
        --edge: #{$content7};

        background: repeating-linear-gradient(
            135deg,
            varToRgba('content7', 0.16) 0 5px,
            varToRgba('content7', 0.32) 5px 10px
        );
    }

    &--pending {
        --edge: #{$warning700};

        background: repeating-linear-gradient(
            135deg,
            transparent 0 5px,
            varToRgba('warning700', 0.22) 5px 10px
        );
    }

    // The live rectangle. Solid, because it is the only state that is not yet a
    // claim about the timetable — it is what you are about to say.
    &--draft {
        --edge: #{$content4};

        background: varToRgba('content4', 0.22);
    }

    // Drawn only where the region ends, which is what fuses its interior.
    &--edge-t { border-top-color: var(--edge); }
    &--edge-b { border-bottom-color: var(--edge); }
    &--edge-l { border-left-color: var(--edge); }
    &--edge-r { border-right-color: var(--edge); }
}

.painter_says {
    max-width: 68ch;
    margin: 0;

    font-size: var(--font-size-sm);
    font-variant-numeric: tabular-nums;
    line-height: 1.6;
    color: $content7;

    &:empty {
        display: none;
    }
}
</style>
