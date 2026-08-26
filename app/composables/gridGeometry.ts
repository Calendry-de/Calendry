import type { Ref } from 'vue';
import { blockTime, packSpans } from '~/composables/schedule';
import type { TimeGrid } from '~/composables/schedule';
import { blockBoundaries, gapsOfDay } from '#shared/timeGrid';

/**
 * The row structure a week grid is drawn on: one row per block, one per break.
 *
 * OWNERSHIP BOUNDARY: turning a TimeGrid into grid rows and placing things in
 * them. It knows nothing about Sessions, diffs, selection or placement mode —
 * only that some items occupy a range of blocks on a day.
 *
 * WHY ROWS AND NOT MINUTE-ACCURATE OFFSETS
 * ----------------------------------------
 * Both grids used to position each day as its own absolutely-positioned stack,
 * sized from that day's own `blockBoundaries()`. That is minute-true, and it is
 * what let a day with its own breaks visibly drift from the time column.
 *
 * It cannot express a row that grows. A block's height was a function of the
 * density setting alone, so four sessions in one slot either shrank to
 * unreadable slivers side by side or overflowed their block — and when they
 * overflowed, the day columns and the time column disagreed about where 16:15
 * was, because each computed its own offsets independently.
 *
 * Sharing one set of ROWS across every day fixes that by construction: a block's
 * time label and that block's cells are in the same grid row, so whatever makes
 * the row taller moves the label with it. Nothing is computed, so nothing can
 * drift.
 *
 * WHAT IT COSTS, STATED PLAINLY: per-day drift can no longer be DRAWN. A day
 * whose own `time_grid_break` rows move its blocks does not start at the times
 * in the gutter, and `dayDiffers()` exists so the header can say so. Every
 * consumer must resolve its own clock times with `blockTime(grid, index, day)`
 * rather than reading them off the shared row.
 *
 * The block/break WALK is untouched: `blockBoundaries()`, `gapsOfDay()` and
 * `blockTime()` in `shared/timeGrid.ts` remain the single definition, shared
 * with the server. Only the projection into pixels lives here.
 *
 * SYNCHRONOUS AND CONTEXT-FREE — no `useAsyncData`, no `useRequestFetch`, so it
 * composes anywhere in setup.
 */

export type GridRow =
    | { kind: 'block'; index: number; line: number; start: string; end: string }
    | { kind: 'gap'; index: number; line: number; minutes: number; label: string | null };

export function useGridGeometry(grid: Ref<TimeGrid>, rowHeight: Ref<number>) {
    /**
     * `line` is the CSS grid line, 1-based, with the header occupying row 1.
     * Held on the row rather than derived at each use, so the time column, the
     * cells and the chips cannot disagree about which row a block is.
     *
     * The gaps are the UNIVERSAL ones (`gapsOfDay(grid, null)`). A day-specific
     * break has no row of its own — see the note above.
     */
    const rows = computed<GridRow[]>(() => {
        const gapAfter = new Map(gapsOfDay(grid.value, null).map((gap) => [gap.afterBlockIndex, gap]));
        const out: GridRow[] = [];
        let line = 2;

        for (let index = 0; index < grid.value.blocksPerDay; index++) {
            out.push({ kind: 'block', index, line: line++, ...blockTime(grid.value, index, null) });

            const gap = gapAfter.get(index);

            if (gap) {
                out.push({ kind: 'gap', index, line: line++, minutes: gap.minutes, label: gap.label });
            }
        }

        return out;
    });

    const blockLines = computed(() => {
        const map = new Map<number, number>();

        for (const row of rows.value) {
            if (row.kind === 'block') {
                map.set(row.index, row.line);
            }
        }

        return map;
    });

    const lineOf = (blockIndex: number) => blockLines.value.get(blockIndex) ?? 2;

    /**
     * A block row is AT LEAST the density the reader chose and grows past it
     * when its fullest day needs more. A break row is sized to its own label.
     * Emitted as an inline style because the row count is data: `blocksPerDay`
     * and the tenant's break rows decide it.
     */
    const gridTemplateRows = computed(() => ['auto', ...rows.value.map((row) => (
        row.kind === 'block' ? 'minmax(var(--row-height), auto)' : 'min-content'
    ))].join(' '));

    /** The grid rows something occupies, counting any break rows it spans. */
    const rowSpan = (start: number, span: number) => {
        const from = lineOf(start);
        const to = lineOf(start + Math.max(1, span) - 1);

        return `${from} / ${to + 1}`;
    };

    /**
     * Whether this day's blocks start at the times the shared gutter shows.
     *
     * Compared on the resolved BOUNDARIES rather than by looking for a
     * day-specific break row, because a row that happens to restate the
     * universal duration changes nothing a viewer can see, and flagging it
     * would be noise.
     */
    function dayDiffers(day: number): boolean {
        const mine = blockBoundaries(grid.value, day);
        const theirs = blockBoundaries(grid.value, null);
        const origin = (list: number[]) => list[0] ?? 0;

        return mine.some((minute, index) => (
            minute - origin(mine) !== (theirs[index] ?? 0) - origin(theirs)
        ));
    }

    const cssVars = computed(() => ({
        '--day-count': String(grid.value.activeDays.length),
        '--row-height': `${rowHeight.value}px`,
        gridTemplateRows: gridTemplateRows.value,
    }));

    return { rows, lineOf, rowSpan, gridTemplateRows, dayDiffers, cssVars };
}

