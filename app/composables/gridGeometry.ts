import type { Ref } from 'vue';
import { blockTime, packSpans } from '~/composables/schedule';
import type { TimeGrid } from '~/composables/schedule';
import { blockBoundaries, blockSpan, gapsOfDay } from '#shared/timeGrid';

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
    | {
        kind: 'block';
        index: number;
        line: number;
        start: string;
        end: string;
        /** True duration, so the row's minimum height is proportional to it. */
        minutes: number;
        /** Minute-since-midnight this row opens at, on the shared timeline. */
        from: number;
    }
    | {
        kind: 'gap';
        index: number;
        line: number;
        minutes: number;
        label: string | null;
        from: number;
    };

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
            const span = blockSpan(grid.value, index, null);

            out.push({
                kind: 'block',
                index,
                line: line++,
                minutes: span.end - span.start,
                from: span.start,
                ...blockTime(grid.value, index, null),
            });

            const gap = gapAfter.get(index);

            if (gap) {
                out.push({
                    kind: 'gap',
                    index,
                    line: line++,
                    minutes: gap.minutes,
                    label: gap.label,
                    from: span.end,
                });
            }
        }

        return out;
    });

    /**
     * Which block rows get a printed clock time.
     *
     * A FINE GRID IS THE POINT OF THIS, and it is the cost of it. Adopting a
     * 15-minute base block is what lets a real timetable's 10:00–12:00 session
     * land exactly (BACKLOG.md's own recommendation, chosen over adding minute
     * columns to Session because it changes no schema and no solver contract) —
     * but it turns a 6-hour teaching day from 3 labels into 44, and 44 stacked
     * times is not a time column, it is noise with a grid behind it.
     *
     * So the gutter labels on the hour when blocks are short, and every block
     * when they are long enough to read. The threshold is duration, not count:
     * a grid of 45-minute blocks labels all of them, a grid of 15-minute blocks
     * labels 09:00, 10:00, 11:00 — and the unlabelled rows are still rows, so
     * nothing about placement or alignment changes.
     */
    const LABEL_EVERY_BELOW_MINUTES = 30;

    const labelledLines = computed(() => {
        const blocks = rows.value.filter((row): row is Extract<GridRow, { kind: 'block' }> => (
            row.kind === 'block'
        ));

        if (grid.value.blockLengthMinutes >= LABEL_EVERY_BELOW_MINUTES) {
            return new Set(blocks.map((row) => row.line));
        }

        const out = new Set<number>();
        let lastHour: number | null = null;

        for (const row of blocks) {
            const hour = Math.floor(row.from / 60);

            // The first row always speaks, whatever hour it starts in — a
            // column whose top row is blank reads as broken rather than tidy.
            if (lastHour === null || hour !== lastHour) {
                out.add(row.line);
                lastHour = hour;
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
     * Pixels per minute, anchored so a BLOCK is exactly the height the density
     * control asks for. Everything else — breaks, and the position of anything
     * inside a row — is measured against the same scale.
     */
    const perMinute = computed(() => rowHeight.value / Math.max(1, grid.value.blockLengthMinutes));

    /**
     * EVERY ROW'S MINIMUM IS ITS TRUE DURATION; every row may grow past it.
     *
     * `minmax(<true minutes>, auto)` is the whole compromise in one line. The
     * minimum keeps the picture proportional — a 45-minute break is 45 minutes
     * tall next to a 195-minute block — and `auto` lets a row that cannot fit
     * its contents at that size take what it needs, which is what stopped
     * crowded slots overflowing into the row below.
     *
     * The rows previously read `minmax(var(--row-height), auto)` for blocks and
     * `min-content` for breaks, which was correct only because every block on
     * this grid is the same length. It stated the density setting, not a
     * duration, so a break was as tall as its label rather than as long as it
     * lasts, and a grid whose blocks ever differed would have drawn them equal.
     */
    const gridTemplateRows = computed(() => ['auto', ...rows.value.map((row) => (
        `minmax(${(row.minutes * perMinute.value).toFixed(2)}px, auto)`
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

    /**
     * Where something sits inside the rows it spans, in PIXELS at a constant
     * minute scale.
     *
     * WHY PIXELS AND NOT PERCENTAGES OF THE ROW
     * -----------------------------------------
     * A percentage resolves against the row's real height, so when one column's
     * cluster made a row taller, every band in every OTHER column stretched with
     * it — a lone session in a quiet day rendered as tall as the crowded day
     * beside it, filling its whole block with one line of text in it. Worse, it
     * meant a minute was worth more pixels in a busy row than a quiet one, which
     * is the opposite of minute-accurate.
     *
     * At a constant `perMinute`, an hour is the same height everywhere on the
     * grid. A row that grew simply has empty space under its shorter columns, which
     * is the honest picture: that time is free.
     *
     * The unit is MINUTES, not block indices, so an off-block start needs no
     * layout change — only a model that can express it. Today `blockSpan()` puts
     * every Session on a boundary and this returns an offset of 0.
     */
    function bandWithin(
        day: number | null,
        start: number,
        span: number,
        fromMinute?: number,
        toMinute?: number,
    ): { marginTop: string; minHeight: string } {
        const first = blockSpan(grid.value, start, day);
        const last = blockSpan(grid.value, start + Math.max(1, span) - 1, day);
        const from = fromMinute ?? first.start;
        const to = toMinute ?? last.end;
        const ppm = perMinute.value;

        return {
            marginTop: `${Math.max(0, (from - first.start) * ppm).toFixed(2)}px`,
            minHeight: `${Math.max(0, (to - from) * ppm).toFixed(2)}px`,
        };
    }

    const cssVars = computed(() => ({
        '--day-count': String(grid.value.activeDays.length),
        '--row-height': `${rowHeight.value}px`,
        '--per-minute': String(perMinute.value),
        gridTemplateRows: gridTemplateRows.value,
    }));

    return {
        rows, lineOf, rowSpan, bandWithin, gridTemplateRows,
        dayDiffers, cssVars, perMinute, labelledLines,
    };
}

export interface GridSlot<T> {
    key: string;
    items: T[];
    /** Crowded: one full-width slot, every member on a single compact line. */
    compact: boolean;
    style: Record<string, string>;
}

export interface SlotPlacement {
    column: string;
    rowSpan: (start: number, span: number) => string;
    /** Minute-true offset and minimum extent within the spanned rows. */
    band: (start: number, span: number) => { marginTop: string; minHeight: string };
    dayKey: string | number;
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
    place: SlotPlacement,
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
                        ...place.band(span.start, span.span),
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
                ...place.band(first.start, end - first.start),
                width: '100%',
                marginLeft: '0%',
            },
        });
    }

    return out;
}