export interface GridSlot<T> {
    key: string;
    items: T[];
    /** Crowded: one full-width slot, every member on a single compact line. */
    compact: boolean;
    style: Record<string, string>;
}

/**
 * How many items can sit side by side in one day column and stay readable.
 *
 * Three at a typical column width leaves each about a third of roughly 200px —
 * enough for a code and a room to survive `text-overflow: ellipsis`. A fourth
 * takes every one of them to ~50px, which is not a narrow chip but an
 * unreadable one.
 */
export const FAN_LIMIT = 3;

/**
 * Overlapping items, packed into positioned slots for one day.
 *
 * PAST THE FAN LIMIT THE DENSITY CHANGES, NEVER THE COUNT. Hiding an overlap is
 * wrong on both grids for different reasons: on the live schedule an overlap is
 * usually a defect the timetabler is hunting, and on the review grid it is a
 * placement someone is being asked to accept. A count you must expand is a
 * decision you cannot make at a glance.
 *
 * It was also measured. A collapse-past-three rule turned 17 of 20 slots in a
 * real week into "+2 more" buttons: the grid stopped being a picture of the week
 * and became a list of disclosure controls, which is worse than the crowding it
 * was meant to fix. A TimeGrid with three long blocks a day makes four items in
 * one slot ordinary, not exceptional.
 *
 * So a crowded cluster becomes ONE full-width slot whose members stack under
 * each other on single compact lines, and the row grows to fit them. The caller
 * renders `compact` however its own chip does.
 */
export function clusterSlots<T>(
    items: T[],
    read: (item: T) => { key: string; start: number; span: number },
    place: { column: string; rowSpan: (start: number, span: number) => string; dayKey: string | number },
    fanLimit: number = FAN_LIMIT,
): GridSlot<T>[] {
    const packed = packSpans(items, read);
    const clusters = new Map<string, typeof packed>();

    for (const entry of packed) {
        const list = clusters.get(entry.cluster) ?? [];

        list.push(entry);
        clusters.set(entry.cluster, list);
    }

    const out: GridSlot<T>[] = [];

    for (const [name, members] of clusters) {
        const columns = members[0]?.columns ?? 1;
        const key = `${place.dayKey}:${name}`;

        if (columns <= fanLimit) {
            for (const { item, column } of members) {
                const width = 100 / columns;
                const span = read(item);

                out.push({
                    key: `${key}:${column}:${span.key}`,
                    items: [item],
                    compact: false,
                    style: {
                        gridRow: place.rowSpan(span.start, span.span),
                        gridColumn: place.column,
                        width: `${width}%`,
                        marginLeft: `${column * width}%`,
                    },
                });
            }

            continue;
        }

        // Ordered by start block, so the stack reads in time order rather than
        // in the packer's column order.
        const ordered = [...members].sort((a, b) => {
            const left = read(a.item);
            const right = read(b.item);

            return left.start - right.start || left.key.localeCompare(right.key);
        });
        const first = read(ordered[0]!.item);
        const end = Math.max(...ordered.map((entry) => {
            const span = read(entry.item);

            return span.start + Math.max(1, span.span);
        }));

        out.push({
            key,
            items: ordered.map((entry) => entry.item),
            compact: true,
            style: {
                gridRow: place.rowSpan(first.start, end - first.start),
                gridColumn: place.column,
                width: '100%',
                marginLeft: '0%',
            },
        });
    }

    return out;
}
